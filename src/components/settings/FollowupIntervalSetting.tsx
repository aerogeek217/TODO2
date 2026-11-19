import { useState } from 'react'
import { useSettingsStore } from '../../stores/settings-store'
import {
  describeFollowupInterval,
  formatFollowupInterval,
  formatQuickFollowupIntervals,
  MAX_QUICK_FOLLOWUP_INTERVALS,
  parseFollowupInterval,
  parseQuickFollowupIntervals,
} from '../../utils/followup'
import { SettingRow } from './sections/SettingRow'
import styles from './sections/sections.module.css'

/**
 * Settings › Tasks › New tasks: "Set a next follow-up automatically" and the
 * follow-up interval (`1m`, `2w`, `10d`, `1y`). While the switch is on, new
 * tasks and "Mark followed up" set the next follow-up to today + the
 * interval; off, new tasks get none and Mark followed up clears it. Either
 * way Mark followed up keeps a next follow-up after today
 * (`utils/followup.nextAfterFollowup`). The interval commits on Enter /
 * blur; invalid text reverts. Then the quick intervals
 * ({@link QuickIntervalsRow}).
 */
export function FollowupIntervalSetting() {
  const autoFollowup = useSettingsStore((s) => s.autoFollowup)
  const setAutoFollowup = useSettingsStore((s) => s.setAutoFollowup)
  const interval = useSettingsStore((s) => s.followupDefaultInterval)
  const setInterval = useSettingsStore((s) => s.setFollowupDefaultInterval)
  const stored = formatFollowupInterval(interval)
  const [draft, setDraft] = useState(stored)
  const [syncedFrom, setSyncedFrom] = useState(stored)
  if (stored !== syncedFrom) {
    setSyncedFrom(stored)
    setDraft(stored)
  }

  const parsed = parseFollowupInterval(draft)

  const commit = () => {
    if (!parsed) {
      setDraft(stored)
      return
    }
    const canonical = formatFollowupInterval(parsed)
    setDraft(canonical)
    if (canonical !== stored) void setInterval(parsed)
  }

  return (
    <>
      <SettingRow
        label="Set a next follow-up automatically"
        help="New tasks and Mark followed up set it to today + the interval. Off: new tasks get none, and Mark followed up clears it. Either way, Mark followed up keeps a next follow-up that’s after today."
      >
        <button
          type="button"
          role="switch"
          aria-checked={autoFollowup}
          aria-label="Set a next follow-up automatically"
          className={`${styles.switch} ${autoFollowup ? styles.switchOn : ''}`}
          onClick={() => void setAutoFollowup(!autoFollowup)}
        />
      </SettingRow>
      <SettingRow
        label="Follow-up interval"
        help={autoFollowup
          ? 'How far ahead new tasks and “Mark followed up” set the next follow-up. Use d, w, m or y — e.g. 10d, 2w, 1m.'
          : 'Used while Set a next follow-up automatically is on. Use d, w, m or y — e.g. 10d, 2w, 1m.'}
      >
        <input
          type="text"
          className={styles.input}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            // Esc reverts a changed draft and stays in Settings; with nothing
            // to revert it reaches the modal, which closes.
            if (e.key === 'Escape' && draft !== stored) {
              e.preventDefault()
              e.stopPropagation()
              setDraft(stored)
            }
          }}
          aria-label="Follow-up interval"
          aria-invalid={!parsed}
          placeholder="1m"
          style={{ width: 64, textAlign: 'right' }}
          spellCheck={false}
          autoComplete="off"
        />
        {parsed && (
          <span className={styles.muted} aria-live="polite">{describeFollowupInterval(parsed)}</span>
        )}
      </SettingRow>
      <QuickIntervalsRow />
    </>
  )
}

/**
 * "Quick follow-up intervals": the chips beside every next follow-up date
 * (the task editor, the follow-up popover, the review card), the task
 * menu's Follow-up › and `/followup`'s rows — 1 to 6 intervals typed as
 * `1d 1w 1m 3m`. Commits on Enter / blur; text that doesn't read reverts.
 */
function QuickIntervalsRow() {
  const intervals = useSettingsStore((s) => s.followupQuickIntervals)
  const setIntervals = useSettingsStore((s) => s.setFollowupQuickIntervals)
  const stored = formatQuickFollowupIntervals(intervals)
  const [draft, setDraft] = useState(stored)
  const [syncedFrom, setSyncedFrom] = useState(stored)
  if (stored !== syncedFrom) {
    setSyncedFrom(stored)
    setDraft(stored)
  }
  const parsed = parseQuickFollowupIntervals(draft)

  const commit = () => {
    if (!parsed) {
      setDraft(stored)
      return
    }
    const canonical = formatQuickFollowupIntervals(parsed)
    setDraft(canonical)
    if (canonical !== stored) void setIntervals(parsed)
  }

  return (
    <SettingRow
      label="Quick follow-up intervals"
      help={`The intervals offered beside every next follow-up date, in the task menu and after /followup. Up to ${MAX_QUICK_FOLLOWUP_INTERVALS}, with spaces between — e.g. 1d 1w 1m 3m.`}
    >
      <input
        type="text"
        className={styles.input}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          // Esc reverts a changed draft and stays in Settings; with nothing to revert it reaches the modal.
          if (e.key === 'Escape' && draft !== stored) {
            e.preventDefault()
            e.stopPropagation()
            setDraft(stored)
          }
        }}
        aria-label="Quick follow-up intervals"
        aria-invalid={!parsed}
        placeholder="1d 1w 1m 3m"
        style={{ width: 140 }}
        spellCheck={false}
        autoComplete="off"
      />
    </SettingRow>
  )
}
