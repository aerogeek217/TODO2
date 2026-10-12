import { create } from 'zustand'
import type { Person } from '../models'
import { db, personRepository } from '../data'
import { captureJoinRows } from '../data/join-helpers'
import { createAssignmentActions, type LoadAssignmentsOptions } from './assignment-helpers'
import { loadWithState, optimistic, updateEntityInMap, makeEnsureLoaded } from './store-helpers'
import { undoable } from '../services/undoable'
import { generateInitials, withEmail } from '../utils/person'

interface PersonState {
  people: Person[]
  assignedPeopleMap: Map<number, Person[]>
  loading: boolean
  error: string | null

  load: () => Promise<void>
  ensureLoaded: () => Promise<void>
  /** Adds a person; `email` is stored trimmed and dropped when empty. */
  add: (name: string, initials: string, color?: string, email?: string) => Promise<number>
  /**
   * Lookup-or-create by name (the people counterpart of `useTagStore.add`):
   * an existing person whose name matches case-insensitively is reused;
   * otherwise a new person is created with initials from `generateInitials`
   * and no color. Returns the person's id.
   */
  getOrCreate: (name: string) => Promise<number>
  /** Replaces the person row; `email` is stored trimmed and dropped when empty. */
  update: (person: Person) => Promise<void>
  remove: (id: number) => Promise<void>
  loadAssignments: (todoIds: number[], options?: LoadAssignmentsOptions) => Promise<void>
  assignPerson: (todoId: number, personId: number) => Promise<void>
  unassignPerson: (todoId: number, personId: number) => Promise<void>
  bulkAssignPerson: (todoIds: number[], personId: number) => Promise<void>
  bulkUnassignPerson: (todoIds: number[], personId: number) => Promise<void>
  getAssignedPeople: (todoId: number) => Person[]
}

export const usePersonStore = create<PersonState>((set, get) => {
  const personEnsure = makeEnsureLoaded(() => get().load())
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
    ensureLoaded: () => personEnsure.ensureLoaded(),

    async add(name: string, initials: string, color?: string, email?: string) {
      const person = withEmail<Person>({ name, initials, ...(color ? { color } : {}) }, email)
      const id = await personRepository.insert(person)
      set({ people: [...get().people, { ...person, id }] })
      return id
    },

    async getOrCreate(name: string) {
      const trimmed = name.trim()
      const target = trimmed.toLowerCase()
      const existing = get().people.find(
        (p) => p.id !== undefined && p.name.trim().toLowerCase() === target,
      )
      if (existing?.id !== undefined) return existing.id
      const person = await personRepository.getOrCreate(trimmed, generateInitials(trimmed))
      if (!get().people.some((p) => p.id === person.id)) {
        set({ people: [...get().people, person] })
      }
      return person.id
    },

    async update(input: Person) {
      const person = withEmail(input, input.email)
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
      ])
      await personRepository.delete(id)
      const prevMap = get().assignedPeopleMap
      const nextMap = new Map(
        Array.from(prevMap, ([k, people]) => [k, people.filter((p) => p.id !== id)] as const),
      )
      set({
        people: get().people.filter((p) => p.id !== id),
        assignedPeopleMap: nextMap,
      })
      if (person) {
        undoable(
          `Delete person "${person.name}"`,
          () => get().remove(id),
          async () => {
            await personRepository.restoreWithJoins(person, joins)
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
