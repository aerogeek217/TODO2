import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import { UnusedEntitiesDialog } from '../../../components/settings/UnusedEntitiesDialog'
import { db } from '../../../data/database'
import { backupScheduler } from '../../../data/backup-scheduler'
import { emptyPredicate } from '../../../models'
import { useSettingsStore } from '../../../stores/settings-store'
import { useUndoStore } from '../../../stores/undo-store'
import { makeTodo, resetDb } from '../../helpers'

/**
 * Ann: only on a completed task. Bob: on an open task. Cal: on nothing, named
 * in a list filter. Dee: on nothing.
 * old: only on a completed task. keep: on an open task. spare: on nothing,
 * in the check-in filter.
 */
async function seed() {
  await db.todos.bulkAdd([makeTodo({ id: 1, title: 'Open' }), makeTodo({ id: 2, title: 'Done', isCompleted: true })])
  await db.people.bulkAdd([
    { id: 1, name: 'Ann', initials: 'AN' },
    { id: 2, name: 'Bob', initials: 'BO' },
    { id: 3, name: 'Cal', initials: 'CA' },
    { id: 4, name: 'Dee', initials: 'DE' },
  ])
  await db.tags.bulkAdd([
    { id: 10, name: 'old', color: '#f00' },
    { id: 11, name: 'keep', color: '#0f0' },
    { id: 12, name: 'spare', color: '#00f' },
  ])
  await db.todoPeople.bulkAdd([{ todoId: 2, personId: 1 }, { todoId: 1, personId: 2 }])
  await db.todoTags.bulkAdd([{ todoId: 2, tagId: 10 }, { todoId: 1, tagId: 11 }])
  await db.listDefinitions.add({
    id: 1,
    name: 'Cal’s',
    sortOrder: 0,
    membership: { kind: 'custom', predicate: { ...emptyPredicate(), personIds: [3] } },
    sort: 'manual',
    grouping: 'none',
    owner: { layoutId: 1 },
  })
  useSettingsStore.setState({ checkinTaskFilter: { ...emptyPredicate(), tags: [12] } })
}

const group = (name: 'People' | 'Tags') => screen.getByRole('group', { name })
const rowNames = (name: 'People' | 'Tags') =>
  within(group(name)).queryAllByRole('listitem').map((li) => li.textContent)
const removeButton = () => screen.getByRole('button', { name: /^Remove \d+…$/ })
const confirmDialog = () => screen.findByRole('dialog', { name: /^Remove \d+ / })
const onClose = vi.fn()

beforeEach(async () => {
  await resetDb()
  vi.spyOn(backupScheduler, 'snapshotBeforeDestructive').mockResolvedValue(undefined as never)
  await seed()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('UnusedEntitiesDialog', () => {
  it('lists the people and tags no task has, unticked, with a note when a filter names them', async () => {
    render(<UnusedEntitiesDialog onClose={onClose} />)
    await waitFor(() => expect(rowNames('People')).toEqual(['CACalin a list filter', 'DEDee']))
    expect(rowNames('Tags')).toEqual(['sparein the check-in filter'])
    for (const box of screen.getAllByRole('checkbox', { name: /Cal|Dee|spare/ })) expect(box).not.toBeChecked()
    const ignore = screen.getByRole('checkbox', { name: 'Ignore completed tasks' })
    expect(ignore).not.toBeChecked()
    expect(ignore).toHaveAccessibleDescription('Also list people and tags that only completed tasks have.')
    expect(removeButton()).toHaveTextContent('Remove 0…')
    expect(removeButton()).toBeDisabled()
  })

  it('Ignore completed tasks also lists those only completed tasks have; turning it off drops their ticks', async () => {
    render(<UnusedEntitiesDialog onClose={onClose} />)
    await waitFor(() => expect(rowNames('People')).toHaveLength(2))
    fireEvent.click(screen.getByRole('checkbox', { name: /Ignore completed tasks/ }))
    expect(rowNames('People')).toEqual(['ANAnnon 1 completed task', 'CACalin a list filter', 'DEDee'])
    expect(rowNames('Tags')).toEqual(['oldon 1 completed task', 'sparein the check-in filter'])

    fireEvent.click(screen.getByRole('checkbox', { name: /Ann/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Dee/ }))
    expect(removeButton()).toHaveTextContent('Remove 2…')
    fireEvent.click(screen.getByRole('checkbox', { name: /Ignore completed tasks/ }))
    expect(rowNames('People')).toEqual(['CACalin a list filter', 'DEDee'])
    expect(removeButton()).toHaveTextContent('Remove 1…')
  })

  it('Select all ticks every row of its group, filter-named ones included, and clears them again', async () => {
    render(<UnusedEntitiesDialog onClose={onClose} />)
    await waitFor(() => expect(rowNames('People')).toHaveLength(2))
    const all = screen.getByRole('checkbox', { name: 'Select all people' })
    fireEvent.click(screen.getByRole('checkbox', { name: /Dee/ }))
    expect((all as HTMLInputElement).indeterminate).toBe(true)
    fireEvent.click(all)
    expect(screen.getByRole('checkbox', { name: /Cal/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Dee/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /spare/ })).not.toBeChecked()
    expect(removeButton()).toHaveTextContent('Remove 2…')
    fireEvent.click(all)
    expect(removeButton()).toHaveTextContent('Remove 0…')
  })

  it('says so when a group has nothing unused', async () => {
    await db.todoTags.add({ todoId: 1, tagId: 12 })
    render(<UnusedEntitiesDialog onClose={onClose} />)
    await waitFor(() => expect(within(group('Tags')).getByText('No unused tags')).toBeInTheDocument())
    expect(screen.queryByRole('checkbox', { name: 'Select all tags' })).toBeNull()
  })

  it('Remove N… asks first with the counts (Cancel focused); Cancel keeps everything', async () => {
    render(<UnusedEntitiesDialog onClose={onClose} />)
    await waitFor(() => expect(rowNames('People')).toHaveLength(2))
    fireEvent.click(screen.getByRole('checkbox', { name: /Ignore completed tasks/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all people' }))
    fireEvent.click(screen.getByRole('checkbox', { name: /old/ }))
    fireEvent.click(removeButton())

    const dialog = await confirmDialog()
    expect(within(dialog).getByText('Remove 3 people and 1 tag?')).toBeInTheDocument()
    expect(within(dialog).getByText('They’re removed from 1 completed task.')).toBeInTheDocument()
    expect(within(dialog).getByText('1 is named in filters, which will stop matching it.')).toBeInTheDocument()
    expect(within(dialog).getByText('You can undo this.')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /^Remove/ })).toBeNull())
    expect(screen.getByRole('dialog', { name: 'Unused people & tags' })).toBeInTheDocument()
    expect(await db.people.count()).toBe(4)
  })

  it('confirming removes the ticked ones, with Undo in the snackbar', async () => {
    render(<UnusedEntitiesDialog onClose={onClose} />)
    await waitFor(() => expect(rowNames('People')).toHaveLength(2))
    fireEvent.click(screen.getByRole('checkbox', { name: /Dee/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /spare/ }))
    fireEvent.click(removeButton())
    fireEvent.click(within(await confirmDialog()).getByRole('button', { name: 'Remove' }))

    await waitFor(() => expect(rowNames('People')).toEqual(['CACalin a list filter']))
    expect(within(group('Tags')).getByText('No unused tags')).toBeInTheDocument()
    expect(await db.people.get(4)).toBeUndefined()
    expect(await db.tags.get(12)).toBeUndefined()
    expect(useUndoStore.getState().snackbar?.description).toBe('Remove 1 person and 1 tag')
    expect(removeButton()).toHaveTextContent('Remove 0…')

    await useUndoStore.getState().undo()
    await waitFor(() => expect(rowNames('People')).toEqual(['CACalin a list filter', 'DEDee']))
    expect(screen.getByRole('checkbox', { name: /Dee/ })).not.toBeChecked()
  })

  it('a task deleted meanwhile frees its people and tags', async () => {
    const { useTodoStore } = await import('../../../stores/todo-store')
    render(<UnusedEntitiesDialog onClose={onClose} />)
    await waitFor(() => expect(rowNames('People')).toHaveLength(2))
    await useTodoStore.getState().remove(1)
    await waitFor(() => expect(rowNames('People')).toEqual(['BOBob', 'CACalin a list filter', 'DEDee']))
    expect(rowNames('Tags')).toEqual(['keep', 'sparein the check-in filter'])
  })
})
