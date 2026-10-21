import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode, RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useLatestRef } from '../../hooks/use-latest-ref'
import styles from './Dialog.module.css'
import { DialogLayerContext, MODAL_BACKDROP_ATTR } from './dialog-layer'
import { useBackdropPress } from './use-backdrop-press'
import { tabbables } from '../../utils/focusables'

/**
 * Which tier a dialog (backdrop + panel) sits on, lowest first:
 * - `overlay` — the big workspace dialogs (task dialog, check-ins, Settings,
 *   Customize dashboard); row pickers and menus open above them.
 * - `dialog` — the default for the small titled dialogs.
 * - `raised` — the task editor stacked over another dialog (`nested`).
 * - `nested` — over any other dialog (confirms asked from inside one).
 */
export type DialogLayer = 'overlay' | 'dialog' | 'raised' | 'nested'

/** Where focus goes when the dialog opens. */
export type DialogInitialFocus = 'first' | 'panel' | RefObject<HTMLElement | null>

export interface DialogFrameProps {
  onClose: () => void
  children: ReactNode
  /** The panel's look and size; the frame only centres it. */
  className?: string
  style?: CSSProperties
  /** Extra class on the backdrop (e.g. a darker scrim). */
  backdropClassName?: string
  /** Default `dialog`. */
  layer?: DialogLayer
  /** Default `first`: the first focusable control, else the panel. */
  initialFocus?: DialogInitialFocus
  /**
   * While this returns true, Esc is not the dialog's: a layer opened over it
   * (an editor, a menu, a stacked prompt) or a keyboard drag inside it has
   * the key. Layers that are dialogs themselves don't need this.
   */
  escapeBelongsElsewhere?: () => boolean
  /** A backdrop press never closes the dialog. */
  blockBackdropClose?: boolean
  /**
   * Render in place instead of into `document.body`. Only for a dialog
   * opened from inside a popover whose outside-click check counts DOM
   * containment: a portaled dialog would count as outside and close it.
   */
  inline?: boolean
  'aria-labelledby'?: string
  'aria-label'?: string
  'aria-describedby'?: string
  /** `data-*` hooks on the panel, without the `data-` prefix. */
  data?: Record<string, string>
  /** The panel element, for callers that move focus inside it. */
  panelRef?: RefObject<HTMLDivElement | null>
  /** The dialog's own keys (list navigation, shortcuts), before the frame's Esc / Tab; `preventDefault` claims a key. */
  onKeyDown?: (e: ReactKeyboardEvent<HTMLDivElement>) => void
  /**
   * No key leaves the panel through the React tree it was opened from. Only
   * for a dialog opened from inside a surface with its own key handling (the
   * notes → tasks preview inside the task editor); it also hides the keys
   * from `document` listeners such as dnd-kit's keyboard sensor.
   */
  stopKeys?: boolean
}


/** Whether `panel` is the last modal in the page (portaled dialogs append in open order). */
function isTopmostModal(panel: HTMLElement): boolean {
  const modals = document.querySelectorAll('[aria-modal="true"]')
  return modals[modals.length - 1] === panel
}

/** A key that landed on the page itself: nothing is focused. */
function isPageTarget(target: EventTarget | null): boolean {
  return !(target instanceof Element) || target === document.body || target === document.documentElement
}

const LAYER_CLASS: Record<DialogLayer, string | undefined> = {
  overlay: styles.layerOverlay,
  dialog: styles.layerDialog,
  raised: styles.layerRaised,
  nested: styles.layerNested,
}

/**
 * The one modal frame: a backdrop and a centred panel (`role="dialog"`,
 * `aria-modal`), rendered into `document.body`. Behaviour:
 *
 * - **Esc** closes it — from inside the panel, or with nothing focused (the
 *   topmost dialog only). A key a layer inside already handled
 *   (`preventDefault`), a key from a layer portaled out of the panel, and
 *   `escapeBelongsElsewhere` leave it open. The closing Esc stops there.
 * - **Focus** moves in on open (`initialFocus`), Tab / Shift+Tab wrap inside
 *   the panel (Tab with nothing focused comes back in), and focus returns to
 *   where it was when the dialog closes.
 * - **Backdrop:** a press that starts and ends on it closes the dialog, so a
 *   text drag that ends outside the panel doesn't. It dims and blurs the
 *   page (`--backdrop-blur`) — unless the dialog opened over another modal
 *   or on the `raised` / `nested` tiers, whose backdrop adds no second blur.
 * - **Keys stay in:** the panel is `data-shortcut-scope="modal"`, so no app
 *   shortcut fires from inside it.
 * - **Tier:** what it renders (portaled layers too) reads its `layer` with
 *   `useDialogLayer` — e.g. a person's menu leaves out Show tasks where the
 *   task dialog couldn't show above.
 */
export function DialogFrame({
  onClose,
  children,
  className,
  style,
  backdropClassName,
  layer = 'dialog',
  initialFocus = 'first',
  escapeBelongsElsewhere,
  blockBackdropClose = false,
  inline = false,
  'aria-labelledby': labelledBy,
  'aria-label': label,
  'aria-describedby': describedBy,
  data,
  panelRef: outerPanelRef,
  onKeyDown: ownKeyDown,
  stopKeys = false,
}: DialogFrameProps) {
  const ownPanelRef = useRef<HTMLDivElement | null>(null)
  const panelRef = outerPanelRef ?? ownPanelRef
  const onCloseRef = useLatestRef(onClose)
  const elsewhereRef = useLatestRef(escapeBelongsElsewhere)
  const initialFocusRef = useLatestRef(initialFocus)
  const backdropPress = useBackdropPress(onClose, { enabled: !blockBackdropClose })
  // What had the focus when the dialog opened — read before its content
  // mounts, since an `autoFocus` control inside takes the focus first.
  const [opener] = useState(() => document.activeElement as HTMLElement | null)
  // Opened over another modal: that one's backdrop already blurs the page.
  // Decided once mounted (before paint), from the backdrops before this one
  // in the page: a modal this one replaces in the same render is gone then.
  const backdropRef = useRef<HTMLDivElement | null>(null)
  const tierStacked = layer === 'nested' || layer === 'raised'
  const [overAnother, setOverAnother] = useState(false)
  useLayoutEffect(() => {
    const own = backdropRef.current
    if (!own || tierStacked) return
    const below = [...document.querySelectorAll(`[${MODAL_BACKDROP_ATTR}]`)]
      .some((el) => el !== own && (el.compareDocumentPosition(own) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0)
    setOverAnother(below)
  }, [tierStacked])
  const stacked = tierStacked || overAnother

  // Focus moves in on open (unless a control inside already took it) and
  // goes back to the opener once the dialog is gone.
  useEffect(() => {
    const panel = panelRef.current
    if (panel && !panel.contains(document.activeElement)) {
      const target = initialFocusRef.current
      const el = target === 'panel' ? panel
        : target === 'first' ? tabbables(panel)[0] ?? panel
          : target.current ?? panel
      el.focus()
    }
    return () => {
      // Still in the page: a re-run (React's StrictMode), not a close.
      if (panel?.isConnected) return
      // Something the close opened already took the focus (a command run
      // from the palette that opens Quick Add): leave it there.
      const active = document.activeElement
      if (active && active !== document.body && active.isConnected) return
      if (opener && opener !== document.body && document.body.contains(opener)) opener.focus()
    }
  }, [initialFocusRef, panelRef, opener])

  // Keys with nothing focused: Esc closes the topmost dialog, Tab comes back in.
  // Bubble phase, so popovers (capture phase) and the panel's own handler come first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || (e.key !== 'Escape' && e.key !== 'Tab')) return
      const panel = panelRef.current
      if (!panel || !isPageTarget(e.target) || !isTopmostModal(panel)) return
      if (e.key === 'Escape') {
        if (elsewhereRef.current?.()) return
        e.preventDefault()
        e.stopPropagation()
        onCloseRef.current()
        return
      }
      e.preventDefault()
      const items = tabbables(panel)
      const next = e.shiftKey ? items.at(-1) : items.at(0)
      ;(next ?? panel).focus()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [elsewhereRef, onCloseRef, panelRef])

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (stopKeys) e.stopPropagation()
    const panel = panelRef.current
    // Keys from a layer portaled out of the panel (a menu, a picker) are that layer's.
    if (!panel || !(e.target instanceof Node) || !panel.contains(e.target)) return
    ownKeyDown?.(e)
    if (e.nativeEvent.defaultPrevented) return
    if (e.key === 'Escape') {
      if (elsewhereRef.current?.()) return
      e.preventDefault()
      e.stopPropagation()
      onCloseRef.current()
      return
    }
    if (e.key !== 'Tab') return
    const items = tabbables(panel)
    const first = items.at(0)
    const last = items.at(-1)
    const active = document.activeElement
    if (!first || !last) {
      e.preventDefault()
      panel.focus()
    } else if (e.shiftKey && (active === first || active === panel)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    }
  }

  const layerClass = LAYER_CLASS[layer] ?? ''
  const dataAttributes = Object.fromEntries(Object.entries(data ?? {}).map(([k, v]) => [`data-${k}`, v]))

  const frame = (
    <>
      <div
        ref={backdropRef}
        className={`${styles.backdrop} ${layerClass} ${stacked ? '' : styles.backdropBlur} ${backdropClassName ?? ''}`}
        data-dialog-backdrop=""
        {...{ [MODAL_BACKDROP_ATTR]: '' }}
        {...backdropPress}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-label={label}
        aria-describedby={describedBy}
        tabIndex={-1}
        className={`${styles.panel} ${layerClass} ${className ?? ''}`}
        style={style}
        data-shortcut-scope="modal"
        onKeyDown={onKeyDown}
        {...dataAttributes}
      >
        <DialogLayerContext.Provider value={layer}>{children}</DialogLayerContext.Provider>
      </div>
    </>
  )
  return inline ? frame : createPortal(frame, document.body)
}

export interface DialogProps {
  open: boolean
  onClose: () => void
  /** Renders into the chrome's title bar. Used as `aria-labelledby` target. */
  title: ReactNode
  children: ReactNode
  /** Width preset. Defaults to 'sm' (~440px, confirm-style). */
  size?: 'sm' | 'md' | 'lg'
  /** When true, clicking the backdrop does NOT close the dialog. Default false. */
  blockBackdropClose?: boolean
  /** Optional ref for the element that should receive focus on mount.
   *  Defaults to the first focusable element inside the dialog. */
  initialFocusRef?: RefObject<HTMLElement | null>
  /** Optional className applied to the dialog body wrapper. */
  className?: string
  /** Inline style escape hatch. */
  style?: CSSProperties
  /** Sits over another dialog (`nested` tier). */
  nested?: boolean
  /** See `DialogFrame.inline`. */
  inline?: boolean
}

/** A small titled dialog on the shared frame (confirms, prompts). */
export function Dialog({
  open,
  onClose,
  title,
  children,
  size = 'sm',
  blockBackdropClose = false,
  initialFocusRef,
  className,
  style,
  nested = false,
  inline = false,
}: DialogProps) {
  const titleId = useId()
  if (!open) return null
  const sizeClass = size === 'lg' ? styles.sizeLg : size === 'md' ? styles.sizeMd : styles.sizeSm
  return (
    <DialogFrame
      onClose={onClose}
      layer={nested ? 'nested' : 'dialog'}
      initialFocus={initialFocusRef ?? 'first'}
      blockBackdropClose={blockBackdropClose}
      inline={inline}
      aria-labelledby={titleId}
      className={`${styles.dialog} ${sizeClass} ${className ?? ''}`}
      style={style}
    >
      <div id={titleId} className={styles.title}>{title}</div>
      {children}
    </DialogFrame>
  )
}

export function DialogBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`${styles.body} ${className ?? ''}`}>{children}</div>
}

export function DialogActions({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`${styles.actions} ${className ?? ''}`}>{children}</div>
}

export interface ConfirmDialogProps {
  open: boolean
  title: ReactNode
  message: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** Renders the confirm button with danger styling. */
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
  /** Sits over another dialog. See `Dialog`'s `nested` prop. */
  nested?: boolean
  /** The button focused on open (so Enter picks it). Default: confirm. */
  initialFocus?: 'confirm' | 'cancel'
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  onConfirm,
  onCancel,
  nested = false,
  initialFocus = 'confirm',
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      initialFocusRef={initialFocus === 'cancel' ? cancelRef : confirmRef}
      nested={nested}
    >
      <DialogBody>{message}</DialogBody>
      <DialogActions>
        <button ref={cancelRef} type="button" className={styles.cancelButton} onClick={onCancel}>
          {cancelLabel}
        </button>
        <button
          ref={confirmRef}
          type="button"
          className={danger ? styles.dangerButton : styles.confirmButton}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </DialogActions>
    </Dialog>
  )
}
