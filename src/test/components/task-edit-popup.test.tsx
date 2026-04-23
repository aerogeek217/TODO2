import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { TaskEditPopup } from '../../components/task/TaskEditPopup'
import { useProjectStore } from '../../stores/project-store'
import { useSettingsStore } from '../../stores/settings-store'
import { makePerson, makeOrg, makeTodo } from '../helpers'
import type { Person, Org, Tag, PersistedTodoItem } from '../../models'

// Suppress showPicker (not supported in jsdom)
beforeEach(() => {
  HTMLInputElement.prototype.showPicker = vi.fn()
})

const TITLE_PLACEHOLDER = 'New task... (@person @org #tag /project tomorrow "this week")'

const alice: Person & { id: number } = makePerson({ id: 1, name: 'Alice' })
const bob: Person & { id: number } = makePerson({ id: 2, name: 'Bob' })
const acmeOrg: Org & { id: number } = makeOrg({ id: 1, name: 'Acme' })
const globexOrg: Org & { id: number } = makeOrg({ id: 2, name: 'Globex' })
const urgentTag: Tag & { id: number } = { id: 1, name: 'urgent', color: '#f00' }
const followupTag: Tag & { id: number } = { id: 2, name: 'followup', color: '#0a0' }

function resetStores() {
  useProjectStore.setState({ projects: [] })
  useSettingsStore.setState({ defaultProjectId: undefined, themeMode: 'dark' })
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
  fireEvent.click(addButtons[0])
}

function openTagsDropdown() {
  const addButtons = screen.getAllByText('+ Add')
  fireEvent.click(addButtons[1])
}

function renderCreateMode(overrides: Record<string, unknown> = {}) {
  const onCreate = vi.fn().mockResolvedValue(42)
  const onClose = vi.fn()

  const props = {
    mode: 'create' as const,
    assignedPeople: [],
    allPeople: [alice, bob],
    assignedOrgs: [],
    allOrgs: [acmeOrg, globexOrg],
    assignedTags: [],
    allTags: [urgentTag, followupTag],
    onClose,
    onCreate,
    onAssignPerson: vi.fn(),
    onUnassignPerson: vi.fn(),
    onAssignOrg: vi.fn(),
    onUnassignOrg: vi.fn(),
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
  const onAssignOrg = vi.fn()
  const onUnassignOrg = vi.fn()
  const onAssignTag = vi.fn()
  const onUnassignTag = vi.fn()
  const onCreateTag = vi.fn().mockResolvedValue(77)

  const props = {
    mode: 'edit' as const,
    todo,
    assignedPeople: [alice],
    allPeople: [alice, bob],
    assignedOrgs: [],
    allOrgs: [acmeOrg, globexOrg],
    assignedTags: [],
    allTags: [urgentTag, followupTag],
    onClose: vi.fn(),
    onUpdate,
    onToggleComplete: vi.fn(),
    onToggleStar: vi.fn(),
    onDelete: vi.fn(),
    onAssignPerson,
    onUnassignPerson,
    onAssignOrg,
    onUnassignOrg,
    onAssignTag,
    onUnassignTag,
    onCreateTag,
    ...overrides,
  }

  const result = render(<TaskEditPopup {...props} />)
  return { ...result, onUpdate, onAssignPerson, onUnassignPerson, onAssignOrg, onUnassignOrg, onAssignTag, onUnassignTag, onCreateTag }
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
      fireEvent.click(screen.getByText('Alice'))

      // Person chip appears with @ prefix (distinct from dropdown item)
      expect(screen.getByText('@Alice')).toBeInTheDocument()

      typeTitle('Test task')
      clickCreate()

      await vi.waitFor(() => {
        expect(onCreate).toHaveBeenCalledOnce()
      })

      const [partial, assignments] = onCreate.mock.calls[0]
      expect(partial.title).toBe('Test task')
      expect(assignments.personIds).toEqual([1])
      expect(assignments.orgIds).toEqual([])
    })

    it('toggling an org includes it in onCreate assignments', async () => {
      const { onCreate } = renderCreateMode()

      openPeopleDropdown() // orgs are in the people dropdown
      fireEvent.click(screen.getByText('Acme'))

      typeTitle('Org task')
      clickCreate()

      await vi.waitFor(() => {
        expect(onCreate).toHaveBeenCalledOnce()
      })

      const [, assignments] = onCreate.mock.calls[0]
      expect(assignments.orgIds).toEqual([1])
      expect(assignments.personIds).toEqual([])
    })

    it('toggling a person twice removes them from pending', async () => {
      const { onCreate } = renderCreateMode()

      // Toggle Alice on
      openPeopleDropdown()
      fireEvent.click(screen.getByText('Alice'))
      expect(screen.getByText('@Alice')).toBeInTheDocument()

      // Toggle Alice off (dropdown is still open, click Alice again in the list)
      fireEvent.click(screen.getByText('Alice'))
      expect(screen.queryByText('@Alice')).not.toBeInTheDocument()

      typeTitle('No person')
      clickCreate()

      await vi.waitFor(() => {
        expect(onCreate).toHaveBeenCalledOnce()
      })

      const [, assignments] = onCreate.mock.calls[0]
      expect(assignments.personIds).toEqual([])
    })

    it('selecting multiple people includes all in onCreate', async () => {
      const { onCreate } = renderCreateMode()

      // Add Alice and Bob
      openPeopleDropdown()
      fireEvent.click(screen.getByText('Alice'))
      fireEvent.click(screen.getByText('Bob'))

      typeTitle('Multi assign')
      clickCreate()

      await vi.waitFor(() => {
        expect(onCreate).toHaveBeenCalledOnce()
      })

      const [, assignments] = onCreate.mock.calls[0]
      expect(assignments.personIds).toContain(1)
      expect(assignments.personIds).toContain(2)
    })

    it('creating a new person adds them to pending assignments', async () => {
      const onCreatePerson = vi.fn().mockResolvedValue(50)
      const { onCreate } = renderCreateMode({ onCreatePerson })

      openPeopleDropdown()

      const searchInput = screen.getByPlaceholderText('Search people & orgs...')
      fireEvent.change(searchInput, { target: { value: 'Charlie' } })
      fireEvent.click(screen.getByText('+ Create "Charlie"'))

      await vi.waitFor(() => {
        expect(onCreatePerson).toHaveBeenCalledWith('Charlie')
      })

      typeTitle('New person task')
      clickCreate()

      await vi.waitFor(() => {
        expect(onCreate).toHaveBeenCalledOnce()
      })

      const [, assignments] = onCreate.mock.calls[0]
      expect(assignments.personIds).toContain(50)
    })

    it('does not call the no-op assignment callbacks in create mode', () => {
      const { props } = renderCreateMode()

      // Toggle person and org in the same dropdown session
      openPeopleDropdown()
      fireEvent.click(screen.getByText('Alice'))
      fireEvent.click(screen.getByText('Acme'))
      expect(props.onAssignPerson).not.toHaveBeenCalled()
      expect(props.onUnassignPerson).not.toHaveBeenCalled()
      expect(props.onAssignOrg).not.toHaveBeenCalled()
      expect(props.onUnassignOrg).not.toHaveBeenCalled()
    })

    it('empty assignments are passed when no chips selected', async () => {
      const { onCreate } = renderCreateMode()

      typeTitle('Plain task')
      clickCreate()

      await vi.waitFor(() => {
        expect(onCreate).toHaveBeenCalledOnce()
      })

      const [, assignments] = onCreate.mock.calls[0]
      expect(assignments.personIds).toEqual([])
      expect(assignments.orgIds).toEqual([])
    })
  })

  describe('edit mode — callbacks', () => {
    it('toggling a person calls onAssignPerson/onUnassignPerson', () => {
      const todo = makeTodo({ id: 10, title: 'Edit task' })
      const { onAssignPerson, onUnassignPerson } = renderEditMode(todo)

      openPeopleDropdown()

      // Alice is already assigned — toggling should unassign
      fireEvent.click(screen.getByText('Alice'))
      expect(onUnassignPerson).toHaveBeenCalledWith(1)

      // Bob is not assigned — toggling should assign
      fireEvent.click(screen.getByText('Bob'))
      expect(onAssignPerson).toHaveBeenCalledWith(2)
    })

    it('toggling an org calls onAssignOrg/onUnassignOrg', () => {
      const todo = makeTodo({ id: 10, title: 'Edit task' })
      const { onAssignOrg } = renderEditMode(todo)

      openPeopleDropdown()

      fireEvent.click(screen.getByText('Acme'))
      expect(onAssignOrg).toHaveBeenCalledWith(1)
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

      const [partial, assignments] = onCreate.mock.calls[0]
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

      const [, assignments] = onCreate.mock.calls[0]
      expect(assignments.tagIds).toEqual([])
    })

    it('inline-creating a tag calls onCreateTag and adds it to pending', async () => {
      const onCreateTag = vi.fn().mockResolvedValue(50)
      const { onCreate } = renderCreateMode({ onCreateTag })

      openTagsDropdown()

      const searchInput = screen.getByPlaceholderText('Search tags...')
      fireEvent.change(searchInput, { target: { value: 'blocker' } })
      fireEvent.click(screen.getByText('+ Create "blocker"'))

      await vi.waitFor(() => {
        expect(onCreateTag).toHaveBeenCalledWith('blocker')
      })

      typeTitle('Blocker task')
      clickCreate()

      await vi.waitFor(() => {
        expect(onCreate).toHaveBeenCalledOnce()
      })

      const [, assignments] = onCreate.mock.calls[0]
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

      const [, assignments] = onCreate.mock.calls[0]
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
      fireEvent.click(screen.getByText('+ Create "newtag"'))

      await vi.waitFor(() => {
        expect(onCreateTag).toHaveBeenCalledWith('newtag')
      })
      await vi.waitFor(() => {
        expect(onAssignTag).toHaveBeenCalledWith(99)
      })
    })
  })
})
