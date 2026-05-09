import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  buildTasksHtml,
  buildTasksPlain,
  copyTasksRich,
  type CopyTaskContext,
} from '../../services/task-copy'
import { makeTodo, makePerson } from '../helpers'
import type { Status } from '../../models'

function ctx(overrides: Partial<CopyTaskContext> = {}): CopyTaskContext {
  return {
    assignedPeopleMap: new Map(),
    statusMap: new Map(),
    today: new Date(2026, 3, 23),
    ...overrides,
  }
}

describe('buildTasksPlain', () => {
  it('renders a flat list (no label) one line per todo', () => {
    const todos = [
      makeTodo({ id: 1, title: 'One' }),
      makeTodo({ id: 2, title: 'Two', isCompleted: true }),
    ]
    const out = buildTasksPlain([{ todos }], ctx())
    expect(out).toBe('[ ] One\n[x] Two')
  })

  it('emits section headings for labelled sections', () => {
    const out = buildTasksPlain(
      [
        { label: 'Overdue', todos: [makeTodo({ id: 1, title: 'Late' })] },
        { label: 'Today', todos: [makeTodo({ id: 2, title: 'Now' })] },
      ],
      ctx(),
    )
    expect(out).toContain('== Overdue ==')
    expect(out).toContain('== Today ==')
    expect(out).toContain('[ ] Late')
    expect(out).toContain('[ ] Now')
  })

  it('skips empty sections', () => {
    const out = buildTasksPlain(
      [
        { label: 'Empty', todos: [] },
        { label: 'Has', todos: [makeTodo({ id: 1, title: 'X' })] },
      ],
      ctx(),
    )
    expect(out).not.toContain('Empty')
    expect(out).toContain('== Has ==')
  })

  it('includes status, scheduled, deadline, and people annotations', () => {
    const statusMap = new Map<number, Status>([[7, { id: 7, name: 'Doing', color: '#fff', sortOrder: 0 }]])
    const assignedPeopleMap = new Map([[1, [makePerson({ id: 1, name: 'Ada' }), makePerson({ id: 2, name: 'Bob' })]]])
    const todo = makeTodo({
      id: 1,
      title: 'Meeting',
      statusId: 7,
      scheduledDate: { kind: 'fuzzy', token: 'today', setAt: new Date(2026, 3, 23) },
      dueDate: new Date(2026, 3, 25),
    })
    const out = buildTasksPlain([{ todos: [todo] }], ctx({ statusMap, assignedPeopleMap }))
    expect(out).toContain('[ ] Meeting')
    expect(out).toContain('[Doing]')
    expect(out).toContain('(sched: Today)')
    expect(out).toContain('(deadline')
    expect(out).toContain('@Ada, @Bob')
  })
})

describe('buildTasksHtml', () => {
  it('renders a flat <ul> for an unlabeled section', () => {
    const todos = [makeTodo({ id: 1, title: 'One' }), makeTodo({ id: 2, title: 'Two', isCompleted: true })]
    const html = buildTasksHtml([{ todos }], ctx())
    expect(html).toMatch(/^<ul>/)
    expect(html).toContain('<li>☐ One</li>')
    expect(html).toContain('<li>☑ Two</li>')
    expect(html.endsWith('</ul>')).toBe(true)
    expect(html).not.toContain('<h2>')
  })

  it('renders <h2> headings for labelled sections', () => {
    const html = buildTasksHtml(
      [{ label: 'Group A', todos: [makeTodo({ id: 1, title: 'X' })] }],
      ctx(),
    )
    expect(html).toContain('<h2>Group A</h2>')
    expect(html).toContain('<li>☐ X</li>')
  })

  it('escapes HTML special characters in titles and labels', () => {
    const html = buildTasksHtml(
      [{ label: '<danger>', todos: [makeTodo({ id: 1, title: '<script>alert(1)</script>' })] }],
      ctx(),
    )
    expect(html).toContain('&lt;danger&gt;')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
  })

  it('emits nothing (no <ul>) when every section is empty', () => {
    const html = buildTasksHtml([{ label: 'Empty', todos: [] }], ctx())
    expect(html).toBe('')
  })
})

describe('copyTasksRich', () => {
  let writeSpy: ReturnType<typeof vi.fn>
  let writeTextSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    writeSpy = vi.fn().mockResolvedValue(undefined)
    writeTextSpy = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { write: writeSpy, writeText: writeTextSpy },
    })
    class StubClipboardItem {
      constructor(public data: unknown) {}
    }
    ;(globalThis as unknown as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem = StubClipboardItem as unknown as typeof ClipboardItem
  })

  it('writes a ClipboardItem with both text/html and text/plain', async () => {
    const todos = [makeTodo({ id: 1, title: 'A' })]
    const ok = await copyTasksRich([{ todos }], ctx())
    expect(ok).toBe(true)
    expect(writeSpy).toHaveBeenCalledTimes(1)
    expect(writeTextSpy).not.toHaveBeenCalled()
    const arg = writeSpy.mock.calls[0]![0] as Array<{ data: Record<string, Blob> }>
    const kinds = Object.keys(arg[0]!.data)
    expect(kinds).toContain('text/html')
    expect(kinds).toContain('text/plain')
  })

  it('falls back to writeText when ClipboardItem.write rejects', async () => {
    writeSpy.mockRejectedValueOnce(new Error('denied'))
    const todos = [makeTodo({ id: 1, title: 'A' })]
    const ok = await copyTasksRich([{ todos }], ctx())
    expect(ok).toBe(true)
    expect(writeTextSpy).toHaveBeenCalledTimes(1)
  })

  it('returns false when both paths reject', async () => {
    writeSpy.mockRejectedValueOnce(new Error('denied'))
    writeTextSpy.mockRejectedValueOnce(new Error('denied'))
    const ok = await copyTasksRich([{ todos: [makeTodo({ id: 1, title: 'A' })] }], ctx())
    expect(ok).toBe(false)
  })

  it('renders only the todos the caller passes (completed filter is caller-owned)', async () => {
    // Caller chose to include a completed task — helper must render it.
    const open = makeTodo({ id: 1, title: 'Open' })
    const done = makeTodo({ id: 2, title: 'Done', isCompleted: true })
    await copyTasksRich([{ todos: [open, done] }], ctx())
    const arg = writeSpy.mock.calls[0]![0] as Array<{ data: Record<string, Blob> }>
    const htmlBlob = arg[0]!.data['text/html']
    const html = await htmlBlob!.text()
    expect(html).toContain('Open')
    expect(html).toContain('Done')
    expect(html).toContain('☑')
  })
})
