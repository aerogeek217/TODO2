import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../../data/database'
import type { PersistedTodoItem } from '../../../models'
import {
  applyCheckinUpdates,
  checkinAppliedMessage,
  checkinChangeKey,
  defaultCheckinSelection,
  selectedCheckinUpdates,
} from '../../../services/checkin-reply/apply'
import { diffCheckinReply, type CheckinReplyDiff } from '../../../services/checkin-reply/diff'
import { useSettingsStore } from '../../../stores/settings-store'
import { useTodoStore } from '../../../stores/todo-store'
import { useUndoStore } from '../../../stores/undo-store'
import { DEFAULT_FOLLOWUP_INTERVAL } from '../../../utils/followup'
import { checkinSampleTasks } from '../../fixtures/checkin-replies/sample-tasks'
import { editHtml, parse, sampleEmail } from './helpers'

const fixtures = import.meta.glob('../../fixtures/checkin-replies/synthetic-new-outlook-inline.*', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>
const fixture = (ext: string) => Object.entries(fixtures).find(([p]) => p.endsWith(ext))?.[1] ?? ''

// Tue 13 Oct 2026, 11:00 — the day after the sample email was sent.
const NOW = new Date(2026, 9, 13, 11)

let tasks: PersistedTodoItem[]

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  await db.delete()
  await db.open()
  tasks = checkinSampleTasks()
  await db.todos.bulkAdd(tasks)
  useTodoStore.setState({ todos: tasks, todosVersion: 0 })
  useSettingsStore.setState({ followupDefaultInterval: DEFAULT_FOLLOWUP_INTERVAL, defaultStatusId: null })
  useUndoStore.getState().clear()
})

afterEach(() => {
  useUndoStore.getState().clear()
  vi.useRealTimers()
})

/** The new-Outlook reply fixture: task 1 Progress, task 2 Completed, task 3 Notes. */
function fixtureDiff(): CheckinReplyDiff {
  const reply = parse({ html: fixture('.html'), plain: fixture('.txt') })
  return diffCheckinReply(reply, { todos: useTodoStore.getState().todos })
}

const mem = (id: number) => useTodoStore.getState().todos.find((t) => t.id === id)!
const row = async (id: number) => (await db.todos.get(id))!

describe('selection', () => {
  it('ticks every change by default; the ticked changes group per task', () => {
    const diff = fixtureDiff()
    const selected = defaultCheckinSelection(diff)
    expect([...selected].sort()).toEqual(['1:progress', '2:completed', '3:notes'])
    const updates = selectedCheckinUpdates(diff, selected)
    expect(updates.map((u) => ({ ...u, notes: u.notes?.split('\n').length }))).toEqual([
      { todoId: 1, complete: false, progress: 'section 4 done', changeCount: 1 },
      { todoId: 2, complete: true, changeCount: 1 },
      { todoId: 3, complete: false, notes: 5, changeCount: 1 },
    ])
  })

  it('a task changed in the app after the send date starts with nothing ticked', () => {
    useTodoStore.setState({ todos: tasks.map((t) => (t.id === 1 ? { ...t, modifiedAt: new Date(2026, 9, 13, 8) } : t)) })
    const diff = fixtureDiff()
    expect(diff.tasks.find((t) => t.todo.id === 1)?.stale).toBe(true)
    expect(defaultCheckinSelection(diff).has(checkinChangeKey(1, 'progress'))).toBe(false)
    expect(defaultCheckinSelection(diff).has(checkinChangeKey(2, 'completed'))).toBe(true)
  })

  it('emptied notes start unticked', () => {
    const email = sampleEmail()
    const html = editHtml(email.html, '0c4d8e17', 'Notes:', '&nbsp;')
    const diff = diffCheckinReply(parse({ html, plain: email.plain }), { todos: tasks })
    const notes = diff.tasks.find((t) => t.todo.id === 1)?.changes.find((c) => c.field === 'notes')
    expect(notes).toMatchObject({ field: 'notes', emptied: true, to: '' })
    expect(defaultCheckinSelection(diff).has(checkinChangeKey(1, 'notes'))).toBe(false)
  })

  it('unticked changes and tasks with none ticked are left out', () => {
    const diff = fixtureDiff()
    const updates = selectedCheckinUpdates(diff, new Set(['2:completed']))
    expect(updates).toEqual([{ todoId: 2, complete: true, changeCount: 1 }])
  })

  it('the snackbar text counts the changes', () => {
    expect(checkinAppliedMessage(1, 'Marcus Chen')).toBe('Applied 1 change from Marcus Chen')
    expect(checkinAppliedMessage(3, 'Marcus Chen')).toBe('Applied 3 changes from Marcus Chen')
  })
})

describe('applyCheckinUpdates', () => {
  it('completes, sets progress, replaces notes and records a follow-up on the updated tasks — one undo entry', async () => {
    const diff = fixtureDiff()
    const updates = selectedCheckinUpdates(diff, defaultCheckinSelection(diff))
    const expectedNotes = updates.find((u) => u.todoId === 3)?.notes

    const n = await applyCheckinUpdates(updates, { recordFollowup: true, personName: 'Marcus Chen' })
    expect(n).toBe(3)

    expect(mem(1).progress).toBe('section 4 done')
    expect(mem(2).isCompleted).toBe(true)
    expect(mem(3).notes).toBe(expectedNotes)
    expect((await row(1)).progress).toBe('section 4 done')
    expect((await row(2)).isCompleted).toBe(true)
    expect((await row(2)).completedAt).toEqual(NOW)
    expect((await row(3)).notes).toBe(expectedNotes)
    expect((await row(3)).notes).toContain('- Link the existing **DB checklist**')

    // Follow-up on the three updated tasks, not on task 4.
    for (const id of [1, 2, 3]) expect((await row(id)).lastFollowupAt).toEqual(NOW)
    expect((await row(4)).lastFollowupAt).toBeUndefined()
    expect((await row(4)).nextFollowupAt).toEqual(new Date(2026, 10, 1))

    // History: the completion is logged as for a manual edit.
    const events = await db.todoEvents.where('todoId').equals(2).toArray()
    expect(events.map((e) => e.type)).toEqual(['completed'])

    const undo = useUndoStore.getState()
    expect(undo.undoStack).toHaveLength(1)
    expect(undo.undoStack[0]?.description).toBe('Applied 3 changes from Marcus Chen')
    expect(undo.snackbar).toEqual({ description: 'Applied 3 changes from Marcus Chen' })
  })

  it('undo restores every task (old progress, notes, completion and follow-up dates); redo applies again', async () => {
    const diff = fixtureDiff()
    await applyCheckinUpdates(selectedCheckinUpdates(diff, defaultCheckinSelection(diff)), { recordFollowup: true, personName: 'Marcus Chen' })
    await useUndoStore.getState().undo()

    for (const original of tasks) {
      const stored = await row(original.id)
      for (const t of [stored, mem(original.id)]) {
        expect(t.progress).toBe(original.progress)
        expect(t.notes).toBe(original.notes)
        expect(t.isCompleted).toBe(false)
        expect(t.completedAt).toBeUndefined()
        expect(t.lastFollowupAt).toBeUndefined()
        expect(t.nextFollowupAt).toEqual(original.nextFollowupAt)
      }
    }
    expect((await db.todoEvents.where('todoId').equals(2).toArray()).map((e) => e.type)).toEqual(['completed', 'reopened'])

    await useUndoStore.getState().redo()
    expect((await row(1)).progress).toBe('section 4 done')
    expect((await row(2)).isCompleted).toBe(true)
    expect((await row(3)).notes).toContain('Nina confirmed Saturday')
    expect((await row(3)).lastFollowupAt).toEqual(NOW)
  })

  it('without "Record a follow-up", follow-up dates stay as they were', async () => {
    const diff = fixtureDiff()
    await applyCheckinUpdates(selectedCheckinUpdates(diff, defaultCheckinSelection(diff)), { recordFollowup: false, personName: 'Marcus Chen' })
    for (const t of tasks) expect((await row(t.id)).lastFollowupAt).toBeUndefined()
    expect(useUndoStore.getState().undoStack).toHaveLength(1)
  })

  it('applied emptied notes remove the notes', async () => {
    await applyCheckinUpdates([{ todoId: 1, complete: false, notes: '', changeCount: 1 }], { recordFollowup: false, personName: 'M' })
    expect((await row(1)).notes).toBeUndefined()
    expect(mem(1).notes).toBeUndefined()
    await useUndoStore.getState().undo()
    expect((await row(1)).notes).toBe(tasks[0]?.notes)
  })

  it('a repeating task moves to its next due date, as when completed in the app', async () => {
    const weekly = { ...tasks[1]!, recurrenceRule: { type: 'weekly' as const } }
    await db.todos.put(weekly)
    useTodoStore.setState({ todos: tasks.map((t) => (t.id === 2 ? weekly : t)) })
    await applyCheckinUpdates([{ todoId: 2, complete: true, changeCount: 1 }], { recordFollowup: false, personName: 'M' })
    const stored = await row(2)
    expect(stored.isCompleted).toBe(false)
    expect(stored.dueDate).toEqual(new Date(2026, 9, 21))
    await useUndoStore.getState().undo()
    expect((await row(2)).dueDate).toEqual(new Date(2026, 9, 14))
  })

  it('nothing ticked writes nothing and adds no undo entry', async () => {
    expect(await applyCheckinUpdates([], { recordFollowup: true, personName: 'M' })).toBe(0)
    expect(useUndoStore.getState().undoStack).toHaveLength(0)
  })
})
