import type { CSSProperties, Ref } from 'react'
import type { AutocompleteRow, AutocompleteView } from '../../services/nlp-autocomplete'
import { CalendarIcon, CommandIcon } from './CommandIcons'
import { FollowupFlagIcon } from './FollowupIcons'
import { StatusIcon } from './StatusIcon'
import { DEFAULT_STATUS_ICON } from '../../models'
import styles from './NlpPopup.module.css'

interface NlpPopupProps {
  view: AutocompleteView
  selectedIndex: number
  onPick: (row: AutocompleteRow) => void
  /** Positioning: the host anchors the popup (portal + fixed, or absolute). */
  className?: string
  style?: CSSProperties
  popupRef?: Ref<HTMLDivElement>
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
 * Presentational: rows are picked on mousedown (so the input keeps focus);
 * keys are the host's (`hooks/use-nlp-autocomplete`).
 */
export function NlpPopup({ view, selectedIndex, onPick, className, style, popupRef }: NlpPopupProps) {
  const pick = (row: AutocompleteRow) => (e: React.MouseEvent) => {
    e.preventDefault() // keep focus in the input
    onPick(row)
  }

  const renderRow = (row: AutocompleteRow, i: number) => {
    const active = i === selectedIndex
    const cls = `${styles.item} ${active ? styles.active : ''}`
    switch (row.kind) {
      case 'entity':
        return (
          <button key={rowKey(row, i)} type="button" role="option" aria-selected={active} className={cls} onMouseDown={pick(row)}>
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
    </div>
  )
}
