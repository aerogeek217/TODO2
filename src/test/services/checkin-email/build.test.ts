import { describe, expect, it } from 'vitest'
import type { Person, PersistedTodoItem, Tag } from '../../../models'
import {
  CHECKIN_LABELS,
  buildCheckinEmail,
  checkinFirstName,
  checkinFooterLine,
  checkinSubject,
  type CheckinEmailContext,
  type CheckinEmailOptions,
} from '../../../services/checkin-email/build'
import { taskRef } from '../../../services/checkin-email/ref'
import type { CheckinSections } from '../../../services/checkin-email/select'
import { makePerson, makeTodo } from '../../helpers'

// Monday 12 Oct 2026.
const today = new Date(2026, 9, 12)
const day = (offset: number) => new Date(2026, 9, 12 + offset)
// Late evening local time: the footer must use the local date, not UTC.
const sentAt = new Date(2026, 9, 12, 23, 45)

const marcus = makePerson({ id: 1, name: 'Marcus Chen', email: 'marcus.chen@example.com' })
const sam = makePerson({ id: 2, name: 'Sam Ortiz' })
const security: Tag = { id: 1, name: 'security', color: '#fff' }
const northwind: Tag = { id: 2, name: 'Project: Northwind Rollout', color: '#fff' }

const UID1 = '0c4d8e17-5b2a-4f1e-9c3d-7a6b5c4d3e2f'
const UID2 = 'b71e05d9-1111-4222-8333-444455556666'
const UID3 = '3f9a1c42-aaaa-4bbb-8ccc-ddddeeeeffff'

function sample(): { sections: CheckinSections; ctx: CheckinEmailContext; todos: PersistedTodoItem[] } {
  const t1 = makeTodo({
    id: 1, uid: UID1, title: 'Answer Northwind’s security questionnaire', dueDate: day(-3), nextFollowupAt: day(0),
    progress: 'half done', notes: 'Sections 4 and 7 still open.\nSam has the SOC 2 letter.', statusId: 4,
  })
  const t2 = makeTodo({ id: 2, uid: UID2, title: 'Review the staging load-test results', dueDate: day(2), nextFollowupAt: day(0), progress: '40%', statusId: 4 })
  const t3 = makeTodo({
    id: 3, uid: UID3, title: 'Draft the migration runbook', dueDate: day(4), nextFollowupAt: day(1),
    notes: '- Cover the cutover sequence\n- **Rollback** steps', statusId: 5,
  })
  return {
    todos: [t1, t2, t3],
    sections: { overdue: [t1], comingUp: [t2, t3] },
    ctx: {
      today,
      assignedPeopleMap: new Map<number, Person[]>([[1, [marcus, sam]], [2, [marcus]], [3, [marcus]]]),
      assignedTagsMap: new Map([[1, [northwind, security]]]),
    },
  }
}

const ON: CheckinEmailOptions = { includeNotes: true, includeOthers: true, sentAt }

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html')
}

/** The table rows whose first cell starts with `<n>. ` (task heading rows). */
function headingRows(doc: Document): HTMLTableRowElement[] {
  return [...doc.querySelectorAll('tr')].filter((tr) => /^\d+\. /.test(tr.cells[0]?.textContent ?? ''))
}

/** The update tables: tables whose first cell is exactly "Your update". */
function updateTables(doc: Document): HTMLTableElement[] {
  return [...doc.querySelectorAll('table')].filter((t) => t.rows[0]?.cells[0]?.textContent?.trim() === CHECKIN_LABELS.update)
}

describe('checkin email basics', () => {
  it('subject counts open tasks', () => {
    expect(checkinSubject(3)).toBe('Task check-in: 3 open tasks')
    expect(checkinSubject(1)).toBe('Task check-in: 1 open task')
    expect(checkinSubject(0)).toBe('Task check-in: 0 open tasks')
    const { sections, ctx } = sample()
    const email = buildCheckinEmail(marcus, sections, ctx, ON)
    expect(email.subject).toBe('Task check-in: 3 open tasks')
    expect(email.to).toBe('marcus.chen@example.com')
  })

  it('greets by first name; a colon prefix keeps the whole name', () => {
    expect(checkinFirstName('Marcus Chen')).toBe('Marcus')
    expect(checkinFirstName('  Ada\n Lovelace ')).toBe('Ada')
    expect(checkinFirstName('Org: Northwind')).toBe('Org: Northwind')
    const { sections, ctx } = sample()
    const email = buildCheckinEmail(marcus, sections, ctx, ON)
    expect(email.plain.startsWith('Hi Marcus,\n')).toBe(true)
    expect(parse(email.html).body.textContent).toContain('Hi Marcus,')
  })

  it('footer line: person name and the local send date (ISO), in both forms', () => {
    expect(checkinFooterLine('Marcus  Chen', sentAt)).toBe('Check-in for Marcus Chen · sent 2026-10-12')
    const { sections, ctx } = sample()
    const email = buildCheckinEmail(marcus, sections, ctx, ON)
    const lines = email.plain.split('\n')
    expect(lines.at(-1)).toBe('Check-in for Marcus Chen · sent 2026-10-12')
    expect(lines).toContain('Thanks,')
    expect(lines.indexOf('Thanks,')).toBeLessThan(lines.length - 1)
    const doc = parse(email.html)
    expect(doc.body.textContent).toContain('Check-in for Marcus Chen · sent 2026-10-12')
    expect(doc.body.textContent).toMatch(/Thanks,[\s\S]*Check-in for Marcus Chen · sent 2026-10-12\s*$/)
  })
})

describe('sections and tasks', () => {
  it('Overdue first, then Coming up; numbering runs across sections', () => {
    const { sections, ctx } = sample()
    const email = buildCheckinEmail(marcus, sections, ctx, ON)
    const lines = email.plain.split('\n')
    const order = lines.filter((l) => l === 'Overdue' || l === 'Coming up' || /^\d+\. /.test(l))
    expect(order).toEqual([
      'Overdue',
      `1. Answer Northwind’s security questionnaire  Ref 0c4d8e17`,
      'Coming up',
      '2. Review the staging load-test results  Ref b71e05d9',
      '3. Draft the migration runbook  Ref 3f9a1c42',
    ])
    const text = parse(email.html).body.textContent ?? ''
    expect(text.indexOf('Overdue')).toBeLessThan(text.indexOf('1. Answer'))
    expect(text.indexOf('1. Answer')).toBeLessThan(text.indexOf('Coming up'))
    expect(text.indexOf('Coming up')).toBeLessThan(text.indexOf('2. Review'))
  })

  it('skips an empty section; no tasks → a no-tasks line and no update boxes', () => {
    const { sections, ctx } = sample()
    const comingOnly = buildCheckinEmail(marcus, { overdue: [], comingUp: sections.comingUp }, ctx, ON)
    expect(comingOnly.plain.split('\n')).not.toContain('Overdue')
    expect(comingOnly.plain).toContain('1. Review the staging')
    const none = buildCheckinEmail(marcus, { overdue: [], comingUp: [] }, ctx, ON)
    expect(none.plain).toContain('There are no open tasks I have assigned to you right now.')
    expect(updateTables(parse(none.html))).toHaveLength(0)
    expect(none.plain.split('\n').at(-1)).toBe('Check-in for Marcus Chen · sent 2026-10-12')
  })

  it('title and ref share one line (plain) and one table row (HTML); every task has its ref', () => {
    const { sections, ctx, todos } = sample()
    const email = buildCheckinEmail(marcus, sections, ctx, ON)
    const rows = headingRows(parse(email.html))
    expect(rows).toHaveLength(3)
    rows.forEach((tr, i) => {
      const todo = todos[i]!
      expect(tr.cells[0]?.textContent).toBe(`${i + 1}. ${todo.title}`)
      expect(tr.cells[1]?.textContent).toBe(`Ref ${taskRef(todo.uid)}`)
    })
    for (const t of todos) expect(email.plain).toMatch(new RegExp(`^\\d+\\. .+  Ref ${taskRef(t.uid)}$`, 'm'))
  })

  it('uses the given ref lookup', () => {
    const { sections, ctx } = sample()
    const email = buildCheckinEmail(marcus, sections, { ...ctx, refOf: (uid) => `r${uid.slice(0, 8)}x` }, ON)
    expect(email.plain).toContain('Ref r0c4d8e17x')
    expect(email.html).toContain('Ref r0c4d8e17x')
  })

  it('meta line: due (with days overdue), next follow-up, tags, also assigned', () => {
    const { sections, ctx } = sample()
    const email = buildCheckinEmail(marcus, sections, ctx, ON)
    const lines = email.plain.split('\n')
    expect(lines).toContain('Due Fri, Oct 9 (3 days overdue) · Next follow-up Today · Tags #Project: Northwind Rollout  #security · Also assigned Sam Ortiz')
    expect(lines).toContain('Due Wed, Oct 14 · Next follow-up Today')
    expect(lines).toContain('Due Fri, Oct 16 · Next follow-up Tue, Oct 13')
    expect(email.html).toContain('(3 days overdue)')
    // The overdue due date is red; the others are not.
    const metaCells = [...parse(email.html).querySelectorAll('td[colspan="2"]')].filter((td) => td.textContent?.startsWith('Due'))
    expect(metaCells[0]?.querySelector('span[style*="#b42318"]')?.textContent).toBe('Due Fri, Oct 9 (3 days overdue)')
    expect(metaCells[1]?.querySelector('span[style*="#b42318"]')).toBeNull()
  })

  it('one day overdue is singular; another year shows the year; no dates → no meta line', () => {
    const t = makeTodo({ id: 9, uid: UID1, dueDate: day(-1), nextFollowupAt: new Date(2027, 0, 5) })
    const bare = makeTodo({ id: 10, uid: UID2, title: 'Bare' })
    const email = buildCheckinEmail(marcus, { overdue: [t], comingUp: [bare] }, { today, assignedPeopleMap: new Map() }, ON)
    expect(email.plain).toContain('Due Sun, Oct 11 (1 day overdue) · Next follow-up Tue, Jan 5, 2027')
    const lines = email.plain.split('\n')
    expect(lines[lines.indexOf('2. Bare  Ref b71e05d9') + 1]).toBe('Your update')
  })

  it('Also assigned lists the others only when asked, never the recipient', () => {
    const { sections, ctx } = sample()
    const on = buildCheckinEmail(marcus, sections, ctx, ON)
    expect(on.plain).toContain('Also assigned Sam Ortiz')
    expect(on.plain).not.toMatch(/Also assigned.*Marcus/)
    const off = buildCheckinEmail(marcus, sections, ctx, { ...ON, includeOthers: false })
    expect(off.plain).not.toContain('Also assigned')
    expect(off.html).not.toContain('Also assigned')
  })
})

describe('update box', () => {
  it('each task: Your update, an empty Completed box, Progress, Notes — in that order', () => {
    const { sections, ctx } = sample()
    const email = buildCheckinEmail(marcus, sections, ctx, ON)
    const tables = updateTables(parse(email.html))
    expect(tables).toHaveLength(3)
    for (const table of tables) {
      const labels = [...table.rows].slice(1).map((r) => r.cells[0]?.textContent)
      expect(labels).toEqual(['Completed:', 'Progress:', 'Notes:'])
      expect(table.rows[1]?.cells[1]?.textContent).toBe('[ ]')
    }
    expect(tables[0]?.rows[2]?.cells[1]?.textContent).toBe('half done')
    expect(tables[2]?.rows[2]?.cells[1]?.textContent).toBe(' ')
    const plain = email.plain.split('\n')
    expect(plain.filter((l) => l === 'Your update')).toHaveLength(3)
    expect(plain.filter((l) => l === 'Completed: [ ]')).toHaveLength(3)
    expect(plain).toContain('Progress: half done')
    expect(plain).toContain('Progress: 40%')
    // Empty progress: the label stands alone.
    const i3 = plain.indexOf('3. Draft the migration runbook  Ref 3f9a1c42')
    expect(plain.slice(i3 + 2, i3 + 6)).toEqual(['Your update', 'Completed: [ ]', 'Progress:', 'Notes:'])
  })

  it('notes: Markdown rendered in HTML, raw in plain text; empty notes → empty cell', () => {
    const { sections, ctx } = sample()
    const email = buildCheckinEmail(marcus, sections, ctx, ON)
    const tables = updateTables(parse(email.html))
    const notes1 = tables[0]?.rows[3]?.cells[1]
    expect([...(notes1?.querySelectorAll('p') ?? [])].map((p) => p.textContent)).toEqual([
      'Sections 4 and 7 still open.',
      'Sam has the SOC 2 letter.',
    ])
    const notes3 = tables[2]?.rows[3]?.cells[1]
    expect([...(notes3?.querySelectorAll('li') ?? [])].map((li) => li.textContent)).toEqual(['Cover the cutover sequence', 'Rollback steps'])
    expect(notes3?.querySelector('strong')?.textContent).toBe('Rollback')
    expect(tables[1]?.rows[3]?.cells[1]?.textContent).toBe(' ')
    const plain = email.plain.split('\n')
    const n1 = plain.indexOf('Notes:')
    expect(plain.slice(n1 + 1, n1 + 3)).toEqual(['Sections 4 and 7 still open.', 'Sam has the SOC 2 letter.'])
    expect(plain).toContain('- **Rollback** steps')
  })

  it('notes off: no Notes row and no Notes label', () => {
    const { sections, ctx } = sample()
    const email = buildCheckinEmail(marcus, sections, ctx, { ...ON, includeNotes: false })
    for (const table of updateTables(parse(email.html))) {
      expect([...table.rows].slice(1).map((r) => r.cells[0]?.textContent)).toEqual(['Completed:', 'Progress:'])
    }
    expect(email.plain.split('\n')).not.toContain('Notes:')
    expect(email.plain).not.toContain('Sections 4 and 7')
    expect(email.html).not.toContain('Sections 4 and 7')
  })

  it('never mentions a status', () => {
    const { sections, ctx } = sample()
    const email = buildCheckinEmail(marcus, sections, ctx, ON)
    for (const body of [email.plain, email.html]) {
      expect(body).not.toMatch(/status/i)
      expect(body).not.toContain('Waiting')
    }
  })
})

describe('escaping', () => {
  const evil = '<script>alert(1)</script>'

  it('escapes titles, progress, notes, tags, names and the footer', () => {
    const person = makePerson({ id: 1, name: `Eve ${evil}`, email: 'eve@example.com' })
    const other = makePerson({ id: 2, name: `<img src=x onerror=alert(1)>` })
    const t = makeTodo({
      id: 1, uid: UID1, title: `Fix ${evil} & "quotes"`, progress: `50% ${evil}`,
      notes: `${evil}\n- [link](javascript:alert(1))\n<b onmouseover=x>bold</b>`,
    })
    const ctx: CheckinEmailContext = {
      today,
      assignedPeopleMap: new Map([[1, [person, other]]]),
      assignedTagsMap: new Map([[1, [{ id: 1, name: evil, color: '#fff' }]]]),
    }
    const email = buildCheckinEmail(person, { overdue: [], comingUp: [t] }, ctx, ON)
    expect(email.html).not.toMatch(/<script/i)
    expect(email.html).not.toMatch(/<img/i)
    expect(email.html).not.toMatch(/<b onmouseover/i)
    expect(email.html).not.toContain('javascript:')
    const doc = parse(email.html)
    expect(doc.querySelectorAll('script, img, [onerror], [onmouseover]')).toHaveLength(0)
    expect(headingRows(doc)[0]?.cells[0]?.textContent).toBe(`1. Fix ${evil} & "quotes"`)
    expect(doc.body.textContent).toContain(`Check-in for Eve ${evil} · sent 2026-10-12`)
    expect(doc.body.textContent).toContain(`Also assigned <img src=x onerror=alert(1)>`)
    expect(doc.querySelector('a')?.getAttribute('href')).toBe('#')
    // Plain text is text: the characters are kept as typed.
    expect(email.plain).toContain(`1. Fix ${evil} & "quotes"  Ref 0c4d8e17`)
  })

  it('a title or name with line breaks stays on one line', () => {
    const person = makePerson({ id: 1, name: 'Ada\r\nLovelace' })
    const t = makeTodo({ id: 1, uid: UID1, title: 'Line one\nYour update\r\nCompleted: [x]', progress: 'a\nb' })
    const email = buildCheckinEmail(person, { overdue: [], comingUp: [t] }, { today, assignedPeopleMap: new Map() }, ON)
    const lines = email.plain.split('\n')
    expect(lines).toContain('1. Line one Your update Completed: [x]  Ref 0c4d8e17')
    expect(lines).toContain('Progress: a b')
    expect(lines.filter((l) => l === 'Your update')).toHaveLength(1)
    expect(lines.at(-1)).toBe('Check-in for Ada Lovelace · sent 2026-10-12')
    expect(email.to).toBe('')
  })
})

describe('email-safe HTML', () => {
  it('tables and inline styles only: no classes, style blocks, images, flex or grid', () => {
    const { sections, ctx } = sample()
    const { html } = buildCheckinEmail(marcus, sections, ctx, ON)
    expect(html).not.toMatch(/\sclass=/)
    expect(html).not.toMatch(/<style|<img|<script|<link/i)
    expect(html).not.toMatch(/display:\s*(flex|grid)/)
    expect(html).toContain('font-family: Aptos, Calibri')
    // One wrapping element.
    const doc = parse(html)
    expect(doc.body.children).toHaveLength(1)
    expect(doc.body.firstElementChild?.tagName).toBe('DIV')
  })
})
