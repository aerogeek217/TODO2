import { useState } from 'react'
import { useSettingsStore } from '../../stores/settings-store'
import {
  describeFollowupInterval,
  formatFollowupInterval,
  parseFollowupInterval,
} from '../../utils/followup'

interface FollowupIntervalSettingProps {
  rowClassName?: string
  labelClassName?: string
  inputClassName?: string
  hintClassName?: string
}

/**
 * Settings → Task defaults row for the default follow-up interval (`1m`,
 * `2w`, `10d`, `1y`). New tasks and "Followed up" set the next follow-up to
 * today + this. Commits on Enter / blur; invalid text reverts.
 */
export function FollowupIntervalSetting({
  rowClassName, labelClassName, inputClassName, hintClassName,
}: FollowupIntervalSettingProps) {
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
    <div
      className={rowClassName}
      title="New tasks get a next follow-up this far ahead; “Followed up” moves it on by the same amount. Use d, w, m or y — e.g. 10d, 2w, 1m."
    >
      <span className={labelClassName}>Default follow-up for new tasks</span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        {parsed && (
          <span className={hintClassName} aria-live="polite">{describeFollowupInterval(parsed)}</span>
        )}
        <input
          type="text"
          className={inputClassName}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            if (e.key === 'Escape') setDraft(stored)
          }}
          aria-label="Default follow-up interval"
          aria-invalid={!parsed}
          placeholder="1m"
          style={{ width: 64, textAlign: 'right' }}
          spellCheck={false}
          autoComplete="off"
        />
      </span>
    </div>
  )
}
