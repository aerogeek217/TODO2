import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import {
  emojiFromField,
  emojiIcon,
  emojiShow,
  sameIcon,
  type EmojiShow,
  type IconValue,
} from '../../models/icon'
import { usePopoverAnchor } from '../../hooks/use-popover-anchor'
import { useLatestRef } from '../../hooks/use-latest-ref'
import { AppIcon } from './AppIcon'
import { emojiFieldHint, LINE_ICON_CHOICES, type IconChoice } from './icon-picker-choices'
import { PopoverRoot } from './PopoverRoot'
import { KEEP_EVENTS_INSIDE } from './keep-events-inside'
import styles from './IconPicker.module.css'

/** Columns of the Icons and Recent grids (the arrow keys step a row by this). */
const GRID_COLUMNS = 8

export interface IconPickerProps {
  /** The control that opened it: placed under it, and handed the focus back on Esc or a pick that closes it. */
  anchorRef: RefObject<HTMLElement | null>
  /** The icon picked now (absent: never picked). */
  value: IconValue | undefined
  /** What shows while none is picked (a tab's kind icon, J1): marked as the current choice. */
  fallback?: IconValue
  /** The Icons tab's choices (default: the built-in line icons). */
  choices?: readonly IconChoice[]
  /** The emoji already used in the app's data (J6, `useRecentEmoji`); empty shows no Recent. */
  recent: readonly string[]
  /** A pick: a line icon or No icon (the picker then closes), or an emoji or its Show as (it stays open). */
  onPick: (icon: IconValue) => void
  onClose: () => void
  /** Its accessible name. Default `Icon`. */
  label?: string
}

/**
 * The one icon picker (items 11, 14; the icons board): tabs **Icons** (the
 * built-in line icons) and **Emoji** (a field the OS emoji panel types into —
 * nothing bundled, decision 16 — with Show as Muted | Color and Recent),
 * and **No icon** at its foot (decision 13: no Default icon). A popover
 * placed under its opener, portaled, at the level above what opened it.
 *
 * An emoji arriving in the field is applied at once and the rest of the
 * field dropped (Windows' panel can leave its search letters); text that
 * isn't an emoji is refused with a line saying so, on a paste or Enter. A
 * line icon or No icon closes it; an emoji keeps it open, its Show as beside
 * it. Esc closes it and hands the focus back to the opener.
 */
export function IconPicker({ anchorRef, value, fallback, choices = LINE_ICON_CHOICES, recent, onPick, onClose, label = 'Icon' }: IconPickerProps) {
  const [tab, setTab] = useState<'icons' | 'emoji'>(value?.kind === 'emoji' ? 'emoji' : 'icons')
  const [show, setShow] = useState<EmojiShow>(value?.kind === 'emoji' ? emojiShow(value) : 'muted')
  const [text, setText] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const fieldRef = useRef<HTMLInputElement | null>(null)
  const gridRef = useRef<HTMLDivElement | null>(null)
  const hint = useMemo(() => emojiFieldHint(), [])
  const current = value ?? fallback

  /** Closed by Esc or a pick: the focus goes back to the opener (an outside press leaves it where it went). */
  const handBack = useRef(false)
  const closeAndReturn = () => {
    handBack.current = true
    onClose()
  }
  const { panelRef, style, caret } = usePopoverAnchor({
    anchor: { kind: 'ref', ref: anchorRef },
    open: true,
    closeOnScroll: false,
    closeOnResize: false,
    // Its own Esc, below: on the window, ahead of the popover it opened from (which listens on the document).
    closeOnEscape: false,
    observeSize: true,
    caret: true,
    onClose,
  })
  const closeRef = useLatestRef(closeAndReturn)
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      e.preventDefault()
      closeRef.current()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [closeRef])
  useEffect(() => () => {
    const opener = anchorRef.current
    const active = document.activeElement
    const focusLeft = !active || active === document.body || !active.isConnected
    if (handBack.current && opener?.isConnected && focusLeft) opener.focus({ preventScroll: true })
  }, [anchorRef])

  // The Emoji tab opens with the field focused (the OS panel types into it); the Icons tab with its current cell.
  useLayoutEffect(() => {
    if (tab === 'emoji') fieldRef.current?.focus()
    else (gridRef.current?.querySelector<HTMLButtonElement>('[data-current]') ?? gridRef.current?.querySelector<HTMLButtonElement>('button'))?.focus()
  }, [tab])

  const pickAndClose = (icon: IconValue) => {
    onPick(icon)
    closeAndReturn()
  }
  const pickEmoji = (emoji: string) => {
    setProblem(null)
    onPick(emojiIcon(emoji, show))
  }
  const setShowAs = (next: EmojiShow) => {
    setShow(next)
    if (value?.kind === 'emoji' && emojiShow(value) !== next) onPick(emojiIcon(value.emoji, next))
  }
  /** What the field holds now: its one emoji applied (the rest dropped), or refused when `refuse` (a paste, Enter). */
  const readField = (raw: string, refuse: boolean) => {
    const got = emojiFromField(raw)
    if (got && 'emoji' in got) {
      setText('')
      pickEmoji(got.emoji)
      return
    }
    if (got) {
      setText('')
      setProblem(got.problem)
      return
    }
    if (refuse && raw.trim() !== '') {
      setText('')
      setProblem('That isn’t an emoji. Pick one with the emoji panel, or paste one.')
      return
    }
    setText(raw)
  }

  const onGridKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button'))
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (i < 0) return
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: GRID_COLUMNS, ArrowUp: -GRID_COLUMNS }[e.key]
    let next: number | undefined
    if (step !== undefined) next = Math.max(0, Math.min(buttons.length - 1, i + step))
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = buttons.length - 1
    if (next === undefined) return
    e.preventDefault()
    buttons[next]?.focus()
  }

  return createPortal(
    <PopoverRoot
      ref={panelRef}
      caret={caret}
      role="dialog"
      aria-label={label}
      className={styles.picker}
      data-icon-picker=""
      style={{ position: style.position, left: style.left, top: style.top }}
      {...KEEP_EVENTS_INSIDE}
    >
      <div className={styles.tabs} role="tablist" aria-label="Icon source">
        {(['icons', 'emoji'] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            className={`${styles.segment} ${tab === t ? styles.segmentOn : ''}`}
            onClick={() => setTab(t)}
          >
            {t === 'icons' ? 'Icons' : 'Emoji'}
          </button>
        ))}
      </div>

      {tab === 'icons' ? (
        <div ref={gridRef} className={styles.grid} role="group" aria-label="Icons" onKeyDown={onGridKey}>
          {choices.map((c) => {
            const on = sameIcon(c.value, current)
            return (
              <button
                key={c.label}
                type="button"
                className={`${styles.cell} ${on ? styles.cellOn : ''}`}
                aria-label={c.label}
                aria-pressed={on}
                title={c.label}
                data-current={on ? '' : undefined}
                onClick={() => pickAndClose(c.value)}
              >
                <AppIcon icon={c.value} size={15} />
              </button>
            )
          })}
        </div>
      ) : (
        <div className={styles.emojiTab}>
          <input
            ref={fieldRef}
            className={styles.field}
            type="text"
            value={text}
            placeholder={hint}
            aria-label="Emoji"
            aria-describedby={problem ? 'icon-picker-problem' : undefined}
            aria-invalid={problem ? true : undefined}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => {
              const native = e.nativeEvent as InputEvent
              const pasted = native.inputType === 'insertFromPaste' || native.inputType === 'insertFromDrop'
              if (!pasted) setProblem(null)
              readField(e.target.value, pasted)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                readField(text, true)
              }
            }}
          />
          {problem && <div id="icon-picker-problem" className={styles.problem} role="alert">{problem}</div>}
          <div className={styles.showAs}>
            <span className={styles.showAsLabel} id="icon-picker-show-as">Show as</span>
            <span className={styles.tabs} role="radiogroup" aria-labelledby="icon-picker-show-as">
              {(['muted', 'color'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={show === s}
                  className={`${styles.segment} ${show === s ? styles.segmentOn : ''}`}
                  onClick={() => setShowAs(s)}
                >
                  {s === 'muted' ? 'Muted' : 'Color'}
                </button>
              ))}
            </span>
          </div>
          {recent.length > 0 && (
            <>
              <div className={styles.caption} id="icon-picker-recent">Recent</div>
              <div ref={gridRef} className={styles.grid} role="group" aria-labelledby="icon-picker-recent" onKeyDown={onGridKey}>
                {recent.map((emoji) => {
                  const icon = emojiIcon(emoji, show)
                  const on = value?.kind === 'emoji' && value.emoji === emoji
                  return (
                    <button
                      key={emoji}
                      type="button"
                      className={`${styles.cell} ${on ? styles.cellOn : ''}`}
                      aria-label={`Emoji ${emoji}`}
                      aria-pressed={on}
                      onClick={() => pickEmoji(emoji)}
                    >
                      <AppIcon icon={icon} size={16} />
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </div>
      )}

      <div className={styles.foot}>
        <button
          type="button"
          className={`${styles.noIcon} ${current?.kind === 'none' ? styles.noIconOn : ''}`}
          aria-pressed={current?.kind === 'none'}
          onClick={() => pickAndClose({ kind: 'none' })}
        >
          No icon
        </button>
      </div>
    </PopoverRoot>,
    document.body,
  )
}
