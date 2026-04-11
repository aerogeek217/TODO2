import { create } from 'zustand'
import type { Person } from '../models'
import { db, personRepository } from '../data'
import { createAssignmentActions } from './assignment-helpers'
import { loadWithState, updateEntityInMap, captureJoinRows, restoreEntityWithJoins } from './store-helpers'
import { undoable } from '../services/undoable'
import { useTodoStore } from './todo-store'

interface PersonState {
  people: Person[]
  assignedPeopleMap: Map<number, Person[]>
  loading: boolean
  error: string | null

  load: () => Promise<void>
  add: (name: string, initials: string, color?: string) => Promise<number>
  update: (person: Person) => Promise<void>
  remove: (id: number) => Promise<void>
  loadAssignments: (todoIds: number[]) => Promise<void>
  assignPerson: (todoId: number, personId: number) => Promise<void>
  unassignPerson: (todoId: number, personId: number) => Promise<void>
  bulkAssignPerson: (todoIds: number[], personId: number) => Promise<void>
  bulkUnassignPerson: (todoIds: number[], personId: number) => Promise<void>
  getAssignedPeople: (todoId: number) => Person[]
}

export const usePersonStore = create<PersonState>((set, get) => {
  const assignment = createAssignmentActions(
    {
      repo: {
        assign: personRepository.assignPerson,
        unassign: personRepository.unassignPerson,
        getForTodos: personRepository.getAssignedPeopleForTodos,
      },
      label: 'person',
      getName: (p) => p.name,
    },
    () => get().people,
    () => get().assignedPeopleMap,
    (map) => set({ assignedPeopleMap: map }),
  )

  return {
    people: [],
    assignedPeopleMap: new Map(),
    loading: false,
    error: null,

    async load() {
      const people = await loadWithState(set, () => personRepository.getAll(), 'people')
      if (people) set({ people })
    },

    async add(name: string, initials: string, color = '#ffffff') {
      const id = await personRepository.insert({ name, initials, color })
      set({ people: [...get().people, { id, name, initials, color }] })
      return id
    },

    async update(person: Person) {
      await personRepository.update(person)
      set({
        people: get().people.map((p) => (p.id === person.id ? { ...person } : p)),
        assignedPeopleMap: updateEntityInMap(person, get().assignedPeopleMap),
      })
    },

    async remove(id: number) {
      const person = get().people.find((p) => p.id === id)
      const joins = await captureJoinRows([
        { table: db.todoPeople, key: 'personId', id },
        { table: db.personOrgs, key: 'personId', id },
      ])
      await personRepository.delete(id)
      set({ people: get().people.filter((p) => p.id !== id) })
      if (person) {
        undoable(
          `Delete person "${person.name}"`,
          () => get().remove(id),
          async () => {
            await restoreEntityWithJoins(db.people, person, joins)
            await get().load()
            const todoIds = useTodoStore.getState().todos.map(t => t.id)
            await get().loadAssignments(todoIds)
          },
          true,
        )
      }
    },

    loadAssignments: assignment.loadAssignments,
    assignPerson: assignment.assign,
    unassignPerson: assignment.unassign,
    bulkAssignPerson: assignment.bulkAssign,
    bulkUnassignPerson: assignment.bulkUnassign,

    getAssignedPeople(todoId: number) {
      return get().assignedPeopleMap.get(todoId) ?? []
    },
  }
})
