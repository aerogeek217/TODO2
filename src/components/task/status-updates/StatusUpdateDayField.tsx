import type { StatusUpdateDayInput } from '../../../hooks/use-status-update-day'
import { formatFollowupDate, relativeDayPhrase } from '../../../utils/followup'
import { FollowupDateButton } from '../../shared/followup/FollowupDateButton'
import followupStyles from '../../shared/followup/Followup.module.css'

/**
 * The day of a status update, as the task editor's Last follow-up field: a
 * text field that takes a date or words (`yesterday`, `mon`, `10/28`) with
 * the calendar button at its end (no day after today). Empty = today. ⏎
 * runs `onEnter`; the line after it says what the text means, or what's
 * wrong with it.
 */
export function StatusUpdateDayField({ input, label, today, onEnter }: {
  input: StatusUpdateDayInput
  /** The field's accessible name. */
  label: string
  today: Date
  onEnter: () => void
}) {
  const s = input.state
  return (
    <>
      <div className={`${followupStyles.editorInputWrap} ${s.kind === 'invalid' ? followupStyles.inputWrapError : ''}`}>
        <input
          className={followupStyles.input}
          value={input.text}
          placeholder="Today"
          onChange={(e) => input.change(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
            e.preventDefault()
            onEnter()
          }}
          aria-label={label}
          aria-invalid={s.kind === 'invalid'}
          autoComplete="off"
          spellCheck={false}
        />
        <FollowupDateButton
          label={`Pick ${label.charAt(0).toLowerCase()}${label.slice(1)}`}
          value={input.day === 'invalid' ? undefined : input.day}
          max={today}
          // A typed day like any other: the field keeps it until the entry is written.
          onPick={(d) => input.change(d ? formatFollowupDate(d, today) : '')}
        />
      </div>
      {s.kind === 'invalid' ? (
        <span className={`${followupStyles.editorHint} ${followupStyles.helpError}`}>{s.message}</span>
      ) : s.kind === 'valid' ? (
        <span className={followupStyles.editorHint}>
          → <strong className={followupStyles.helpDate}>{formatFollowupDate(s.date, today)}</strong>
          {' · '}{relativeDayPhrase(s.date, today)}
        </span>
      ) : null}
    </>
  )
}
