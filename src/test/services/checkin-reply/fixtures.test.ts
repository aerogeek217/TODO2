/**
 * Every reply capture in `src/test/fixtures/checkin-replies/`: a `<name>.html`
 * and / or `<name>.txt` (the paste's `text/html` / `text/plain` flavours) —
 * a reply to the sample check-in email (`sample-tasks.ts`). Dropping a new
 * pair into the folder adds it here. Without a `<name>.expected.json`, a
 * capture is checked for the general contract (footer read, refs match the
 * sample tasks, the HTML and plain-text readings agree); with one, the
 * expected blocks, changes and merged notes are checked too.
 */
import { describe, expect, it } from 'vitest'
import { diffCheckinReply, notesLineKey, replyNotesLines } from '../../../services/checkin-reply/diff'
import { parseCheckinReply, type CheckinReplyBlock, type ParsedCheckinReply } from '../../../services/checkin-reply/parse'
import { checkinSampleTasks } from '../../fixtures/checkin-replies/sample-tasks'

const files = import.meta.glob('../../fixtures/checkin-replies/*.{html,txt,json}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

interface ExpectedBlock {
  ref: string
  completed?: boolean
  progress?: string
  /** Comparison keys of the reply's notes lines; null = no Notes row. */
  notes?: string[] | null
}

interface Expected {
  personName?: string
  sentDate?: string
  blocks: ExpectedBlock[]
  /** Changed fields per ref. */
  changes?: Record<string, string[]>
  /** The merged notes per ref, per flavour read. */
  notesTo?: { html?: Record<string, string>; plain?: Record<string, string> }
}

interface Capture {
  name: string
  html?: string
  plain?: string
  expected?: Expected
}

function captures(): Capture[] {
  const byName = new Map<string, Capture>()
  for (const [path, content] of Object.entries(files)) {
    const m = /\/([^/]+?)(\.expected\.json|\.html|\.txt)$/.exec(path)
    if (!m?.[1] || !m[2]) continue
    const capture = byName.get(m[1]) ?? { name: m[1] }
    if (m[2] === '.html') capture.html = content
    else if (m[2] === '.txt') capture.plain = content
    else capture.expected = JSON.parse(content) as Expected
    byName.set(m[1], capture)
  }
  return [...byName.values()].filter((c) => c.html !== undefined || c.plain !== undefined)
}

function parsed(input: { html?: string; plain: string }): ParsedCheckinReply {
  const result = parseCheckinReply(input)
  if (!result.ok) throw new Error(`parse failed: ${result.error}`)
  return result.reply
}

function noteKeys(block: CheckinReplyBlock): string[] | null {
  return replyNotesLines(block)?.map(notesLineKey) ?? null
}

/** What both flavours must agree on. */
function summary(reply: ParsedCheckinReply) {
  return reply.blocks.map((b) => ({ ref: b.ref, completed: b.completed, progress: b.progress, notes: noteKeys(b) }))
}

const all = captures()

describe('check-in reply captures', () => {
  it('finds the synthetic captures', () => {
    expect(all.map((c) => c.name)).toEqual(expect.arrayContaining([
      'synthetic-new-outlook-inline',
      'synthetic-classic-outlook-inline',
      'synthetic-classic-outlook-plain-quoted',
    ]))
  })

  describe.each(all.map((c) => [c.name, c] as const))('%s', (_name, capture) => {
    const flavours: { kind: 'html' | 'plain'; input: { html?: string; plain: string } }[] = []
    if (capture.html !== undefined) flavours.push({ kind: 'html', input: { html: capture.html, plain: capture.plain ?? '' } })
    if (capture.plain !== undefined) flavours.push({ kind: 'plain', input: { plain: capture.plain } })

    it.each(flavours.map((f) => [f.kind, f] as const))('reads the %s flavour', (kind, flavour) => {
      const reply = parsed(flavour.input)
      expect(reply.source).toBe(kind)
      expect(reply.personName).toBeTruthy()
      expect(reply.sentDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(reply.blocks.length).toBeGreaterThan(0)

      const todos = checkinSampleTasks()
      const diff = diffCheckinReply(reply, { todos })
      expect(diff.unmatched).toEqual([])
      expect(diff.tasks.map((t) => t.ref)).toEqual(reply.blocks.map((b) => b.ref))

      const expected = capture.expected
      if (!expected) return
      if (expected.personName) expect(reply.personName).toBe(expected.personName)
      if (expected.sentDate) expect(reply.sentDate).toBe(expected.sentDate)
      expect(summary(reply)).toEqual(expected.blocks.map((b) => ({
        ref: b.ref, completed: b.completed, progress: b.progress, notes: b.notes ?? null,
      })))
      if (expected.changes) {
        const changed = Object.fromEntries(diff.tasks.map((t) => [t.ref, t.changes.map((c) => c.field)]))
        expect(changed).toEqual(expected.changes)
      }
      for (const [ref, to] of Object.entries(expected.notesTo?.[kind] ?? {})) {
        const notes = diff.tasks.find((t) => t.ref === ref)?.changes.find((c) => c.field === 'notes')
        expect(notes && 'to' in notes ? notes.to : undefined).toBe(to)
      }
    })

    if (capture.html !== undefined && capture.plain !== undefined) {
      it('reads the same updates from both flavours', () => {
        const html = parsed({ html: capture.html, plain: capture.plain ?? '' })
        const plain = parsed({ plain: capture.plain ?? '' })
        expect(summary(plain)).toEqual(summary(html))
        expect({ personName: plain.personName, sentDate: plain.sentDate })
          .toEqual({ personName: html.personName, sentDate: html.sentDate })
      })
    }
  })
})
