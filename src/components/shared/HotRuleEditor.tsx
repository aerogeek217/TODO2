import { useMemo, useState } from 'react'
import { MARKER_KEYS, type MarkerKey, type MarkerSet } from '../../models'
import { useSettingsStore } from '../../stores/settings-store'
import { useTodoStore } from '../../stores/todo-store'
import { useToday } from '../../hooks/use-today'
import {
  DEFAULT_HOT_RULE,
  hotRulesEqual,
  isHot,
  lineMarkers,
  matchesHotLine,
  normalizeHotRule,
  type HotRule,
} from '../../utils/hot'
import { MARKER_LABELS } from '../../utils/markers'
import { FocusIcon, ImportantIcon, UrgentIcon } from './MarkerIcons'
import styles from './HotRuleEditor.module.css'

const CHIP_ON_CLASS: Record<MarkerKey, string | undefined> = {
  urgent: styles.chipUrgentOn,
  important: styles.chipImportantOn,
  focus: styles.chipFocusOn,
}

function ChipIcon({ marker, on }: { marker: MarkerKey; on: boolean }) {
  switch (marker) {
    case 'urgent': return <UrgentIcon />
    case 'important': return <ImportantIcon outline={!on} />
    case 'focus': return <FocusIcon />
  }
}

function hasAnyMarker(lines: readonly MarkerSet[]): boolean {
  return lines.some((line) => lineMarkers(line).length > 0)
}

/** `4 open tasks are hot right now.` */
function totalLine(n: number) {
  if (n === 0) return <>No open tasks are hot right now.</>
  return <><b>{n} open {n === 1 ? 'task' : 'tasks'}</b> {n === 1 ? 'is' : 'are'} hot right now.</>
}

/**
 * Editor for the app-wide Hot rule: lines joined by "or", each an AND of
 * marker toggles (Urgent / Important / Focus), with each line's live count of
 * open tasks, the total, `+ Or…` and `Reset to default`. Every change saves at
 * once. A new line starts empty and is stored once it has a marker; the
 * rule always keeps at least one marker.
 *
 * `variant="flyout"` is the compact form for a menu flyout (the dashboard
 * tab menu's `Hot is ›`): a heading, the lines without per-line counts, then
 * `+ Or…` beside the total and a note that the rule is app-wide.
 */
export function HotRuleEditor({ variant = 'settings' }: { variant?: 'settings' | 'flyout' }) {
  const flyout = variant === 'flyout'
  const rule = useSettingsStore((s) => s.hotRule)
  const setHotRule = useSettingsStore((s) => s.setHotRule)
  const urgentRange = useSettingsStore((s) => s.urgentDueWithinDays)
  const todos = useTodoStore((s) => s.todos)
  const today = useToday()

  // The lines on screen: the stored rule plus lines still being picked
  // (empty, or duplicates the store collapses). Re-synced when the stored
  // rule changes elsewhere (React's "adjust state when a prop changes").
  const [draft, setDraft] = useState<readonly MarkerSet[]>(rule)
  const [syncedFrom, setSyncedFrom] = useState<HotRule>(rule)
  if (rule !== syncedFrom) {
    setSyncedFrom(rule)
    setDraft((prev) => (hotRulesEqual(normalizeHotRule(prev), rule) ? prev : rule))
  }

  const openTodos = useMemo(() => todos.filter((t) => !t.isCompleted), [todos])
  const lineCounts = useMemo(
    () => draft.map((line) => openTodos.filter((t) => matchesHotLine(t, line, today, urgentRange)).length),
    [draft, openTodos, today, urgentRange],
  )
  const total = useMemo(
    () => openTodos.filter((t) => isHot(t, draft, today, urgentRange)).length,
    [draft, openTodos, today, urgentRange],
  )

  const commit = (next: readonly MarkerSet[]) => {
    setDraft(next)
    const normalized = normalizeHotRule(next)
    if (normalized.length > 0 && !hotRulesEqual(normalized, rule)) void setHotRule(normalized)
  }

  const toggle = (index: number, key: MarkerKey) => {
    commit(draft.map((line, i) => {
      if (i !== index) return line
      const next: MarkerSet = { ...line }
      if (next[key] === true) delete next[key]
      else next[key] = true
      return next
    }))
  }

  const removeLine = (index: number) => commit(draft.filter((_, i) => i !== index))

  const addLine = (
    <button type="button" className={styles.addLine} onClick={() => setDraft([...draft, {}])}>
      <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden>
        <path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      Or…
    </button>
  )

  return (
    <div className={`${styles.editor} ${flyout ? styles.flyout : ''}`}>
      {flyout && <div className={styles.heading}>Hot when a task has all markers of any line</div>}
      {draft.map((line, index) => {
        const markers = lineMarkers(line)
        const others = draft.filter((_, i) => i !== index)
        // The rule keeps at least one marker: its only lit chip can't go out,
        // and a line can't be removed when the others have none.
        const lastMarker = markers.length === 1 && !hasAnyMarker(others)
        const canRemove = draft.length > 1 && hasAnyMarker(others)
        return (
          <div key={index} className={styles.lineWrap}>
            {index > 0 && <div className={styles.or}>or</div>}
            <div className={styles.line} role="group" aria-label={`Hot rule line ${index + 1}`}>
              {!flyout && <span className={styles.hasAll}>Has all</span>}
              {MARKER_KEYS.map((key) => {
                const on = line[key] === true
                const locked = on && lastMarker
                return (
                  <button
                    key={key}
                    type="button"
                    className={`${styles.chip} ${on ? CHIP_ON_CLASS[key] ?? '' : ''}`}
                    aria-pressed={on}
                    aria-disabled={locked || undefined}
                    title={locked ? 'The Hot rule needs at least one marker.' : undefined}
                    onClick={() => { if (!locked) toggle(index, key) }}
                  >
                    <ChipIcon marker={key} on={on} />
                    {MARKER_LABELS[key]}
                  </button>
                )
              })}
              <span className={styles.count}>
                {flyout ? '' : markers.length > 0 ? `${lineCounts[index] ?? 0} now` : 'Pick markers'}
              </span>
              {canRemove ? (
                <button
                  type="button"
                  className={styles.remove}
                  aria-label={`Remove line ${index + 1}`}
                  onClick={() => removeLine(index)}
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden>
                    <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                </button>
              ) : (
                <span className={styles.removeSlot} aria-hidden />
              )}
            </div>
          </div>
        )
      })}
      {flyout ? (
        <>
          <div className={styles.flyoutFooter}>
            {addLine}
            <span className={styles.hotNow} data-testid="hot-rule-total">{total} hot now</span>
          </div>
          <div className={styles.footnote}>One rule for the whole app; also in Settings › Task Defaults.</div>
        </>
      ) : (
        <>
          {addLine}
          <div className={styles.footer}>
            <span className={styles.total} data-testid="hot-rule-total">{totalLine(total)}</span>
            <button
              type="button"
              className={styles.reset}
              onClick={() => commit(DEFAULT_HOT_RULE)}
            >
              Reset to default
            </button>
          </div>
        </>
      )}
    </div>
  )
}
