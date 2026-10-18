import { useCallback, useEffect, useId, useState, type CSSProperties, type Ref } from 'react'
import type { AutocompleteRow, AutocompleteView } from '../../services/nlp-autocomplete'
import { CalendarIcon, CommandIcon } from './CommandIcons'
import { FollowupFlagIcon } from './FollowupIcons'
import { StatusIcon } from './StatusIcon'
import { DEFAULT_STATUS_ICON } from '../../models'
import styles from './NlpPopup.module.css'
import { useLatestRef } from '../../hooks/use-latest-ref'
import { PickerEntityMenu } from './EntityMenu'

/** A person / tag row's menu (Show tasks · Edit… · Delete…) on the popup's rows. */
export interface NlpEntityMenuOptions {
  /**
   * The text field the popup belongs to: Shift+F10 / the context-menu key
   * there (a `contextmenu` without the right button) opens the active row's
   * menu under it.
   */
  keyTarget: () => HTMLElement | null
  /** Called as the menu opens / closes — before the focus moves into it. */
  onOpenChange?: (open: boolean) => void
  /** Runs before Show tasks opens the task dialog (the host closes the popup). */
  onShowTasks?: () => void
}

interface NlpPopupProps {
  view: AutocompleteView
  selectedIndex: number
  onPick: (row: AutocompleteRow) => void
  /** Positioning: the host anchors the popup (portal + fixed, or absolute). */
  className?: string
  style?: CSSProperties
  popupRef?: Ref<HTMLDivElement>
  /** People / tag rows get the person's / tag's menu. */
  entityMenu?: NlpEntityMenuOptions
}

/** The person / tag a row is for, or null (create, command, value rows; statuses). */
function rowEntity(row: AutocompleteRow | undefined): { kind: 'person' | 'tag'; id: number } | null {
  if (row?.kind !== 'entity' || row.item.kind === 'status') return null
  return { kind: row.item.kind, id: row.item.id }
}

/** `text` with its first `length` characters marked (the typed prefix). */
function Marked({ text, length }: { text: string; length: number }) {
  if (length <= 0) return <>{text}</>
  return <><mark className={styles.match}>{text.slice(0, length)}</mark>{text.slice(length)}</>
}

function rowKey(row: AutocompleteRow, i: number): string {
  switch (row.kind) {
    case 'entity': return `${row.item.kind}-${row.item.id}`
    case 'command': return row.command.name
    case 'value': return `v-${row.insert}`
    default: return `${row.kind}-${i}`
  }
}

/**
 * The task-text autocomplete popup (`@` people, `#` tags, `/` commands and
 * their arguments) for an `AutocompleteView` from `services/nlp-autocomplete`.
 * Presentational: rows are picked on a left-button mousedown (so the input
 * keeps focus); keys are the host's (`hooks/use-nlp-autocomplete`). With
 * `entityMenu`, a right-click on a person / tag row — or Shift+F10 / the
 * context-menu key in the host's field on the active one — opens its menu
 * (`PickerEntityMenu`) without picking it; the host keeps its text and caret.
 */
export function NlpPopup({ view, selectedIndex, onPick, className, style, popupRef, entityMenu }: NlpPopupProps) {
  const popupId = useId()
  /** The person / tag whose menu is open, and where. */
  const [menu, setMenu] = useState<{ kind: 'person' | 'tag'; id: number; x: number; y: number } | null>(null)
  const optionsRef = useLatestRef(entityMenu)
  const openMenu = useCallback((row: AutocompleteRow | undefined, x: number, y: number): boolean => {
    const entity = rowEntity(row)
    if (!entity || !optionsRef.current) return false
    optionsRef.current.onOpenChange?.(true)
    setMenu({ ...entity, x, y })
    return true
  }, [optionsRef])
  const closeMenu = () => {
    setMenu(null)
    entityMenu?.onOpenChange?.(false)
  }

  // Shift+F10 / the context-menu key in the host's field: the active row's menu, under it.
  const rowsRef = useLatestRef(view.rows)
  const selectedRef = useLatestRef(selectedIndex)
  const hasMenu = !!entityMenu
  useEffect(() => {
    const target = hasMenu ? optionsRef.current?.keyTarget() : null
    if (!target) return
    const onContextMenu = (e: MouseEvent) => {
      if (e.button === 2) return // a right-click keeps the field's own menu
      const el = document.querySelector<HTMLElement>(`[data-nlp-popup-id="${CSS.escape(popupId)}"] [data-row-index="${selectedRef.current}"]`)
      const rect = el?.getBoundingClientRect()
      if (openMenu(rowsRef.current[selectedRef.current], (rect?.left ?? 0) + 16, rect?.bottom ?? 0)) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    target.addEventListener('contextmenu', onContextMenu)
    return () => target.removeEventListener('contextmenu', onContextMenu)
  }, [hasMenu, optionsRef, openMenu, rowsRef, selectedRef, popupId])

  const pick = (row: AutocompleteRow) => (e: React.MouseEvent) => {
    e.preventDefault() // keep focus in the input
    if (e.button === 0) onPick(row)
  }
  const rowMenu = (row: AutocompleteRow) => (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    openMenu(row, e.clientX, e.clientY)
  }

  const renderRow = (row: AutocompleteRow, i: number) => {
    const active = i === selectedIndex
    const cls = `${styles.item} ${active ? styles.active : ''}`
    switch (row.kind) {
      case 'entity':
        return (
          <button
            key={rowKey(row, i)}
            type="button"
            role="option"
            aria-selected={active}
            className={cls}
            data-row-index={i}
            onMouseDown={pick(row)}
            onContextMenu={entityMenu ? rowMenu(row) : undefined}
          >
            {row.item.color && <span className={styles.dot} style={{ background: row.item.color }} />}
            <span className={styles.name}>{view.trigger}{row.item.name}</span>
          </button>
        )
      case 'create': {
        const person = row.trigger === '@'
        return (
          <button
            key={rowKey(row, i)}
            type="button"
            role="option"
            aria-selected={active}
            className={`${cls} ${person ? styles.createPerson : styles.createTag}`}
            onMouseDown={pick(row)}
          >
            {person && <span className={styles.newAvatar} aria-hidden="true">{row.name.charAt(0).toUpperCase()}</span>}
            <span className={styles.name}>
              {person ? `Press ⏎ to create @${row.name}` : `Press Enter to create #${row.name.toLowerCase()}`}
            </span>
          </button>
        )
      }
      case 'command':
        return (
          <button key={rowKey(row, i)} type="button" role="option" aria-selected={active} className={cls} onMouseDown={pick(row)}>
            <span className={styles.icon} data-command={row.command.name}><CommandIcon command={row.command.name} /></span>
            <span className={styles.name}><Marked text={`/${row.command.name}`} length={row.matchLength ? row.matchLength + 1 : 0} /></span>
            <span className={styles.detail}>{row.command.description}</span>
          </button>
        )
      case 'value':
        return (
          <button
            key={rowKey(row, i)}
            type="button"
            role="option"
            aria-selected={active}
            className={`${cls} ${row.separator ? styles.separated : ''}`}
            onMouseDown={pick(row)}
          >
            {row.status && (
              <span className={styles.icon} style={{ color: row.status.color }}>
                <StatusIcon icon={row.status.icon || DEFAULT_STATUS_ICON} filled />
              </span>
            )}
            <span className={styles.name}><Marked text={row.label} length={row.matchLength} /></span>
            {row.note && <span className={styles.note}>{row.note}</span>}
            {row.detail && <span className={styles.value}>{row.detail}</span>}
          </button>
        )
      case 'parsed':
        return (
          <button
            key={rowKey(row, i)}
            type="button"
            role="option"
            aria-selected={active}
            className={`${cls} ${styles.parsed}`}
            onMouseDown={pick(row)}
          >
            <span className={styles.icon} data-command={view.command}>
              {view.command === 'followup' ? <FollowupFlagIcon /> : <CalendarIcon />}
            </span>
            <span className={styles.parsedDate}>{row.label}</span>
            <span className={styles.detail}>{row.relative}</span>
            <span className={styles.kbd} aria-hidden="true">⏎</span>
          </button>
        )
      case 'error':
        return (
          <div key={rowKey(row, i)} className={styles.error} role="alert">
            <div className={styles.errorText}>{row.text}</div>
            <div className={styles.errorHint}>{row.hint}</div>
          </div>
        )
    }
  }

  return (
    <div
      ref={popupRef}
      className={`${styles.popup} ${className ?? ''}`}
      style={style}
      role="listbox"
      aria-label={view.header}
      data-nlp-popup={view.mode}
      data-nlp-popup-id={popupId}
      // No right-click here reaches the host behind; only person / tag rows have a menu.
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation() }}
    >
      <div className={styles.header}>
        <span>{view.header}</span>
        {view.headerNote && <span className={styles.headerNote}>{view.headerNote}</span>}
      </div>
      {view.hint && <div className={styles.hint}>{view.hint}</div>}
      {view.rows.map(renderRow)}
      {view.footer && (
        <div className={styles.footer}>
          <span className={styles.kbd}>↑↓</span>
          <span className={styles.kbd}>⏎</span>
          <span>pick · or type the whole command</span>
        </div>
      )}
      {menu && entityMenu && (
        <PickerEntityMenu
          kind={menu.kind}
          id={menu.id}
          point={{ x: menu.x, y: menu.y }}
          onShowTasks={entityMenu.onShowTasks}
          onClose={closeMenu}
        />
      )}
    </div>
  )
}
