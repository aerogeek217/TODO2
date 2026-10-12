import type { Person, PersistedTodoItem } from '../../../models'
import { buildCheckinEmail, type CheckinEmail } from '../../../services/checkin-email/build'
import { parseCheckinReply, type ParsedCheckinReply, type CheckinReplyInput } from '../../../services/checkin-reply/parse'
import { checkinSampleTasks } from '../../fixtures/checkin-replies/sample-tasks'
import { makePerson } from '../../helpers'

export const SENT_AT = new Date(2026, 9, 12, 9, 14)
export const marcus = makePerson({ id: 1, name: 'Marcus Chen', email: 'marcus.chen@example.com' })

/** The check-in email for the sample tasks (or `todos`), as sent on `sentAt`. */
export function sampleEmail(
  todos: PersistedTodoItem[] = checkinSampleTasks(),
  opts: { sentAt?: Date; includeNotes?: boolean; person?: Person & { id: number } } = {},
): CheckinEmail {
  const [first, ...rest] = todos
  return buildCheckinEmail(
    opts.person ?? marcus,
    { overdue: first ? [first] : [], comingUp: rest },
    { today: new Date(2026, 9, 12), assignedPeopleMap: new Map(todos.map((t) => [t.id, [marcus]])) },
    { includeNotes: opts.includeNotes ?? true, includeOthers: true, sentAt: opts.sentAt ?? SENT_AT },
  )
}

export function parse(input: CheckinReplyInput): ParsedCheckinReply {
  const result = parseCheckinReply(input)
  if (!result.ok) throw new Error(`parse failed: ${result.error}`)
  return result.reply
}

export type FieldLabel = 'Completed:' | 'Progress:' | 'Notes:'

/** The email HTML with one update cell (by task ref and label) replaced by `cellHtml`. */
export function editHtml(html: string, ref: string, label: FieldLabel, cellHtml: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const refCell = [...doc.querySelectorAll('td')].find((td) => td.textContent === `Ref ${ref}`)
  if (!refCell) throw new Error(`no ref ${ref}`)
  let table = refCell.closest('table')?.nextElementSibling ?? null
  while (table && table.tagName !== 'TABLE') table = table.nextElementSibling
  const row = [...(table?.querySelectorAll('tr') ?? [])].find((tr) => tr.cells[0]?.textContent === label)
  const cell = row?.cells[1]
  if (!cell) throw new Error(`no ${label} cell under ${ref}`)
  cell.innerHTML = cellHtml
  return doc.body.innerHTML
}

/**
 * The plain email with one update line (by task ref and label) replaced by
 * `lines`. For `Notes:`, the label line and every notes line after it are
 * replaced.
 */
export function editPlain(plain: string, ref: string, label: FieldLabel, lines: string[]): string {
  const all = plain.split('\n')
  const task = all.findIndex((l) => l.endsWith(`Ref ${ref}`))
  if (task < 0) throw new Error(`no ref ${ref}`)
  const at = all.findIndex((l, i) => i > task && l.startsWith(label))
  if (at < 0) throw new Error(`no ${label} under ${ref}`)
  let end = at + 1
  if (label === 'Notes:') while (end < all.length && (all[end] ?? '') !== '') end++
  all.splice(at, end - at, ...lines)
  return all.join('\n')
}
