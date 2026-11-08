import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { EditorView } from '@codemirror/view'
import { ReviewDeck } from '../../../components/overlays/ReviewDeck'
import { ConfirmPromptHost } from '../../../components/overlays/ConfirmPromptHost'
import { todoRepository } from '../../../data'
import { statusUpdateRepository } from '../../../data/status-update-repository'
import { useReviewStore } from '../../../stores/review-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useStatusUpdateStore } from '../../../stores/status-update-store'
import { useTodoStore } from '../../../stores/todo-store'
import { useUIStore } from '../../../stores/ui-store'
import { useUndoStore } from '../../../stores/undo-store'
import { addDays, startOfDay, startOfToday } from '../../../utils/date'
import { resetDb } from '../../helpers'
import { addTask } from '../../add-task'

/**
 * The review deck's card writes and keys (D26), as far as JSDOM shows them:
 * Mark followed up with and without the update line, with the Next field
 * untouched / set / not a date; the notes written first; Skip and Back
 * writing nothing; the keys; the queue rail. Focus handoffs with the editor
 * on top, and Esc through it, are the real browser's (`e2e/review-deck.spec.ts`).
 */

let ids: number[] = []

beforeEach(async () => {
  await resetDb()
  useSettingsStore.setState({ autoFollowup: false })
  ids = []
  for (const title of ['Answer Northwind', 'Map integration points', 'Retention addendum']) ids.push(await addTask(title))
  useUndoStore.getState().clear()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

async function openDeck(over: { ids?: number[] } = {}) {
  useReviewStore.getState().start({
    source: { kind: 'list', title: 'Aisha 1:1', description: 'list · Manual' },
    ids: over.ids ?? ids,
  })
  render(<><ReviewDeck /><ConfirmPromptHost /></>)
  await act(async () => { await Promise.resolve() })
}

const todo = (id: number) => useTodoStore.getState().todos.find((t) => t.id === id)
const updateField = () => screen.getByLabelText('Status update · today')
const nextField = () => screen.getByLabelText('Next follow-up')
const cardTitle = () => screen.getByTestId('review-card-title').textContent
const markButton = () => screen.getByRole('button', { name: 'Mark followed up' })
const railRow = (title: string) => within(screen.getByRole('navigation', { name: 'Review queue' })).getByRole('button', { name: new RegExp(`^${title}`) })
const sameDay = (a: Date | undefined, b: Date) => !!a && startOfDay(a).getTime() === startOfDay(b).getTime()
const [FIRST, SECOND] = ['Answer Northwind', 'Map integration points']

describe('the review deck', () => {
  it('a labelled dialog: the source, k of N, the first card with its update line focused', async () => {
    await openDeck()
    expect(screen.getByRole('dialog', { name: 'Aisha 1:1' })).toBeInTheDocument()
    expect(screen.getByTestId('review-position')).toHaveTextContent('1 of 3')
    expect(screen.getByTestId('review-followed-up')).toHaveTextContent('0 followed up')
    expect(cardTitle()).toBe(FIRST)
    expect(updateField()).toHaveFocus()
    expect(railRow(FIRST)).toHaveAttribute('aria-current', 'true')
    expect(railRow(SECOND)).not.toHaveAttribute('aria-current')
  })

  it('⏎ in the update line: followed up today with the entry, one undo step; then the next card, its line focused', async () => {
    const [first] = ids as [number]
    await openDeck()
    fireEvent.change(updateField(), { target: { value: 'Legal has it, back Thursday' } })
    expect(screen.getByTestId('review-hint')).toHaveTextContent(/^With the update · /)
    fireEvent.keyDown(updateField(), { key: 'Enter' })
    expect(cardTitle()).toBe(SECOND)
    expect(updateField()).toHaveFocus()
    expect(updateField()).toHaveValue('')
    await waitFor(() => expect(sameDay(todo(first)?.lastFollowupAt, startOfToday())).toBe(true))
    await waitFor(() => expect(useStatusUpdateStore.getState().byTodo.get(first)?.map((u) => [u.text, u.followedUp]))
      .toEqual([['Legal has it, back Thursday', true]]))
    expect(useUndoStore.getState().undoStack.map((e) => e.description)).toEqual(['Followed up · status update added'])
    expect(railRow(FIRST)).toHaveAttribute('data-mark', 'done')
    expect(screen.getByTestId('review-followed-up')).toHaveTextContent('1 followed up')
  })

  it('no text, the Next field untouched: Mark followed up only — a next follow-up after today kept', async () => {
    const [first] = ids as [number]
    const later = addDays(startOfToday(), 5)
    await useTodoStore.getState().update(first, { nextFollowupAt: later })
    useUndoStore.getState().clear()
    await openDeck()
    fireEvent.click(markButton())
    await waitFor(() => expect(sameDay(todo(first)?.lastFollowupAt, startOfToday())).toBe(true))
    expect(sameDay(todo(first)?.nextFollowupAt, later)).toBe(true)
    expect(useStatusUpdateStore.getState().byTodo.get(first) ?? []).toEqual([])
    await waitFor(() => expect(useUndoStore.getState().undoStack.map((e) => e.description)).toEqual([expect.stringMatching(/^Followed up/)]))
  })

  it('the Next field set: Mark followed up writes its date', async () => {
    const [first] = ids as [number]
    await openDeck()
    fireEvent.change(nextField(), { target: { value: '2w' } })
    expect(screen.getByTestId('review-hint')).toHaveTextContent(/^Next /)
    fireEvent.click(markButton())
    await waitFor(() => expect(sameDay(todo(first)?.lastFollowupAt, startOfToday())).toBe(true))
    expect(sameDay(todo(first)?.nextFollowupAt, addDays(startOfToday(), 14))).toBe(true)
  })

  it('the Next field emptied: no next follow-up', async () => {
    const [first] = ids as [number]
    await useTodoStore.getState().update(first, { nextFollowupAt: addDays(startOfToday(), 5) })
    await openDeck()
    fireEvent.change(nextField(), { target: { value: '' } })
    fireEvent.click(markButton())
    await waitFor(() => expect(sameDay(todo(first)?.lastFollowupAt, startOfToday())).toBe(true))
    expect(todo(first)?.nextFollowupAt).toBeUndefined()
  })

  it('the Next field not a date: Mark followed up is off, ⏎ writes nothing and the card stays', async () => {
    const [first] = ids as [number]
    const followUps = vi.spyOn(useTodoStore.getState(), 'markFollowedUp')
    await openDeck()
    fireEvent.change(nextField(), { target: { value: 'whenever' } })
    expect(markButton()).toBeDisabled()
    fireEvent.change(updateField(), { target: { value: 'Waiting' } })
    fireEvent.keyDown(updateField(), { key: 'Enter' })
    expect(cardTitle()).toBe(FIRST)
    expect(followUps).not.toHaveBeenCalled()
    expect(todo(first)?.lastFollowupAt).toBeUndefined()
  })

  it('⏎ in the Next field sets that date only, and hands the focus to the update line', async () => {
    const [first] = ids as [number]
    await openDeck()
    fireEvent.change(nextField(), { target: { value: '1w' } })
    fireEvent.keyDown(nextField(), { key: 'Enter' })
    await waitFor(() => expect(sameDay(todo(first)?.nextFollowupAt, addDays(startOfToday(), 7))).toBe(true))
    expect(todo(first)?.lastFollowupAt).toBeUndefined()
    expect(updateField()).toHaveFocus()
    expect(cardTitle()).toBe(FIRST)
  })

  it('a quick button sets the next follow-up at once; None clears it', async () => {
    const [first] = ids as [number]
    await openDeck()
    fireEvent.click(screen.getByRole('button', { name: 'Follow up in 1 month' }))
    await waitFor(() => expect(todo(first)?.nextFollowupAt).toBeDefined())
    fireEvent.click(screen.getByRole('button', { name: 'No next follow-up' }))
    await waitFor(() => expect(todo(first)?.nextFollowupAt).toBeUndefined())
    expect(todo(first)?.lastFollowupAt).toBeUndefined()
  })

  it('the notes typed so far are written first, as their own undo step', async () => {
    const [first] = ids as [number]
    await openDeck()
    const view = EditorView.findFromDOM(document.querySelector('.cm-editor') as HTMLElement)
    if (!view) throw new Error('no notes editor')
    act(() => view.dispatch({ changes: { from: 0, insert: 'Ask infra about the cost' } }))
    fireEvent.change(updateField(), { target: { value: 'Infra says a second region' } })
    fireEvent.keyDown(updateField(), { key: 'Enter' })
    await waitFor(() => expect(useUndoStore.getState().undoStack).toHaveLength(2))
    expect(todo(first)?.notes).toBe('Ask infra about the cost')
    const [notesStep, followUpStep] = useUndoStore.getState().undoStack
    expect(followUpStep?.description).toBe('Followed up · status update added')
    expect(notesStep?.description).not.toMatch(/Followed up/)
  })

  it('Skip and Back write nothing; a typed update waits for its card', async () => {
    const todoWrites = [vi.spyOn(todoRepository, 'update'), vi.spyOn(todoRepository, 'bulkUpdate')]
    const entryWrites = [vi.spyOn(statusUpdateRepository, 'add'), vi.spyOn(statusUpdateRepository, 'addMany')]
    await openDeck()
    fireEvent.change(updateField(), { target: { value: 'Half typed' } })
    fireEvent.click(screen.getByRole('button', { name: /^Skip/ }))
    expect(cardTitle()).toBe(SECOND)
    expect(railRow(FIRST)).toHaveAttribute('data-mark', 'skipped')
    fireEvent.click(screen.getByRole('button', { name: /^Back/ }))
    expect(cardTitle()).toBe(FIRST)
    expect(updateField()).toHaveValue('Half typed')
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    for (const w of [...todoWrites, ...entryWrites]) expect(w).not.toHaveBeenCalled()
    expect(useUndoStore.getState().undoStack).toEqual([])
  })

  it('a click on a rail row jumps to it', async () => {
    await openDeck()
    fireEvent.click(railRow('Retention addendum'))
    expect(cardTitle()).toBe('Retention addendum')
    expect(screen.getByTestId('review-position')).toHaveTextContent('3 of 3')
  })

  it('keys: Alt + → / ← anywhere skip / go back; J / K / S outside a text field', async () => {
    await openDeck()
    fireEvent.keyDown(updateField(), { key: 'ArrowRight', altKey: true })
    expect(cardTitle()).toBe(SECOND)
    expect(railRow(FIRST)).toHaveAttribute('data-mark', 'skipped')
    fireEvent.keyDown(updateField(), { key: 'ArrowLeft', altKey: true })
    expect(cardTitle()).toBe(FIRST)
    // In a text field the letters are text.
    fireEvent.keyDown(updateField(), { key: 'j' })
    expect(cardTitle()).toBe(FIRST)
    // Stepping from the rail: the focus stays there, on the current row.
    railRow(FIRST).focus()
    fireEvent.keyDown(railRow(FIRST), { key: 'j' })
    expect(cardTitle()).toBe(SECOND)
    expect(railRow(SECOND)).toHaveFocus()
    fireEvent.keyDown(railRow(SECOND), { key: 'k' })
    expect(cardTitle()).toBe(FIRST)
    expect(railRow(FIRST)).toHaveFocus()
    fireEvent.keyDown(railRow(FIRST), { key: 's' })
    expect(cardTitle()).toBe(SECOND)
    expect(railRow(FIRST)).toHaveAttribute('data-mark', 'skipped')
  })

  it('Esc closes the deck', async () => {
    await openDeck()
    fireEvent.keyDown(updateField(), { key: 'Escape' })
    expect(useReviewStore.getState().open).toBe(false)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('×, with only spaces typed, closes at once (nothing to lose)', async () => {
    await openDeck()
    fireEvent.change(updateField(), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Close review' }))
    expect(useReviewStore.getState().open).toBe(false)
  })

  it('closing with an update typed asks first; Keep reviewing keeps the text and the focus in its line', async () => {
    await openDeck()
    fireEvent.change(updateField(), { target: { value: 'Legal has it' } })
    fireEvent.keyDown(updateField(), { key: 'Escape' })
    const prompt = await screen.findByRole('dialog', { name: 'Discard the unrecorded update?' })
    expect(prompt).toHaveTextContent('The update typed for “Answer Northwind” hasn’t been recorded. Nothing is marked followed up.')
    // Keep reviewing is the default.
    expect(within(prompt).getByRole('button', { name: /Keep reviewing/ })).toHaveFocus()
    expect(useReviewStore.getState().open).toBe(true)
    fireEvent.click(within(prompt).getByRole('button', { name: /Keep reviewing/ }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /unrecorded/ })).toBeNull())
    expect(useReviewStore.getState().open).toBe(true)
    expect(updateField()).toHaveValue('Legal has it')
    await waitFor(() => expect(updateField()).toHaveFocus())
  })

  it('Discard closes the deck, the text gone, nothing recorded', async () => {
    const [first] = ids as [number]
    const followUps = vi.spyOn(useTodoStore.getState(), 'markFollowedUp')
    const entryWrites = [vi.spyOn(statusUpdateRepository, 'add'), vi.spyOn(statusUpdateRepository, 'addMany')]
    await openDeck()
    fireEvent.change(updateField(), { target: { value: 'Legal has it' } })
    fireEvent.click(screen.getByRole('button', { name: 'Close review' }))
    const prompt = await screen.findByRole('dialog', { name: 'Discard the unrecorded update?' })
    fireEvent.click(within(prompt).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(useReviewStore.getState().open).toBe(false))
    expect(useReviewStore.getState().drafts).toEqual({})
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(followUps).not.toHaveBeenCalled()
    for (const w of entryWrites) expect(w).not.toHaveBeenCalled()
    expect(todo(first)?.lastFollowupAt).toBeUndefined()
  })

  it('several tasks with text: the count and their titles; Keep reviewing goes to a card that holds text', async () => {
    await openDeck()
    fireEvent.change(updateField(), { target: { value: 'First note' } })
    fireEvent.click(screen.getByRole('button', { name: /^Skip/ }))
    fireEvent.change(updateField(), { target: { value: 'Second note' } })
    fireEvent.click(screen.getByRole('button', { name: /^Skip/ }))
    expect(cardTitle()).toBe('Retention addendum')
    fireEvent.keyDown(updateField(), { key: 'Escape' })
    const prompt = await screen.findByRole('dialog', { name: 'Discard 2 unrecorded updates?' })
    expect(prompt).toHaveTextContent('The updates typed for “Answer Northwind” and “Map integration points” haven’t been recorded.')
    fireEvent.click(within(prompt).getByRole('button', { name: /Keep reviewing/ }))
    await waitFor(() => expect(cardTitle()).toBe(FIRST))
    expect(updateField()).toHaveValue('First note')
    await waitFor(() => expect(updateField()).toHaveFocus())
  })

  it('Esc while the editor is open is the editor’s', async () => {
    await openDeck()
    act(() => useUIStore.getState().openEditPopup(ids[0]!))
    fireEvent.keyDown(updateField(), { key: 'Escape' })
    expect(useReviewStore.getState().open).toBe(true)
  })

  it('Open in editor opens the task’s editor over the deck', async () => {
    await openDeck()
    fireEvent.click(screen.getByRole('button', { name: 'Open in editor' }))
    await waitFor(() => expect(useUIStore.getState()).toMatchObject({ editPopupMode: 'edit', selectedTodoId: ids[0] }))
  })

  it('the last card: Mark followed up stays on it, and once every task has a mark the header says all reviewed', async () => {
    await openDeck()
    fireEvent.click(screen.getByRole('button', { name: /^Skip/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Skip/ }))
    expect(cardTitle()).toBe('Retention addendum')
    fireEvent.click(markButton())
    expect(cardTitle()).toBe('Retention addendum')
    expect(screen.getByTestId('review-position')).toHaveTextContent('All 3 reviewed')
    expect(updateField()).toHaveFocus()
  })

  it('a task deleted meanwhile leaves the rail; a completed one stays, its box checked', async () => {
    const [first, second] = ids as [number, number]
    await openDeck()
    await act(async () => { await useTodoStore.getState().toggleComplete(first) })
    expect(railRow(FIRST)).toHaveAccessibleName(/completed/)
    await act(async () => { await useTodoStore.getState().bulkRemove([second]) })
    expect(screen.queryByRole('button', { name: new RegExp(`^${SECOND}`) })).toBeNull()
    expect(screen.getByTestId('review-position')).toHaveTextContent('1 of 2')
  })

  it('the card’s box completes the task (after the notes)', async () => {
    const [first] = ids as [number]
    await openDeck()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Mark complete' }))
    await waitFor(() => expect(todo(first)?.isCompleted).toBe(true))
    expect(cardTitle()).toBe(FIRST)
  })
})
