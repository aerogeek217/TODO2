import { describe, expect, it } from 'vitest'
import type { PersistedTodoItem } from '../../../models'
import {
  CHECKIN_PROGRESS_MAX,
  diffCheckinReply,
  diffNotes,
  isChangedSince,
  notesLineKey,
  type CheckinChange,
  type CheckinReplyDiff,
} from '../../../services/checkin-reply/diff'
import type { ParsedCheckinReply } from '../../../services/checkin-reply/parse'
import { checkinSampleTasks } from '../../fixtures/checkin-replies/sample-tasks'
import { editHtml, editPlain, parse, sampleEmail } from './helpers'

function changesOf(diff: CheckinReplyDiff, ref: string): CheckinChange[] {
  const task = diff.tasks.find((t) => t.ref === ref)
  if (!task) throw new Error(`no task ${ref}`)
  return task.changes
}

function notesChange(diff: CheckinReplyDiff, ref: string) {
  const change = changesOf(diff, ref).find((c) => c.field === 'notes')
  if (!change || change.field !== 'notes') throw new Error(`no notes change for ${ref}`)
  return change
}

function reply(blocks: ParsedCheckinReply['blocks'], extra: Partial<ParsedCheckinReply> = {}): ParsedCheckinReply {
  return { blocks, source: 'plain', orphanUpdates: 0, sentDate: '2026-10-12', personName: 'Marcus Chen', ...extra }
}

describe('diffCheckinReply — an unedited reply', () => {
  it.each(['html', 'plain'] as const)('%s: proposes nothing (formatting round trip included)', (flavour) => {
    const email = sampleEmail()
    const parsed = parse(flavour === 'html' ? { html: email.html, plain: email.plain } : { plain: email.plain })
    const diff = diffCheckinReply(parsed, { todos: checkinSampleTasks() })
    expect(diff.tasks).toHaveLength(4)
    expect(diff.changeCount).toBe(0)
    expect(diff.unmatched).toEqual([])
    expect(diff.staleCount).toBe(0)
    expect(diff).toMatchObject({ personName: 'Marcus Chen', sentDate: '2026-10-12', blockCount: 4 })
  })

  it('proposes nothing for notes with headings, bullets, checkboxes, links and blank lines', () => {
    const notes = '## PLAN\n\nIntro with *emphasis* and `code`.\n\n* star bullet\n- [x] done item\n- [ ] open item\n- see [the doc](https://example.com/a?b=1&c=2)\n\n1. numbered line'
    const todos = checkinSampleTasks().map((t) => (t.id === 3 ? { ...t, notes } : t))
    const email = sampleEmail(todos)
    for (const input of [{ html: email.html, plain: email.plain }, { plain: email.plain }]) {
      expect(diffCheckinReply(parse(input), { todos }).changeCount).toBe(0)
    }
  })
})

describe('Completed', () => {
  it('a marked box completes an open task; an empty box proposes nothing', () => {
    const plain = editPlain(sampleEmail().plain, 'b71e05d9', 'Completed:', ['Completed: [x]'])
    const diff = diffCheckinReply(parse({ plain }), { todos: checkinSampleTasks() })
    expect(changesOf(diff, 'b71e05d9')).toEqual([{ field: 'completed', defaultSelected: true }])
    expect(changesOf(diff, '0c4d8e17')).toEqual([])
  })

  it('never reopens: a task completed since the email is listed with no changes', () => {
    const todos = checkinSampleTasks().map((t) => (t.id === 2 ? { ...t, isCompleted: true, completedAt: new Date(2026, 9, 12, 15) } : t))
    let plain = editPlain(sampleEmail().plain, 'b71e05d9', 'Completed:', ['Completed: [ ]'])
    plain = editPlain(plain, 'b71e05d9', 'Progress:', ['Progress: 90%'])
    const diff = diffCheckinReply(parse({ plain }), { todos })
    const task = diff.tasks.find((t) => t.ref === 'b71e05d9')
    expect(task).toMatchObject({ completedSinceSent: true, changes: [] })
  })
})

describe('Progress', () => {
  const todos = checkinSampleTasks()
  const progressOf = (value: string, current?: string) => {
    const list = current === undefined ? todos : todos.map((t) => (t.id === 1 ? { ...t, progress: current } : t))
    const diff = diffCheckinReply(reply([{ ref: '0c4d8e17', progress: value }]), { todos: list })
    return changesOf(diff, '0c4d8e17')
  }

  it('a new value is a change from the current one', () => {
    expect(progressOf('section 4 done')).toEqual([{ field: 'progress', from: 'half done', to: 'section 4 done', defaultSelected: true }])
  })

  it('the same text (whitespace aside) is no change', () => {
    expect(progressOf('  half   done ')).toEqual([])
    expect(progressOf('half done', 'half\ndone')).toEqual([])
  })

  it('an empty value never clears it', () => {
    expect(progressOf('')).toEqual([])
    expect(progressOf(' ')).toEqual([])
  })

  it('is one line, capped like the editor', () => {
    const [change] = progressOf(`${'a'.repeat(CHECKIN_PROGRESS_MAX)}\nmore`)
    expect(change).toMatchObject({ field: 'progress', to: 'a'.repeat(CHECKIN_PROGRESS_MAX) })
    const [multi] = progressOf('line one\n  line two')
    expect(multi).toMatchObject({ to: 'line one line two' })
  })
})

describe('Notes', () => {
  const runbook = checkinSampleTasks()[2]?.notes ?? ''

  it('one edited line in formatted notes: the other lines keep their Markdown', () => {
    const email = sampleEmail()
    const html = editHtml(email.html, '3f9a1c42', 'Notes:', [
      '<p class="MsoNormal">Cover the cutover sequence, rollback steps and who is on call.<o:p></o:p></p>',
      '<ul type="disc"><li class="MsoListParagraph" style="mso-list:l0 level1 lfo1">Link the existing <b><span>DB checklist</span></b><o:p></o:p></li>',
      '<li class="MsoListParagraph">Ask Nina about the <a href="https://example.com/runbook"><span style="color:#0563C1">rollback window</span></a> by Friday<o:p></o:p></li>',
      '<li class="MsoListParagraph"><span style="font-family:\'Segoe UI Symbol\'">☐</span> Dry run on staging<o:p></o:p></li></ul>',
    ].join(''))
    const change = notesChange(diffCheckinReply(parse({ html, plain: '' }), { todos: checkinSampleTasks() }), '3f9a1c42')
    expect(change.to).toBe([
      'Cover the cutover sequence, rollback steps and who is on call.',
      '- Link the existing **DB checklist**',
      '- Ask Nina about the [rollback window](https://example.com/runbook) by Friday',
      '- [ ] Dry run on staging',
    ].join('\n'))
    expect(change.lines).toEqual([
      { op: '=', text: 'Cover the cutover sequence, rollback steps and who is on call.' },
      { op: '=', text: '- Link the existing **DB checklist**' },
      { op: '-', text: '- Ask Nina about the [rollback window](https://example.com/runbook)' },
      { op: '+', text: '- Ask Nina about the [rollback window](https://example.com/runbook) by Friday' },
      { op: '=', text: '- [ ] Dry run on staging' },
    ])
    expect(change).toMatchObject({ from: runbook, emptied: false, defaultSelected: true })
  })

  it('keeps blank lines between kept lines and adds new lines where they were typed', () => {
    const change = diffNotes('First para.\n\nSecond para.\nThird.', ['First para.', 'Inserted.', 'Second para.', 'Third.'])
    expect(change?.to).toBe('First para.\nInserted.\n\nSecond para.\nThird.')
    expect(change?.lines.map((l) => l.op)).toEqual(['=', '+', '=', '='])
  })

  it('emptied notes are a change that starts unticked', () => {
    const plain = editPlain(sampleEmail().plain, '3f9a1c42', 'Notes:', ['Notes:'])
    const change = notesChange(diffCheckinReply(parse({ plain }), { todos: checkinSampleTasks() }), '3f9a1c42')
    expect(change).toMatchObject({ to: '', emptied: true, defaultSelected: false })
    expect(change.lines.every((l) => l.op === '-')).toBe(true)
  })

  it('notes added to a task without notes', () => {
    const plain = editPlain(sampleEmail().plain, 'b71e05d9', 'Notes:', ['Notes:', 'Rerun scheduled for Thursday.'])
    const change = notesChange(diffCheckinReply(parse({ plain }), { todos: checkinSampleTasks() }), 'b71e05d9')
    expect(change).toMatchObject({ from: '', to: 'Rerun scheduled for Thursday.', emptied: false, lines: [{ op: '+', text: 'Rerun scheduled for Thursday.' }] })
  })

  it('no Notes row (notes left out of the email) proposes nothing', () => {
    const email = sampleEmail(undefined, { includeNotes: false })
    const diff = diffCheckinReply(parse({ html: email.html, plain: email.plain }), { todos: checkinSampleTasks() })
    expect(diff.changeCount).toBe(0)
  })

  it('a pasted script never reaches the notes; script-like text stays literal text', () => {
    const email = sampleEmail()
    const html = editHtml(email.html, '0c4d8e17', 'Notes:', '<p>Sections 4 and 7 still open.</p><script>alert(1)</script><p>Sam has the SOC 2 letter.</p><p>&lt;img src=x onerror=alert(1)&gt;</p>')
    const change = notesChange(diffCheckinReply(parse({ html, plain: '' }), { todos: checkinSampleTasks() }), '0c4d8e17')
    expect(change.to).toBe('Sections 4 and 7 still open.\nSam has the SOC 2 letter.\n<img src=x onerror=alert(1)>')
    expect(change.to).not.toContain('alert(1)</')
  })

  it('compares visible text: emphasis, link targets and bullet glyphs don’t count', () => {
    expect(notesLineKey('- Ask about the [window](https://a.example/x)')).toBe('Ask about the window')
    expect(notesLineKey('• **Bold** and *it* and `code`')).toBe('Bold and it and code')
    expect(notesLineKey('- ☐ Dry run')).toBe(notesLineKey('- [ ] Dry run'))
    expect(notesLineKey('- [x] Done')).not.toBe(notesLineKey('- [ ] Done'))
    expect(notesLineKey('## Heading')).toBe('Heading')
  })

  it('stays fast on huge notes', () => {
    const old = Array.from({ length: 3000 }, (_, i) => `old line ${i}`).join('\n')
    const next = Array.from({ length: 3000 }, (_, i) => `new line ${i}`)
    const start = performance.now()
    const change = diffNotes(old, next)
    expect(performance.now() - start).toBeLessThan(5000)
    expect(change?.lines).toHaveLength(6000)
  })
})

describe('stale tasks (changed in the app since the email)', () => {
  const edited = () => {
    let plain = editPlain(sampleEmail().plain, '0c4d8e17', 'Completed:', ['Completed: [x]'])
    plain = editPlain(plain, '0c4d8e17', 'Progress:', ['Progress: section 4 done'])
    plain = editPlain(plain, '0c4d8e17', 'Notes:', ['Notes:', 'All sections done.'])
    return parse({ plain })
  }
  const withModified = (modifiedAt: Date): PersistedTodoItem[] =>
    checkinSampleTasks().map((t) => (t.id === 1 ? { ...t, modifiedAt } : t))

  it('modified on a later day: flagged, every change unticked', () => {
    const diff = diffCheckinReply(edited(), { todos: withModified(new Date(2026, 9, 13, 0, 5)) })
    const task = diff.tasks.find((t) => t.ref === '0c4d8e17')
    expect(task?.stale).toBe(true)
    expect(task?.changes.map((c) => [c.field, c.defaultSelected])).toEqual([['completed', false], ['progress', false], ['notes', false]])
    expect(diff.staleCount).toBe(1)
  })

  it('modified on the send day (sending records a follow-up): not flagged', () => {
    const diff = diffCheckinReply(edited(), { todos: withModified(new Date(2026, 9, 12, 23, 50)) })
    const task = diff.tasks.find((t) => t.ref === '0c4d8e17')
    expect(task?.stale).toBe(false)
    expect(task?.changes.every((c) => c.defaultSelected)).toBe(true)
  })

  it('without a footer date nothing is flagged', () => {
    expect(isChangedSince({ modifiedAt: new Date(2030, 0, 1) }, undefined)).toBe(false)
    expect(isChangedSince({ modifiedAt: new Date(2026, 9, 13) }, '2026-10-12')).toBe(true)
    expect(isChangedSince({ modifiedAt: new Date(2026, 9, 12, 23, 59) }, '2026-10-12')).toBe(false)
  })
})

describe('refs', () => {
  it('lists refs that match no task (deleted) or several, with the title from the reply', () => {
    const todos = [
      ...checkinSampleTasks().filter((t) => t.id !== 4),
      { ...checkinSampleTasks()[1]!, id: 7, uid: 'abcdef12-0000-4000-8000-000000000001' },
      { ...checkinSampleTasks()[1]!, id: 8, uid: 'abcdef12-0000-4000-8000-000000000002' },
    ]
    const parsed = reply([
      { ref: '9e8d7c6b', title: 'Renew the Contoso support contract' },
      { ref: 'abcdef12', title: 'Twin' },
      { ref: 'b71e05d9', completed: true },
    ])
    const diff = diffCheckinReply(parsed, { todos })
    expect(diff.unmatched).toEqual([
      { ref: '9e8d7c6b', title: 'Renew the Contoso support contract', reason: 'not-found' },
      { ref: 'abcdef12', title: 'Twin', reason: 'ambiguous' },
    ])
    expect(diff.tasks.map((t) => t.ref)).toEqual(['b71e05d9'])
    expect(diff.blockCount).toBe(3)
  })

  it('a task named by two refs (short and lengthened) is listed once, by the first', () => {
    const parsed = reply([
      { ref: 'b71e05d9', progress: 'first' },
      { ref: 'b71e05d91111', progress: 'second' },
    ])
    const diff = diffCheckinReply(parsed, { todos: checkinSampleTasks() })
    expect(diff.tasks).toHaveLength(1)
    expect(changesOf(diff, 'b71e05d9')).toEqual([{ field: 'progress', from: '40%', to: 'first', defaultSelected: true }])
  })
})

describe('notesLineKey on long pathological lines', () => {
  it('stays linear on a long run of `[` (a crafted reply line)', () => {
    const line = '['.repeat(200_000)
    const start = performance.now()
    expect(notesLineKey(line)).toBe(line)
    expect(notesLineKey(`x${'[]('.repeat(50_000)}`)).toBe(`x${'[]('.repeat(50_000)}`)
    expect(performance.now() - start).toBeLessThan(1000)
  })

  it('still keys links as their text', () => {
    expect(notesLineKey('- see [the doc](https://x.com) and [](u)')).toBe('see the doc and')
  })
})
