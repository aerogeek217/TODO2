/**
 * Sending one check-in email: hands the built email to the mail app the way
 * Settings says (`checkinOpenMethod`). Recording the follow-up is the
 * caller's job (it only happens when the handoff worked).
 */
import type { CheckinOpenMethod } from '../../utils/checkin-settings'
import { downloadTextFile } from '../save-file'
import type { CheckinEmail } from './build'
import { buildEml, buildMailtoUrl, checkinEmlFileName, copyCheckinRich, openMailtoLink } from './handoff'

/**
 * `opened` — the body is on the clipboard and the `mailto:` link was opened;
 * `downloaded` — the `.eml` draft was downloaded; `copy-failed` — the
 * clipboard refused the body, so nothing was opened.
 */
export type CheckinSendResult = 'opened' | 'downloaded' | 'copy-failed'

export interface SendCheckinInput {
  email: CheckinEmail
  /** The recipient's name (the `.eml` To display name and file name). */
  personName: string
  method: CheckinOpenMethod
  /** When the email was built (the `.eml` file name's date). */
  sentAt: Date
}

/**
 * Hands one check-in email to the mail app. Call it straight from the click
 * handler, before any `await`: the clipboard write needs the click's user
 * gesture.
 * - `mailto`: puts the body on the clipboard (rich HTML + plain text) first,
 *   then opens the `mailto:` link (To + Subject); the user pastes the body.
 *   If the clipboard refuses, the link isn't opened.
 * - `eml`: downloads `Check-in - <name> - <date>.eml`, an unsent draft.
 */
export async function sendCheckinEmail({ email, personName, method, sentAt }: SendCheckinInput): Promise<CheckinSendResult> {
  if (method === 'eml') {
    const eml = buildEml({ to: email.to, toName: personName, subject: email.subject, html: email.html, plain: email.plain })
    downloadTextFile(eml, checkinEmlFileName(personName, sentAt), 'message/rfc822')
    return 'downloaded'
  }
  const copied = await copyCheckinRich(email.html, email.plain)
  if (!copied) return 'copy-failed'
  openMailtoLink(buildMailtoUrl(email.to, email.subject))
  return 'opened'
}
