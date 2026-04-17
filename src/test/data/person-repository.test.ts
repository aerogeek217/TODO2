import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { personRepository } from '../../data/person-repository'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('personRepository', () => {
  it('insert and retrieve person', async () => {
    const id = await personRepository.insert({ name: 'Alice', initials: 'A', color: '#ff0000' })
    const person = await personRepository.getById(id)
    expect(person).toBeDefined()
    expect(person!.name).toBe('Alice')
    expect(person!.id).toBe(id)
  })

  it('getAll returns sorted by name', async () => {
    await personRepository.insert({ name: 'Zara', initials: 'Z', color: '#000' })
    await personRepository.insert({ name: 'Alice', initials: 'A', color: '#000' })
    await personRepository.insert({ name: 'Mike', initials: 'M', color: '#000' })

    const all = await personRepository.getAll()
    expect(all.map(p => p.name)).toEqual(['Alice', 'Mike', 'Zara'])
  })

  it('update modifies fields', async () => {
    const id = await personRepository.insert({ name: 'Alice', initials: 'A', color: '#ff0000' })
    await personRepository.update({ id, name: 'Alice Smith', initials: 'AS', color: '#00ff00' })
    const person = await personRepository.getById(id)
    expect(person!.name).toBe('Alice Smith')
    expect(person!.color).toBe('#00ff00')
  })

  it('delete removes person AND todoPeople join entries', async () => {
    const personId = await personRepository.insert({ name: 'Alice', initials: 'A', color: '#000' })
    const todoId = (await db.todos.add({
      title: 'Task', isCompleted: false,
      createdAt: new Date(), modifiedAt: new Date(), sortOrder: 1,
    })) as number
    await personRepository.assignPerson(todoId, personId)

    await personRepository.delete(personId)
    expect(await personRepository.getById(personId)).toBeUndefined()
    const links = await db.todoPeople.where('personId').equals(personId).toArray()
    expect(links).toHaveLength(0)
  })

  it('getAssignedPeople returns people for a todo', async () => {
    const p1 = await personRepository.insert({ name: 'Alice', initials: 'A', color: '#000' })
    const p2 = await personRepository.insert({ name: 'Bob', initials: 'B', color: '#000' })
    const todoId = (await db.todos.add({
      title: 'Task', isCompleted: false,
      createdAt: new Date(), modifiedAt: new Date(), sortOrder: 1,
    })) as number
    await personRepository.assignPerson(todoId, p1)
    await personRepository.assignPerson(todoId, p2)

    const people = await personRepository.getAssignedPeople(todoId)
    expect(people).toHaveLength(2)
    expect(people.map(p => p.name).sort()).toEqual(['Alice', 'Bob'])
  })

  it('assignPerson creates link; idempotent on duplicate', async () => {
    const personId = await personRepository.insert({ name: 'Alice', initials: 'A', color: '#000' })
    const todoId = (await db.todos.add({
      title: 'Task', isCompleted: false,
      createdAt: new Date(), modifiedAt: new Date(), sortOrder: 1,
    })) as number

    await personRepository.assignPerson(todoId, personId)
    await personRepository.assignPerson(todoId, personId) // duplicate
    const links = await db.todoPeople.where('todoId').equals(todoId).toArray()
    expect(links).toHaveLength(1)
  })

  it('unassignPerson removes link', async () => {
    const personId = await personRepository.insert({ name: 'Alice', initials: 'A', color: '#000' })
    const todoId = (await db.todos.add({
      title: 'Task', isCompleted: false,
      createdAt: new Date(), modifiedAt: new Date(), sortOrder: 1,
    })) as number

    await personRepository.assignPerson(todoId, personId)
    await personRepository.unassignPerson(todoId, personId)
    const people = await personRepository.getAssignedPeople(todoId)
    expect(people).toHaveLength(0)
  })

  it('removeAllAssignments clears links for a todo', async () => {
    const p1 = await personRepository.insert({ name: 'Alice', initials: 'A', color: '#000' })
    const p2 = await personRepository.insert({ name: 'Bob', initials: 'B', color: '#000' })
    const todoId = (await db.todos.add({
      title: 'Task', isCompleted: false,
      createdAt: new Date(), modifiedAt: new Date(), sortOrder: 1,
    })) as number
    await personRepository.assignPerson(todoId, p1)
    await personRepository.assignPerson(todoId, p2)

    await personRepository.removeAllAssignments(todoId)
    const people = await personRepository.getAssignedPeople(todoId)
    expect(people).toHaveLength(0)
  })

  it('getTodoIdsForPerson returns linked todo ids', async () => {
    const personId = await personRepository.insert({ name: 'Alice', initials: 'A', color: '#000' })
    const t1 = (await db.todos.add({
      title: 'Task 1', isCompleted: false,
      createdAt: new Date(), modifiedAt: new Date(), sortOrder: 1,
    })) as number
    const t2 = (await db.todos.add({
      title: 'Task 2', isCompleted: false,
      createdAt: new Date(), modifiedAt: new Date(), sortOrder: 2,
    })) as number

    await personRepository.assignPerson(t1, personId)
    await personRepository.assignPerson(t2, personId)

    const todoIds = await personRepository.getTodoIdsForPerson(personId)
    expect(todoIds.sort()).toEqual([t1, t2].sort())
  })
})
