import { describe, expect, it } from 'vitest'
import { textMatchContextFor, todoNameLookups } from '../../utils/filter'

describe('todoNameLookups', () => {
  it('builds every map the search reads, statuses by id (one without an id skipped)', () => {
    const lookups = todoNameLookups({
      assignedPeopleMap: new Map([[1, [{ id: 3, name: 'Ann', initials: 'AN' }]]]),
      assignedTagsMap: new Map([[1, [{ id: 4, name: 'ops', color: '#000' }]]]),
      statuses: [{ id: 2, name: 'Waiting', color: '#000', icon: 'circle', sortOrder: 0 }, { name: 'Draft', color: '#000', icon: 'circle', sortOrder: 1 }],
      statusUpdatesByTodo: new Map([[1, [{ todoId: 1, date: new Date(), text: 'Called', createdAt: new Date() }]]]),
      subtasksByTodo: new Map([[1, [{ todoId: 1, title: 'Book', isCompleted: false, sortOrder: 0, createdAt: new Date() }]]]),
    })
    expect([...lookups.statusesById.keys()]).toEqual([2])
    expect(textMatchContextFor({ id: 1, statusId: 2 }, lookups)).toEqual({
      personNames: ['Ann'],
      statusName: 'Waiting',
      tagNames: ['ops'],
      statusUpdateTexts: ['Called'],
      subtaskTitles: ['Book'],
    })
  })
})
