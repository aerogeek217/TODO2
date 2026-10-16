import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { TaskEditPopup } from '../../components/task/TaskEditPopup'
import { useSettingsStore } from '../../stores/settings-store'
import { useTodoStore } from '../../stores/todo-store'
import { useUIStore } from '../../stores/ui-store'
import { useFilterStore } from '../../stores/filter-store'
import { useStatusStore } from '../../stores/status-store'
import { makePerson, makeTodo, patchScreenFilter, resetDb } from '../helpers'
import type { Person, Tag, PersistedTodoItem } from '../../models'

// Suppress showPicker (not supported in jsdom)
beforeEach(() => {
  HTMLInputElement.prototype.showPicker = vi.fn()
})

const TITLE_PLACEHOLDER = 'New task… (@person #tag /command)'

const alice: Person & { id: number } = makePerson({ id: 1, name: 'Alice' })
const bob: Person & { id: number } = makePerson({ id: 2, name: 'Bob' })
const urgentTag: Tag & { id: number } = { id: 1, name: 'urgent', color: '#f00' }
const followupTag: Tag & { id: number } = { id: 2, name: 'followup', color: '#0a0' }

function resetStores() {
  useSettingsStore.setState({ themeMode: 'dark' })
  useTodoStore.setState(useTodoStore.getInitialState(), true)
  useUIStore.setState({ quickAddDraft: null })
  useFilterStore.getState().clearAll()
}

function typeTitle(text: string) {
  const titleInput = screen.getByPlaceholderText(TITLE_PLACEHOLDER)
  fireEvent.change(titleInput, { target: { value: text } })
}

function clickCreate() {
  fireEvent.click(screen.getByText('Create task'))
}

function openPeopleDropdown() {
  const addButtons = screen.getAllByText('+ Add')
  fireEvent.click(addButtons[0]!)
}

function openTagsDropdown() {
  const addButtons = screen.getAllByText('+ Add')
  fireEvent.click(addButtons[1]!)
}

function renderCreateMode(overrides: Record<string, unknown> = {}) {
  const onCreate = vi.fn().mockResolvedValue(42)
  const onClose = vi.fn()

  const props = {
    mode: 'create' as const,
    assignedPeople: [],
    allPeople: [alice, bob],
    assignedTags: [],
    allTags: [urgentTag, followupTag],
    onClose,
    onCreate,
    onAssignPerson: vi.fn(),
    onUnassignPerson: vi.fn(),
    onAssignTag: vi.fn(),
    onUnassignTag: vi.fn(),
    onCreatePerson: vi.fn().mockResolvedValue(99),
    onCreateTag: vi.fn().mockResolvedValue(77),
    ...overrides,
  }

  const result = render(<TaskEditPopup {...props} />)
  return { ...result, onCreate, onClose, props }
}

function renderEditMode(todo: PersistedTodoItem, overrides: Record<string, unknown> = {}) {
  const onUpdate = vi.fn()
  const onAssignPerson = vi.fn()
  const onUnassignPerson = vi.fn()
  const onAssignTag = vi.fn()
  const onUnassignTag = vi.fn()
  const onCreateTag = vi.fn().mockResolvedValue(77)

  const props = {
    mode: 'edit' as const,
    todo,
    assignedPeople: [alice],
    allPeople: [alice, bob],
    assignedTags: [],
    allTags: [urgentTag, followupTag],
    onClose: vi.fn(),
    onUpdate,
    onToggleComplete: vi.fn(),
    onToggleStar: vi.fn(),
    onDelete: vi.fn(),
    onAssignPerson,
    onUnassignPerson,
    onAssignTag,
    onUnassignTag,
    onCreateTag,
    ...overrides,
  }

  const result = render(<TaskEditPopup {...props} />)
  return { ...result, onUpdate, onAssignPerson, onUnassignPerson, onAssignTag, onUnassignTag, onCreateTag, props }
}

describe('TaskEditPopup', () => {
  beforeEach(() => {
    resetStores()
  })

  afterEach(() => {
    cleanup()
  })

  describe('create mode — pending assignments', () => {
    it('toggling a person includes them in onCreate assignments', async () => {
      const { onCreate } = renderCreateMode()

      openPeopleDropdown()
      fireEvent.click(screen.getByRole('option', { name: 'Alice' }))

      // Person chip: avatar + name, removable
      expect(screen.getByRole('button', { name: 'Alice×' })).toBeInTheDocument()

      typeTitle('Test task')
      clickCreate()

      await vi.waitFor(() => {
        expect(onCreate).toHaveBeenCalledOnce()
      })

      const [partial, assignments] = onCreate.mock.calls[0]!
      expect(partial.title).toBe('Test task')
      expect(assignments.personIds).toEqual([1])
    })

    it('toggling a person twice removes them from pending', async () => {
      const { onCreate } = renderCreateMode()

      // Toggle Alice on
      openPeopleDropdown()
      fireEvent.click(screen.getByRole('option', { name: 'Alice' }))
      expect(screen.getByRole('button', { name: 'Alice×' })).toBeInTheDocument()

      // Toggle Alice off (dropdown is still open, click Alice again in the list)
      fireEvent.click(screen.getByRole('option', { name: 'Alice' }))
      expect(screen.queryByRole('button', { name: 'Alice×' })).not.toBeInTheDocument()

      typeTitle('No person')
      clickCreate()

      await vi.waitFor(() => {
        expect(onCreate).toHaveBeenCalledOnce()
      })

      const [, assignments] = onCreate.mock.calls[0]!
      expect(assignments.personIds).toEqual([])
    })

    it('selecting multiple people includes all in onCreate', async () => {
      const { onCreate } = renderCreateMode()

      // Add Alice and Bob
      openPeopleDropdown()
      fireEvent.click(screen.getByRole('option', { name: 'Alice' }))
      fireEvent.click(screen.getByRole('option', { name: 'Bob' }))

      typeTitle('Multi assign')
      clickCreate()

      await vi.waitFor(() => {
        expect(onCreate).toHaveBeenCalledOnce()
      })

      const [, assignments] = onCreate.mock.calls[0]!
      expect(assignments.personIds).toContain(1)
      expect(assignments.personIds).toContain(2)
    })

    it('creating a new person adds them to pending assignments', async () => {
      const onCreatePerson = vi.fn().mockResolvedValue(50)
      const { onCreate } = renderCreateMode({ onCreatePerson })

      openPeopleDropdown()

      const searchInput = screen.getByPlaceholderText('Search or create people…')
      fireEvent.change(searchInput, { target: { value: 'Charlie' } })
      fireEvent.click(screen.getByRole('option', { name: 'Create "Charlie"' }))

      await vi.waitFor(() => {
        expect(onCreatePerson).toHaveBeenCalledWith('Charlie')
      })

      typeTitle('New person task')
      clickCreate()

      await vi.waitFor(() => {
        expect(onCreate).toHaveBeenCalledOnce()
      })

      const [, assignments] = onCreate.mock.calls[0]!
      expect(assignments.personIds).toContain(50)
    })

    it('the people picker: Esc closes it without closing the editor', () => {
      const { onClose } = renderCreateMode()
      openPeopleDropdown()
      const searchInput = screen.getByPlaceholderText('Search or create people…')
      expect(searchInput).toHaveFocus()
      fireEvent.keyDown(searchInput, { key: 'Escape' })
      expect(screen.queryByPlaceholderText('Search or create people…')).not.toBeInTheDocument()
      expect(onClose).not.toHaveBeenCalled()
    })

    it('an @name in the title that matches nobody offers to create it', () => {
      renderCreateMode()
      typeTitle('Call legal @Marco')
      const row = screen.getByRole('option', { name: 'Press ⏎ to create @Marco' })
      expect(row).toBeInTheDocument()
      fireEvent.keyDown(screen.getByPlaceholderText(TITLE_PLACEHOLDER), { key: 'Enter' })
      expect(screen.getByPlaceholderText(TITLE_PLACEHOLDER)).toHaveValue('Call legal @Marco ')
    })

    it('does not call the no-op assignment callbacks in create mode', () => {
      const { props } = renderCreateMode()

      // Toggle a person on and off in the same dropdown session
      openPeopleDropdown()
      fireEvent.click(screen.getByRole('option', { name: 'Alice' }))
      fireEvent.click(screen.getByRole('option', { name: 'Alice' }))
      expect(props.onAssignPerson).not.toHaveBeenCalled()
      expect(props.onUnassignPerson).not.toHaveBeenCalled()
    })

    it('empty assignments are passed when no chips selected', async () => {
      const { onCreate } = renderCreateMode()

      typeTitle('Plain task')
      clickCreate()

      await vi.waitFor(() => {
        expect(onCreate).toHaveBeenCalledOnce()
      })

      const [, assignments] = onCreate.mock.calls[0]!
      expect(assignments.personIds).toEqual([])
    })
  })

  describe('edit mode — callbacks', () => {
    it('toggling a person calls onAssignPerson/onUnassignPerson', () => {
      const todo = makeTodo({ id: 10, title: 'Edit task' })
      const { onAssignPerson, onUnassignPerson } = renderEditMode(todo)

      openPeopleDropdown()

      // Alice is already assigned — toggling should unassign
      fireEvent.click(screen.getByRole('option', { name: 'Alice' }))
      expect(onUnassignPerson).toHaveBeenCalledWith(1)

      // Bob is not assigned — toggling should assign
      fireEvent.click(screen.getByRole('option', { name: 'Bob' }))
      expect(onAssignPerson).toHaveBeenCalledWith(2)
    })
  })

  describe('create mode — pending tag assignments', () => {
    it('toggling a tag includes it in onCreate assignments', async () => {
      const { onCreate } = renderCreateMode()

      openTagsDropdown()
      fireEvent.click(screen.getByText('urgent'))

      // Tag chip appears with # prefix (distinct from dropdown item)
      expect(screen.getByText('#urgent')).toBeInTheDocument()

      typeTitle('Tagged task')
      clickCreate()

      await vi.waitFor(() => {
        expect(onCreate).toHaveBeenCalledOnce()
      })

      const [partial, assignments] = onCreate.mock.calls[0]!
      expect(partial.title).toBe('Tagged task')
      expect(assignments.tagIds).toEqual([1])
    })

    it('toggling a tag twice removes it from pending', async () => {
      const { onCreate } = renderCreateMode()

      openTagsDropdown()
      fireEvent.click(screen.getByText('urgent'))
      expect(screen.getByText('#urgent')).toBeInTheDocument()

      fireEvent.click(screen.getByText('urgent'))
      expect(screen.queryByText('#urgent')).not.toBeInTheDocument()

      typeTitle('No tag')
      clickCreate()

      await vi.waitFor(() => {
        expect(onCreate).toHaveBeenCalledOnce()
      })

      const [, assignments] = onCreate.mock.calls[0]!
      expect(assignments.tagIds).toEqual([])
    })

    it('inline-creating a tag calls onCreateTag and adds it to pending', async () => {
      const onCreateTag = vi.fn().mockResolvedValue(50)
      const { onCreate } = renderCreateMode({ onCreateTag })

      openTagsDropdown()

      const searchInput = screen.getByPlaceholderText('Search tags...')
      fireEvent.change(searchInput, { target: { value: 'blocker' } })
      fireEvent.click(screen.getByRole('option', { name: 'Create "blocker"' }))

      await vi.waitFor(() => {
        expect(onCreateTag).toHaveBeenCalledWith('blocker')
      })

      typeTitle('Blocker task')
      clickCreate()

      await vi.waitFor(() => {
        expect(onCreate).toHaveBeenCalledOnce()
      })

      const [, assignments] = onCreate.mock.calls[0]!
      expect(assignments.tagIds).toContain(50)
    })

    it('does not call the no-op tag assignment callbacks in create mode', () => {
      const { props } = renderCreateMode()

      openTagsDropdown()
      fireEvent.click(screen.getByText('urgent'))
      expect(props.onAssignTag).not.toHaveBeenCalled()
      expect(props.onUnassignTag).not.toHaveBeenCalled()
    })

    it('empty tag assignments are passed when no chips selected', async () => {
      const { onCreate } = renderCreateMode()

      typeTitle('Plain task')
      clickCreate()

      await vi.waitFor(() => {
        expect(onCreate).toHaveBeenCalledOnce()
      })

      const [, assignments] = onCreate.mock.calls[0]!
      expect(assignments.tagIds).toEqual([])
    })
  })

  describe('edit mode — tag callbacks', () => {
    it('toggling an unassigned tag calls onAssignTag', () => {
      const todo = makeTodo({ id: 10, title: 'Edit task' })
      const { onAssignTag } = renderEditMode(todo)

      openTagsDropdown()
      fireEvent.click(screen.getByText('urgent'))

      expect(onAssignTag).toHaveBeenCalledWith(1)
    })

    it('toggling an assigned tag calls onUnassignTag', () => {
      const todo = makeTodo({ id: 10, title: 'Edit task' })
      const { onUnassignTag } = renderEditMode(todo, { assignedTags: [urgentTag] })

      openTagsDropdown()
      fireEvent.click(screen.getByText('urgent'))

      expect(onUnassignTag).toHaveBeenCalledWith(1)
    })

    it('removing a chip via × fires onUnassignTag', () => {
      const todo = makeTodo({ id: 10, title: 'Edit task' })
      const { onUnassignTag } = renderEditMode(todo, { assignedTags: [urgentTag] })

      const chip = screen.getByText('#urgent')
      const removeBtn = chip.querySelector('span')!
      fireEvent.click(removeBtn)

      expect(onUnassignTag).toHaveBeenCalledWith(1)
    })

    it('inline-creating a tag calls onCreateTag then onAssignTag', async () => {
      const onCreateTag = vi.fn().mockResolvedValue(99)
      const todo = makeTodo({ id: 10, title: 'Edit task' })
      const { onAssignTag } = renderEditMode(todo, { onCreateTag })

      openTagsDropdown()

      const searchInput = screen.getByPlaceholderText('Search tags...')
      fireEvent.change(searchInput, { target: { value: 'newtag' } })
      fireEvent.click(screen.getByRole('option', { name: 'Create "newtag"' }))

      await vi.waitFor(() => {
        expect(onCreateTag).toHaveBeenCalledWith('newtag')
      })
      await vi.waitFor(() => {
        expect(onAssignTag).toHaveBeenCalledWith(99)
      })
    })
  })

  describe('Focus toggle', () => {
    beforeEach(async () => {
      await resetDb()
      resetStores()
    })

    it('edit mode: clicking Focus puts the task in focus, and again takes it out', async () => {
      const todo = makeTodo({ id: 42, title: 'Focus target' })
      useTodoStore.setState({ todos: [todo] })
      const { rerender, props } = renderEditMode(todo)

      const toggle = screen.getByRole('button', { name: /Focus/ })
      expect(toggle).toHaveAttribute('aria-pressed', 'false')
      expect(screen.queryByText('Add to Taskboard')).not.toBeInTheDocument()

      await act(async () => { fireEvent.click(toggle) })
      await waitFor(() => expect(useTodoStore.getState().todos[0]!.focus).toBe(true))

      rerender(<TaskEditPopup {...props} todo={useTodoStore.getState().todos[0]!} />)
      expect(screen.getByRole('button', { name: /Focus/ })).toHaveAttribute('aria-pressed', 'true')

      await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Focus/ })) })
      await waitFor(() => expect(useTodoStore.getState().todos[0]!.focus).toBeUndefined())
    })

    it('create mode: the Focus toggle is passed to onCreate', async () => {
      const { onCreate } = renderCreateMode()
      typeTitle('New focused task')
      fireEvent.click(screen.getByRole('button', { name: /Focus/ }))
      await act(async () => { fireEvent.click(screen.getByText('Create task')) })
      expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ title: 'New focused task', focus: true }), expect.anything())
    })

    it('create mode: a Markers screen filter starts those toggles on', () => {
      patchScreenFilter({ markers: { focus: true, important: true } })
      renderCreateMode()
      expect(screen.getByRole('button', { name: 'Focus' })).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByRole('button', { name: 'Important' })).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByRole('button', { name: 'Urgent' })).toHaveAttribute('aria-pressed', 'false')
    })
  })

  describe('Urgent and Important toggles', () => {
    // Sat 10 Oct 2026; the default range: due within 3 days is urgent.
    const today = new Date(2026, 9, 10, 9)
    const day = (offset: number) => new Date(2026, 9, 10 + offset)

    beforeEach(async () => {
      vi.useFakeTimers({ now: today, toFake: ['Date'] })
      await resetDb()
      resetStores()
      useSettingsStore.setState({ urgentDueWithinDays: 3 })
      useUIStore.setState({ bulkConfirmation: null })
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('edit mode: Urgent and Important flag the task and clear it again', async () => {
      const todo = makeTodo({ id: 42, title: 'Flag me' })
      useTodoStore.setState({ todos: [todo] })
      const { rerender, props } = renderEditMode(todo)
      const urgent = () => screen.getByRole('button', { name: 'Urgent' })
      const important = () => screen.getByRole('button', { name: 'Important' })
      expect(urgent()).toHaveAttribute('aria-pressed', 'false')
      expect(important()).toHaveAttribute('aria-pressed', 'false')

      await act(async () => { fireEvent.click(urgent()) })
      await act(async () => { fireEvent.click(important()) })
      await waitFor(() => expect(useTodoStore.getState().todos[0]).toMatchObject({ urgent: true, important: true }))
      rerender(<TaskEditPopup {...props} todo={useTodoStore.getState().todos[0]!} />)
      expect(urgent()).toHaveAttribute('aria-pressed', 'true')
      expect(urgent()).toHaveAttribute('data-urgent', 'flag')
      expect(important()).toHaveAttribute('aria-pressed', 'true')

      // Flagged, no due date: the flag just clears (no prompt).
      await act(async () => { fireEvent.click(urgent()) })
      await waitFor(() => expect(useTodoStore.getState().todos[0]!.urgent).toBeUndefined())
      expect(useUIStore.getState().bulkConfirmation).toBeNull()
    })

    it('edit mode: a task urgent only by its due date shows the clock; clearing asks to remove the date', async () => {
      const todo = makeTodo({ id: 7, title: 'Pick up prescriptions', dueDate: day(3) })
      useTodoStore.setState({ todos: [todo] })
      renderEditMode(todo)
      const urgent = screen.getByRole('button', { name: 'Urgent' })
      expect(urgent).toHaveAttribute('aria-pressed', 'true')
      expect(urgent).toHaveAttribute('data-urgent', 'date')
      fireEvent.pointerEnter(urgent)
      const tip = await screen.findByRole('tooltip', undefined, { timeout: 1500 })
      expect(tip.textContent).toBe('Urgent: due soonDue Tue 13, within 3 days. Click to make it not urgent.')
      fireEvent.pointerLeave(urgent)

      await act(async () => { fireEvent.click(urgent) })
      const prompt = useUIStore.getState().bulkConfirmation!
      expect(prompt).toMatchObject({
        action: 'custom',
        title: 'Remove the due date?',
        message: 'Pick up prescriptions is due Tue 13, within 3 days, so it counts as urgent. Removing the due date makes it not urgent.',
        confirmLabel: 'Remove due date',
        cancelLabel: 'Cancel',
      })
      // Nothing changed yet.
      expect(useTodoStore.getState().todos[0]!.dueDate).toEqual(day(3))
    })

    it('create mode: the draft due date lights Urgent with the clock; clearing removes the draft date', async () => {
      const { onCreate } = renderCreateMode()
      typeTitle('Call plumber')
      fireEvent.change(screen.getByTitle('Set due date').querySelector('input')!, { target: { value: '2026-10-11' } })
      const urgent = () => screen.getByRole('button', { name: 'Urgent' })
      expect(urgent()).toHaveAttribute('data-urgent', 'date')

      fireEvent.click(urgent())
      const prompt = useUIStore.getState().bulkConfirmation!
      expect(prompt.title).toBe('Remove the due date?')
      act(() => { prompt.onConfirm!() })
      expect(urgent()).toHaveAttribute('aria-pressed', 'false')

      fireEvent.click(urgent())
      fireEvent.click(screen.getByRole('button', { name: 'Important' }))
      await act(async () => { clickCreate() })
      expect(onCreate).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Call plumber', urgent: true, important: true, dueDate: undefined }),
        expect.anything(),
      )
    })
  })

  describe('edit mode — due date', () => {
    it('labels the date row "Due" and has no scheduled row', () => {
      renderEditMode(makeTodo({ id: 5, title: 'Dated', dueDate: new Date(2026, 3, 20) }))
      expect(screen.getByText('Due')).toBeInTheDocument()
      expect(screen.queryByText('Deadline')).toBeNull()
      expect(screen.queryByText('Scheduled')).toBeNull()
    })

    it('offers repeat only with a due date; clearing the due date drops the rule', () => {
      const todo = makeTodo({
        id: 6, title: 'Water plants', dueDate: new Date(2026, 3, 20), recurrenceRule: { type: 'weekly' },
      })
      const { onUpdate } = renderEditMode(todo)
      expect(screen.getByDisplayValue('Weekly')).toBeInTheDocument()

      fireEvent.click(screen.getByTitle('Clear due date'))
      const updated = onUpdate.mock.calls.at(-1)![0] as PersistedTodoItem
      expect(updated.dueDate).toBeUndefined()
      expect(updated.recurrenceRule).toBeUndefined()
      expect(screen.queryByText('No repeat')).toBeNull()
    })
  })

  describe('slash commands', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date(2026, 9, 10, 15, 30)) // Sat 10 Oct 2026
      useStatusStore.setState({ statuses: [{ id: 5, name: 'Waiting', color: '#fa0', sortOrder: 0 }] })
    })
    afterEach(() => {
      vi.useRealTimers()
      useStatusStore.setState(useStatusStore.getInitialState(), true)
    })

    it('a Quick Add handoff fills the fields and drops the commands from the title', async () => {
      useUIStore.setState({
        quickAddDraft: { rawTitle: 'Call legal @Alice #urgent /urgent /important /focus /due fri /repeat weekly /followup 2w /status waiting' },
      })
      const { onCreate } = renderCreateMode()
      expect(screen.getByPlaceholderText(TITLE_PLACEHOLDER)).toHaveValue('Call legal @Alice #urgent')
      expect(screen.getByRole('button', { name: /Urgent/ })).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByRole('button', { name: /Important/ })).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByRole('button', { name: /Focus/ })).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByText(/Waiting/)).toBeInTheDocument()
      clickCreate()
      await waitFor(() => expect(onCreate).toHaveBeenCalled())
      const [partial, assignments] = onCreate.mock.calls[0]!
      expect(partial).toMatchObject({
        title: 'Call legal @Alice #urgent',
        urgent: true,
        important: true,
        focus: true,
        statusId: 5,
        dueDate: new Date(2026, 9, 16),
        nextFollowupAt: new Date(2026, 9, 24),
      })
      expect(partial.recurrenceRule?.type).toBe('weekly')
      expect(assignments.personIds).toEqual([1])
      expect(assignments.tagIds).toEqual([1])
    })

    it('a handoff with /followup none starts with no next follow-up', async () => {
      useUIStore.setState({ quickAddDraft: { rawTitle: 'Vendor /followup none' } })
      const { onCreate } = renderCreateMode()
      clickCreate()
      await waitFor(() => expect(onCreate).toHaveBeenCalled())
      const partial = onCreate.mock.calls[0]![0]
      expect('nextFollowupAt' in partial).toBe(true)
      expect(partial.nextFollowupAt).toBeUndefined()
    })

    it('/ opens the command menu in the create-mode title', () => {
      renderCreateMode()
      typeTitle('Call /')
      expect(screen.getByRole('listbox', { name: 'Commands' })).toBeInTheDocument()
      fireEvent.keyDown(screen.getByPlaceholderText(TITLE_PLACEHOLDER), { key: 'Enter' })
      expect(screen.getByPlaceholderText(TITLE_PLACEHOLDER)).toHaveValue('Call /urgent ')
    })

    it('/ is plain text in an existing task’s title', () => {
      renderEditMode(makeTodo({ id: 7, title: 'Existing' }) as PersistedTodoItem)
      fireEvent.change(screen.getByDisplayValue('Existing'), { target: { value: 'Existing /' } })
      expect(screen.queryByRole('listbox', { name: 'Commands' })).not.toBeInTheDocument()
    })
  })
})

describe('TaskEditPopup — a create that fails', () => {
  beforeEach(resetStores)
  afterEach(cleanup)

  it('stays open with every field as typed; Create task again creates and closes', async () => {
    const onCreate = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(43)
    const { onClose } = renderCreateMode({ onCreate })
    typeTitle('Write report')
    fireEvent.change(screen.getByPlaceholderText('e.g. 50% done, Waiting on review...'), { target: { value: 'Outline done' } })
    fireEvent.click(screen.getByRole('button', { name: /Urgent/ }))

    clickCreate()
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1))
    await act(async () => {})
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByPlaceholderText(TITLE_PLACEHOLDER)).toHaveValue('Write report')
    expect(screen.getByPlaceholderText('e.g. 50% done, Waiting on review...')).toHaveValue('Outline done')
    expect(screen.getByRole('button', { name: /Urgent/ })).toHaveAttribute('aria-pressed', 'true')

    clickCreate()
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(onCreate).toHaveBeenCalledTimes(2)
    expect(onCreate.mock.calls[1]![0]).toEqual(onCreate.mock.calls[0]![0])
  })
})
