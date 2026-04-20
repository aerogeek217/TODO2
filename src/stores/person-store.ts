import { create } from 'zustand'
import type { Person } from '../models'
import { db, personRepository } from '../data'
import { createAssignmentActions } from './assignment-helpers'
import { loadWithState, optimistic, updateEntityInMap, captureJoinRows, restoreEntityWithJoins } from './store-helpers'
import { undoable } from '../services/undoable'

interface PersonState {
  people: Person[]
  assignedPeopleMap: Map<number, Person[]>
  loading: boolean
  error: string | null

  load: () => Promise<void>
  add: (name: string, initials: string) => Promise<number>
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
    set,
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

    async add(name: string, initials: string) {
      const id = await personRepository.insert({ name, initials })
      set({ people: [...get().people, { id, name, initials }] })
      return id
    },

    async update(person: Person) {
      const prevPeople = get().people
      const prevMap = get().assignedPeopleMap
      return optimistic(
        set,
        () => set({
          people: prevPeople.map((p) => (p.id === person.id ? { ...person } : p)),
          assignedPeopleMap: updateEntityInMap(person, prevMap),
        }),
        () => personRepository.update(person),
        () => set({ people: prevPeople, assignedPeopleMap: prevMap }),
        'Failed to update person',
      )
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
            const { useTodoStore } = await import('./todo-store')
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
