import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { EditorView } from '@codemirror/view'
import { ReviewDeck } from '../../../components/overlays/ReviewDeck'
import { ConfirmPromptHost } from '../../../components/overlays/ConfirmPromptHost'
import { todoRepository } from '../../../data'
import { emptyPredicate } from '../../../models'
import { statusUpdateRepository } from '../../../data/status-update-repository'
import { useReviewStore } from '../../../stores/review-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useStatusUpdateStore } from '../../../stores/status-update-store'
import { useStatusStore } from '../../../stores/status-store'
import { usePersonStore } from '../../../stores/person-store'
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
    // No hint over the footer (task layout A): the Next field it echoed is right above it.
    expect(screen.queryByTestId('review-hint')).toBeNull()
    fireEvent.keyDown(updateField(), { key: 'Enter' })
    expect(cardTitle()).toBe(SECOND)
    expect(updateField()).toHaveFocus()
    expect(updateField()).toHaveValue('')
    await waitFor(() => expect(sameDay(todo(first)?.lastFollowupAt, startOfToday())).toBe(true))
    await waitFor(() => expect(useStatusUpdateStore.getState().byTodo.get(first)?.map((u) => [u.text, u.followedUp]))
      .toEqual([['Legal has it, back Thursday', true]]))
    expect(useUndoStore.getState().undoStack.map((e) => e.description)).toEqual(['Followed up · status update added'])
    // Marked once the write is in.
    await waitFor(() => expect(railRow(FIRST)).toHaveAttribute('data-mark', 'done'))
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
    // What the field means, beside it (`aria-live`).
    expect(document.getElementById(nextField().getAttribute('aria-describedby') ?? '')).toHaveTextContent(/^→ .* · ⏎ to set$/)
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

  it('a quick button sets the next follow-up at once; the field’s × clears it (no None preset)', async () => {
    const [first] = ids as [number]
    await openDeck()
    // The quick row is the editor's: 1w 2w 1m 3m, nothing else.
    expect(within(screen.getByRole('group', { name: 'Quick follow-up intervals' })).getAllByRole('button').map((b) => b.textContent))
      .toEqual(['1w', '2w', '1m', '3m'])
    expect(screen.queryByRole('button', { name: 'No next follow-up' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'None' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Follow up in 1 month' }))
    await waitFor(() => expect(todo(first)?.nextFollowupAt).toBeDefined())
    fireEvent.click(screen.getByRole('button', { name: 'Clear next follow-up' }))
    await waitFor(() => expect(todo(first)?.nextFollowupAt).toBeUndefined())
    expect(nextField()).toHaveValue('')
    expect(todo(first)?.lastFollowupAt).toBeUndefined()
  })

  it('Last follow-up is a field in the dock under Next: a date and ⏎ write it (one undo step, after the notes); a future day is refused; Esc reverts', async () => {
    const [first] = ids as [number]
    await openDeck()
    const card = document.querySelector('[data-review-card]') as HTMLElement
    const dock = card.querySelector('[data-task-dock]') as HTMLElement
    const last = within(dock).getByRole('textbox', { name: 'Last follow-up' })
    // In the dock, after the update line and the Next field; nothing of it in the rail.
    expect(updateField().compareDocumentPosition(nextField()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(nextField().compareDocumentPosition(last) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(card.querySelector('[data-task-rail] input[aria-label$="follow-up"]')).toBeNull()
    expect(screen.getByTestId('review-last-followup')).toHaveTextContent('Never')

    // A future day: refused, nothing written.
    act(() => last.focus())
    fireEvent.change(last, { target: { value: 'tomorrow' } })
    expect(last).toHaveAttribute('aria-invalid', 'true')
    fireEvent.keyDown(last, { key: 'Enter' })
    expect(last).toHaveFocus()
    expect(todo(first)?.lastFollowupAt).toBeUndefined()
    // Esc: back to the stored value, the deck still open.
    fireEvent.keyDown(last, { key: 'Escape' })
    expect(last).toHaveValue('')
    expect(useReviewStore.getState().open).toBe(true)

    // Yesterday, ⏎: written as one undo step; the focus back on the update line.
    const yesterday = addDays(startOfToday(), -1)
    fireEvent.change(last, { target: { value: 'yesterday' } })
    fireEvent.keyDown(last, { key: 'Enter' })
    await waitFor(() => expect(sameDay(todo(first)?.lastFollowupAt, yesterday)).toBe(true))
    expect(updateField()).toHaveFocus()
    await waitFor(() => expect(useUndoStore.getState().undoStack).toHaveLength(1))
    // The blur that followed ⏎ wrote nothing more.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)) })
    expect(useUndoStore.getState().undoStack).toHaveLength(1)
    await act(async () => { await useUndoStore.getState().undo() })
    await waitFor(() => expect(todo(first)?.lastFollowupAt).toBeUndefined())

    // Blur commits too, once.
    act(() => last.focus())
    fireEvent.change(last, { target: { value: 'yesterday' } })
    act(() => updateField().focus())
    await waitFor(() => expect(sameDay(todo(first)?.lastFollowupAt, yesterday)).toBe(true))
    await waitFor(() => expect(useUndoStore.getState().undoStack).toHaveLength(1))
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)) })
    expect(useUndoStore.getState().undoStack).toHaveLength(1)
    expect(cardTitle()).toBe(FIRST)
  })

  it('the notes typed so far are written first, as their own undo step', async () => {
    const [first] = ids as [number]
    await openDeck()
    // An empty task's Notes box is there already (board BL): no + Add notes to press.
    expect(screen.queryByRole('button', { name: 'Add notes' })).toBeNull()
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

  it('a next follow-up date typed and not set counts too: the prompt says so, Keep reviewing focuses that field', async () => {
    const [first] = ids as [number]
    await openDeck()
    fireEvent.change(nextField(), { target: { value: '2w' } })
    fireEvent.keyDown(nextField(), { key: 'Escape' })
    const prompt = await screen.findByRole('dialog', { name: 'Discard the unrecorded update?' })
    expect(prompt).toHaveTextContent('A next follow-up date typed for “Answer Northwind” hasn’t been set. Nothing is marked followed up.')
    fireEvent.click(within(prompt).getByRole('button', { name: /Keep reviewing/ }))
    await waitFor(() => expect(nextField()).toHaveFocus())
    expect(nextField()).toHaveValue('2w')

    fireEvent.keyDown(nextField(), { key: 'Escape' })
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Discard the unrecorded update?' })).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(useReviewStore.getState().open).toBe(false))
    expect(useReviewStore.getState().nextDrafts).toEqual({})
    expect(todo(first)?.nextFollowupAt).toBeUndefined()
  })

  it('an update and a next date on one task: both counted, both named', async () => {
    await openDeck()
    fireEvent.change(updateField(), { target: { value: 'Waiting on legal' } })
    fireEvent.change(nextField(), { target: { value: 'not a date' } })
    fireEvent.click(screen.getByRole('button', { name: 'Close review' }))
    const prompt = await screen.findByRole('dialog', { name: 'Discard 2 unrecorded updates?' })
    expect(prompt).toHaveTextContent('The update typed for “Answer Northwind” hasn’t been recorded, and a next follow-up date typed for “Answer Northwind” hasn’t been set.')
    fireEvent.click(within(prompt).getByRole('button', { name: /Keep reviewing/ }))
    // The update line first.
    await waitFor(() => expect(updateField()).toHaveFocus())
  })

  it('a next date typed and not set comes back with its card (Back); a set one is no longer pending', async () => {
    await openDeck()
    fireEvent.change(nextField(), { target: { value: '2w' } })
    fireEvent.click(screen.getByRole('button', { name: /^Skip/ }))
    expect(nextField()).not.toHaveValue('2w')
    fireEvent.click(screen.getByRole('button', { name: /^Back/ }))
    expect(nextField()).toHaveValue('2w')
    fireEvent.keyDown(nextField(), { key: 'Enter' })
    expect(useReviewStore.getState().nextDrafts).toEqual({})
  })

  it('a click into the Next field selects its text, so typing replaces it', async () => {
    await openDeck()
    const field = nextField() as HTMLInputElement
    fireEvent.change(field, { target: { value: 'Mon 11/16' } })
    field.blur()
    fireEvent.mouseDown(field)
    field.focus()
    // The click's mouseup would put the caret down: its default is prevented.
    expect(fireEvent.mouseUp(field)).toBe(false)
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, field.value.length])
  })

  it('a follow-up that fails to write keeps the typed text and shows no ✓', async () => {
    const [first] = ids as [number]
    vi.spyOn(todoRepository, 'bulkUpdate').mockRejectedValue(new Error('disk full'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await openDeck()
    fireEvent.change(updateField(), { target: { value: 'Legal has it' } })
    fireEvent.keyDown(updateField(), { key: 'Enter' })
    await waitFor(() => expect(useUndoStore.getState().snackbar?.description).toMatch(/Couldn’t mark the tasks followed up/))
    expect(useReviewStore.getState().drafts).toEqual({ [first]: 'Legal has it' })
    expect(railRow(FIRST)).not.toHaveAttribute('data-mark')
    expect(screen.getByTestId('review-followed-up')).toHaveTextContent('0 followed up')
  })

  it('an undo of the follow-up takes the ✓ and the count away', async () => {
    await openDeck()
    fireEvent.click(markButton())
    await waitFor(() => expect(railRow(FIRST)).toHaveAttribute('data-mark', 'done'))
    // The ✓ reads the task (item 11): it can show before the follow-up's undo step is in.
    await waitFor(() => expect(useUndoStore.getState().undoStack).toHaveLength(1))
    await act(async () => { await useUndoStore.getState().undo() })
    await waitFor(() => expect(railRow(FIRST)).not.toHaveAttribute('data-mark'))
    expect(screen.getByTestId('review-followed-up')).toHaveTextContent('0 followed up')
  })

  it('a task followed up today before the review shows ✓ and counts; a skip leaves its ✓ (item 11)', async () => {
    const [, second] = ids as [number, number]
    await useTodoStore.getState().update(second, { lastFollowupAt: new Date() })
    await openDeck()
    expect(railRow(SECOND)).toHaveAttribute('data-mark', 'done')
    expect(screen.getByTestId('review-followed-up')).toHaveTextContent('1 followed up')
    fireEvent.click(screen.getByRole('button', { name: /^Skip/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Skip/ }))
    expect(railRow(FIRST)).toHaveAttribute('data-mark', 'skipped')
    expect(railRow(SECOND)).toHaveAttribute('data-mark', 'done')
  })

  it('the rail’s sort (item 7): reorders the rail, the current card stays, Back / Skip step in the order shown; dividers in Queue order only', async () => {
    const [, , third] = ids as [number, number, number]
    await useTodoStore.getState().update(third, { dueDate: startOfToday() })
    useReviewStore.getState().start({
      source: { kind: 'list', title: 'Aisha 1:1', description: 'list · Manual' },
      ids,
      dividers: [{ index: 0, label: 'Open' }, { index: 2, label: 'Later' }],
    })
    render(<><ReviewDeck /><ConfirmPromptHost /></>)
    await act(async () => { await Promise.resolve() })
    const rail = screen.getByRole('navigation', { name: 'Review queue' })
    const rowTitles = () => within(rail).getAllByRole('button').filter((b) => b.hasAttribute('data-review-row')).map((b) => b.getAttribute('aria-label')?.split(',')[0])
    expect(rail.querySelectorAll('li[aria-hidden="true"]')).toHaveLength(2)
    fireEvent.click(screen.getByTestId('review-sort'))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /^Due/ }))
    expect(screen.getByTestId('review-sort')).toHaveTextContent('Sort: Due')
    expect(rowTitles()).toEqual(['Retention addendum', FIRST, SECOND])
    expect(rail.querySelectorAll('li[aria-hidden="true"]')).toHaveLength(0)
    expect(cardTitle()).toBe(FIRST)
    expect(screen.getByTestId('review-position')).toHaveTextContent('2 of 3')
    fireEvent.click(screen.getByRole('button', { name: /^Back/ }))
    expect(cardTitle()).toBe('Retention addendum')
    fireEvent.keyDown(railRow('Retention addendum'), { key: 'ArrowRight' })
    expect(cardTitle()).toBe(FIRST)
    expect(railRow('Retention addendum')).toHaveAttribute('data-mark', 'skipped')
  })

  it('the header’s lens switch (item 10): −N while the lens hides tasks here; a click takes the queue again without it, the card kept', async () => {
    const [first, second, third] = ids as [number, number, number]
    useSettingsStore.setState({ lenses: [{ id: 'l1', name: 'Mine', predicate: emptyPredicate() }], activeLensId: 'l1' })
    const requery = vi.fn((ignore: boolean) => ({ ids: ignore ? [first, second, third] : [second] }))
    useReviewStore.getState().start({
      source: { kind: 'list', title: 'Aisha 1:1', description: 'list · Manual' },
      ids: [second],
      lens: { ignored: false, hides: 2, used: false, requery },
    })
    render(<><ReviewDeck /><ConfirmPromptHost /></>)
    await act(async () => { await Promise.resolve() })
    const lensSwitch = screen.getByRole('button', { name: 'Apply the lens “Mine” here' })
    expect(lensSwitch).toHaveAttribute('aria-pressed', 'true')
    expect(lensSwitch).toHaveTextContent('−2')
    fireEvent.click(lensSwitch)
    expect(requery).toHaveBeenCalledWith(true)
    expect(screen.getByTestId('review-position')).toHaveTextContent('2 of 3')
    expect(cardTitle()).toBe(SECOND)
    expect(screen.getByRole('button', { name: 'Apply the lens “Mine” here' })).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(screen.getByRole('button', { name: 'Apply the lens “Mine” here' }))
    expect(screen.getByTestId('review-position')).toHaveTextContent('1 of 1')
  })

  it('no lens picked: no lens switch', async () => {
    useReviewStore.getState().start({
      source: { kind: 'list', title: 'Aisha 1:1', description: '' },
      ids,
      lens: { ignored: false, hides: 0, used: false, requery: () => ({ ids }) },
    })
    render(<ReviewDeck />)
    await act(async () => { await Promise.resolve() })
    expect(screen.queryByTestId('lens-switch')).toBeNull()
  })

  it('on a Mac, Alt + arrows in a text field move its caret; outside one they still step', async () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel')
    await openDeck()
    expect(fireEvent.keyDown(updateField(), { key: 'ArrowRight', altKey: true })).toBe(true)
    expect(cardTitle()).toBe(FIRST)
    railRow(FIRST).focus()
    fireEvent.keyDown(railRow(FIRST), { key: 'ArrowRight', altKey: true })
    expect(cardTitle()).toBe(SECOND)
  })

  it('in the notes editor Alt + arrows are its own (never the browser’s Back)', async () => {
    await openDeck()
    const content = document.querySelector<HTMLElement>('.cm-content')!
    expect(fireEvent.keyDown(content, { key: 'ArrowRight', altKey: true })).toBe(false)
    expect(cardTitle()).toBe(FIRST)
  })

  it('Back and Skip: their names without the key hint, their keys in aria-keyshortcuts', async () => {
    await openDeck()
    const back = screen.getByRole('button', { name: 'Back' })
    expect(back).toHaveAttribute('aria-keyshortcuts', 'K Alt+ArrowLeft')
    expect(screen.getByRole('button', { name: 'Skip' })).toHaveAttribute('aria-keyshortcuts', 'S Alt+ArrowRight')
  })

  it('a grouped review: each rail row names its group', async () => {
    useReviewStore.getState().start({
      source: { kind: 'list', title: 'Aisha 1:1', description: 'list · Status · Manual' },
      ids,
      dividers: [{ index: 0, label: 'Waiting' }, { index: 2, label: 'Doing' }],
    })
    render(<><ReviewDeck /><ConfirmPromptHost /></>)
    expect(railRow(FIRST)).toHaveAccessibleName(/, in Waiting$/)
    expect(railRow(SECOND)).toHaveAccessibleName(/, in Waiting$/)
    expect(railRow('Retention addendum')).toHaveAccessibleName(/, in Doing$/)
  })

  it('Esc in the status picker closes only the picker', async () => {
    await act(async () => { await useStatusStore.getState().add('Waiting') })
    await openDeck()
    fireEvent.click(screen.getByRole('button', { name: /^Status:/ }))
    expect(screen.getByText('No Status')).toBeInTheDocument()
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByText('No Status')).toBeNull())
    expect(useReviewStore.getState().open).toBe(true)
  })

  it('Esc while the editor is open is the editor’s', async () => {
    await openDeck()
    act(() => useUIStore.getState().openEditPopup(ids[0]!))
    fireEvent.keyDown(updateField(), { key: 'Escape' })
    expect(useReviewStore.getState().open).toBe(true)
  })

  it('the card is the editor’s layout (board BJ): the facts rail, then the writing; no Open in editor', async () => {
    useStatusStore.setState({ statuses: [{ id: 1, name: 'Waiting', color: '#f5c842', sortOrder: 0 }] })
    await openDeck()
    const card = document.querySelector('[data-review-card]') as HTMLElement
    const rail = card.querySelector('[data-task-rail]') as HTMLElement
    const writing = card.querySelector('[data-task-writing]') as HTMLElement
    // The queue, the facts, the writing: in that order.
    const queue = document.querySelector('[data-review-rail]')!
    expect(queue.compareDocumentPosition(rail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(rail.compareDocumentPosition(writing) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(Array.from(rail.querySelectorAll('[data-fact]')).map((f) => f.getAttribute('data-fact')))
      .toEqual(['priority', 'status', 'people', 'tags', 'due'])
    const parts = ['[data-task-notes]', '[data-subtasks]', '[data-status-updates]'].map((sel) => writing.querySelector(sel))
    parts.forEach((el) => expect(el).not.toBeNull())
    for (let i = 1; i < parts.length; i++) {
      expect(parts[i - 1]!.compareDocumentPosition(parts[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
    expect(within(card).getByRole('region', { name: 'Subtasks' })).toBeInTheDocument()
    expect(within(card).queryByText('Checklist')).toBeNull()
    expect(within(card).getByPlaceholderText('Add subtask')).toBeInTheDocument()
    // The fields the deck gained: People, Tags, the marker toggles; the update line is the last thing in Status updates.
    expect(within(card).getByText('People')).toBeInTheDocument()
    expect(within(card).getByText('Tags')).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Urgent', pressed: false })).toBeInTheDocument()
    const updates = card.querySelector('[data-status-updates]') as HTMLElement
    expect(updates.querySelector('input:last-of-type')).toBe(updateField())
    // The follow-up rows are the dock's (Next, Last), under the update line; Mark followed up is the footer's.
    const dock = card.querySelector('[data-task-dock]') as HTMLElement
    expect(Array.from(dock.querySelectorAll('[data-followup-row]')).map((r) => r.getAttribute('data-followup-row'))).toEqual(['next', 'last'])
    expect(screen.getAllByRole('button', { name: 'Mark followed up' })).toHaveLength(1)
    expect(within(card).queryByRole('button', { name: 'Mark followed up' })).toBeNull()
    expect(screen.getByTestId('review-last-followup')).toHaveTextContent('Never')
    expect(screen.queryByRole('button', { name: 'Open in editor' })).toBeNull()
  })

  it('status updates read oldest first, the newest last; the update line after them', async () => {
    const [first] = ids as [number]
    const base = Date.now()
    await statusUpdateRepository.addMany([
      { todoId: first, date: addDays(startOfToday(), -9), text: 'kicked off', createdAt: new Date(base - 2000) },
      { todoId: first, date: addDays(startOfToday(), -2), text: 'sent the redlines', createdAt: new Date(base - 1000) },
    ])
    await useStatusUpdateStore.getState().load()
    await openDeck()
    const lines = within(screen.getByRole('list', { name: 'Status updates' })).getAllByRole('listitem')
    expect(lines.map((li) => li.textContent?.slice(5))).toEqual(['kicked off', 'sent the redlines'])
    expect(lines.at(-1)).toHaveAttribute('data-newest', 'true')
    expect(updateField()).toHaveFocus()
  })

  it('a marker toggle and a person write at once, each its own undo step (this task only)', async () => {
    const [first] = ids as [number]
    const aisha = await usePersonStore.getState().getOrCreate('Aisha')
    await openDeck()
    fireEvent.click(screen.getByRole('button', { name: 'Urgent', pressed: false }))
    await waitFor(() => expect(todo(first)?.urgent).toBe(true))
    fireEvent.click(screen.getByRole('button', { name: 'Add person' }))
    fireEvent.click(await screen.findByText('Aisha'))
    await waitFor(() => expect(usePersonStore.getState().assignedPeopleMap.get(first)?.map((p) => p.id)).toEqual([aisha]))
    await waitFor(() => expect(useUndoStore.getState().undoStack.length).toBe(2))
    expect(todo(ids[1]!)?.urgent).not.toBe(true)
  })

  it('the last card: Mark followed up stays on it, and once every task has a mark the header says all reviewed', async () => {
    await openDeck()
    fireEvent.click(screen.getByRole('button', { name: /^Skip/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Skip/ }))
    expect(cardTitle()).toBe('Retention addendum')
    fireEvent.click(markButton())
    expect(cardTitle()).toBe('Retention addendum')
    await waitFor(() => expect(screen.getByTestId('review-position')).toHaveTextContent('All 3 reviewed'))
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

  // ── Board BL: the header, the two-line rows, the always-there headings ──

  it('the header: who is reviewed over `Review · N open tasks` and the source’s words; a dot per task; the counts', async () => {
    await openDeck()
    expect(screen.getByRole('heading', { name: 'Aisha 1:1' })).toBeInTheDocument()
    expect(screen.getByTestId('review-description')).toHaveTextContent('Review · 3 open tasks · list · Manual')
    expect(screen.getByRole('dialog', { name: 'Aisha 1:1' })).toHaveAccessibleDescription('Review · 3 open tasks · list · Manual')
    // The dots are decorative: the counts beside them are the words.
    const dotStrip = screen.getByTestId('review-dots')
    expect(dotStrip).toHaveAttribute('aria-hidden', 'true')
    const dots = () => [...screen.getByTestId('review-dots').children].map((d) => d.getAttribute('data-dot'))
    expect(dots()).toEqual(['current', 'todo', 'todo'])
    expect(screen.queryByRole('progressbar')).toBeNull()
    expect(screen.queryByTestId('review-skipped')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /^Skip/ }))
    fireEvent.click(markButton())
    await waitFor(() => expect(dots()).toEqual(['skipped', 'done', 'current']))
    expect(screen.getByTestId('review-position')).toHaveTextContent('3 of 3')
    expect(screen.getByTestId('review-followed-up')).toHaveTextContent('1 followed up')
    expect(screen.getByTestId('review-skipped')).toHaveTextContent('· 1 skipped')
  })

  it('a person’s review says only the count under the name; with a completed task in the queue, `N tasks`', async () => {
    const [first] = ids as [number]
    useReviewStore.getState().start({
      source: { kind: 'person', title: 'Aisha', description: 'Open tasks assigned to Aisha.' },
      ids,
    })
    render(<ReviewDeck />)
    await act(async () => { await Promise.resolve() })
    expect(screen.getByTestId('review-description')).toHaveTextContent(/^Review · 3 open tasks$/)
    await act(async () => { await useTodoStore.getState().toggleComplete(first) })
    expect(screen.getByTestId('review-description')).toHaveTextContent(/^Review · 3 tasks$/)
  })

  it('past 20 tasks: a thin progress bar in place of the dots', async () => {
    const many = [...ids]
    for (let i = 0; i < 18; i++) many.push(await addTask(`Task ${i}`))
    await useTodoStore.getState().update(many[1]!, { lastFollowupAt: new Date() })
    await openDeck({ ids: many })
    expect(screen.queryByTestId('review-dots')).toBeNull()
    const bar = screen.getByRole('progressbar', { name: 'Followed up' })
    expect(bar).toHaveAttribute('aria-valuemax', '21')
    expect(bar).toHaveAttribute('aria-valuenow', '1')
    cleanup()
    // Twenty: still a dot each.
    await openDeck({ ids: many.slice(0, 20) })
    expect(screen.getByTestId('review-dots').children).toHaveLength(20)
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('a rail row is two lines: the title, then its follow-up (a flag) and due date (a clock) — none without a date', async () => {
    const [first, second] = ids as [number, number]
    await useTodoStore.getState().update(first, { nextFollowupAt: addDays(startOfToday(), -1), dueDate: addDays(startOfToday(), 30) })
    await useTodoStore.getState().update(second, { nextFollowupAt: startOfToday() })
    await openDeck()
    const row = railRow(FIRST)
    const title = row.querySelector('[data-review-row-title]')!
    const dates = row.querySelector('[data-review-row-dates]')!
    expect(title).toHaveTextContent(FIRST)
    expect(title.compareDocumentPosition(dates) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // The follow-up first (late: its colour state), then the due date; an icon each.
    expect([...dates.children].map((d) => [d.querySelectorAll('svg').length, d.getAttribute('data-followup')])).toEqual([[1, 'late'], [1, null]])
    expect(row).toHaveAccessibleName(/^Answer Northwind, follow-up .+, due .+/)
    // One date: just the follow-up (today).
    const secondDates = railRow(SECOND).querySelector('[data-review-row-dates]')!
    expect(secondDates.children).toHaveLength(1)
    expect(secondDates.firstElementChild).toHaveAttribute('data-followup', 'today')
    // No date: no second line.
    expect(railRow('Retention addendum').querySelector('[data-review-row-dates]')).toBeNull()
  })

  it('the writing: Notes and Subtasks, then the dock with Status updates — each heading shown while empty', async () => {
    const [first] = ids as [number]
    await openDeck()
    const card = document.querySelector('[data-review-card]') as HTMLElement
    const scroll = card.querySelector('[data-task-writing-scroll]') as HTMLElement
    const dock = card.querySelector('[data-task-dock]') as HTMLElement
    expect(scroll.querySelector('[data-task-notes] .cm-editor')).not.toBeNull()
    expect(scroll.querySelector('[data-subtasks]')).not.toBeNull()
    expect(dock.querySelector('[data-status-updates]')).not.toBeNull()
    expect(scroll.querySelector('[data-status-updates]')).toBeNull()
    // The headings are there with nothing written, without a count.
    expect(within(scroll).getByText('Notes')).toBeVisible()
    expect(within(scroll).getByText('Subtasks')).toBeVisible()
    expect(within(dock).getByText('Status updates')).toBeVisible()
    expect(dock.querySelector('[data-status-update-count]')).toBeNull()
    expect(within(dock).queryByRole('list')).toBeNull()
    // With an entry, its count beside the heading.
    await act(async () => { await useStatusUpdateStore.getState().add(first, { date: startOfToday(), text: 'kicked off' }) })
    await waitFor(() => expect(dock.querySelector('[data-status-update-count]')).toHaveTextContent('1'))
    expect(within(dock).getByRole('region', { name: /Status updates/ })).toBeInTheDocument()
  })

  it('the card’s box completes the task (after the notes)', async () => {
    const [first] = ids as [number]
    await openDeck()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Mark complete' }))
    await waitFor(() => expect(todo(first)?.isCompleted).toBe(true))
    expect(cardTitle()).toBe(FIRST)
  })
})
