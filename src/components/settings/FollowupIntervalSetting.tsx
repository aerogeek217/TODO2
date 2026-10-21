import { useState } from 'react'
import { useSettingsStore } from '../../stores/settings-store'
import {
  describeFollowupInterval,
  formatFollowupInterval,
  parseFollowupInterval,
} from '../../utils/followup'
import { SettingRow } from './sections/SettingRow'
import styles from './sections/sections.module.css'

/**
 * Settings → Task defaults: whether new tasks get a next follow-up, and the
 * follow-up interval (`1m`, `2w`, `10d`, `1y`). "Mark followed up" sets the
 * next follow-up to today + the interval, and so does creating a task while
 * the switch is on. The interval commits on Enter / blur; invalid text
 * reverts.
 */
export function FollowupIntervalSetting() {
  const newTaskFollowup = useSettingsStore((s) => s.newTaskFollowup)
  const setNewTaskFollowup = useSettingsStore((s) => s.setNewTaskFollowup)
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
        label="New tasks get a follow-up date"
        help="Off: a new task has no follow-up unless you give it one (/followup in Quick Add)."
      >
        <button
          type="button"
          role="switch"
          aria-checked={newTaskFollowup}
          aria-label="New tasks get a follow-up date"
          className={`${styles.switch} ${newTaskFollowup ? styles.switchOn : ''}`}
          onClick={() => void setNewTaskFollowup(!newTaskFollowup)}
        />
      </SettingRow>
      <SettingRow
        label="Follow-up interval"
        help={newTaskFollowup
          ? '“Mark followed up” sets the next follow-up this far ahead, and so does creating a task. Use d, w, m or y — e.g. 10d, 2w, 1m.'
          : '“Mark followed up” sets the next follow-up this far ahead. Use d, w, m or y — e.g. 10d, 2w, 1m.'}
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
    </>
  )
}
