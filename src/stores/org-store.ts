import { create } from 'zustand'
import type { Org } from '../models'
import { db, orgRepository } from '../data'
import { createAssignmentActions } from './assignment-helpers'
import { loadWithState, optimistic, updateEntityInMap, captureJoinRows, restoreEntityWithJoins } from './store-helpers'
import { DEFAULT_ENTITY_COLOR } from '../constants'
import { undoable } from '../services/undoable'

interface OrgState {
  orgs: Org[]
  assignedOrgsMap: Map<number, Org[]>
  /** Map of personId → orgId[] for person-org membership */
  personOrgMap: Map<number, number[]>
  loading: boolean
  error: string | null

  load: () => Promise<void>
  add: (name: string, color?: string, initials?: string) => Promise<number>
  update: (org: Org) => Promise<void>
  remove: (id: number) => Promise<void>
  loadAssignments: (todoIds: number[]) => Promise<void>
  loadPersonOrgMap: () => Promise<void>
  assignOrg: (todoId: number, orgId: number) => Promise<void>
  unassignOrg: (todoId: number, orgId: number) => Promise<void>
  bulkAssignOrg: (todoIds: number[], orgId: number) => Promise<void>
  bulkUnassignOrg: (todoIds: number[], orgId: number) => Promise<void>
  getAssignedOrgs: (todoId: number) => Org[]
}

export const useOrgStore = create<OrgState>((set, get) => {
  const assignment = createAssignmentActions(
    {
      repo: {
        assign: orgRepository.assignOrg,
        unassign: orgRepository.unassignOrg,
        getForTodos: orgRepository.getAssignedOrgsForTodos,
      },
      label: 'org',
      getName: (o) => o.name,
    },
    () => get().orgs,
    () => get().assignedOrgsMap,
    (map) => set({ assignedOrgsMap: map }),
    set,
  )

  return {
    orgs: [],
    assignedOrgsMap: new Map(),
    personOrgMap: new Map(),
    loading: false,
    error: null,

    async load() {
      const orgs = await loadWithState(set, () => orgRepository.getAll(), 'orgs')
      if (orgs) set({ orgs })
    },

    async loadPersonOrgMap() {
      const map = await orgRepository.getPersonOrgMap()
      set({ personOrgMap: map })
    },

    async add(name: string, color = DEFAULT_ENTITY_COLOR, initials?: string) {
      const org: Org = { name, color, ...(initials ? { initials } : {}) }
      const id = await orgRepository.insert(org)
      set({ orgs: [...get().orgs, { ...org, id }] })
      return id
    },

    async update(org: Org) {
      const prevOrgs = get().orgs
      const prevMap = get().assignedOrgsMap
      return optimistic(
        set,
        () => set({
          orgs: prevOrgs.map((o) => (o.id === org.id ? { ...org } : o)),
          assignedOrgsMap: updateEntityInMap(org, prevMap),
        }),
        () => orgRepository.update(org),
        () => set({ orgs: prevOrgs, assignedOrgsMap: prevMap }),
        'Failed to update org',
      )
    },

    async remove(id: number) {
      const org = get().orgs.find((o) => o.id === id)
      const joins = await captureJoinRows([
        { table: db.personOrgs, key: 'orgId', id },
        { table: db.todoOrgs, key: 'orgId', id },
      ])
      await orgRepository.delete(id)
      const prevMap = get().assignedOrgsMap
      const nextMap = new Map(
        Array.from(prevMap, ([k, orgs]) => [k, orgs.filter((o) => o.id !== id)] as const),
      )
      set({
        orgs: get().orgs.filter((o) => o.id !== id),
        assignedOrgsMap: nextMap,
      })
      if (org) {
        undoable(
          `Delete org "${org.name}"`,
          () => get().remove(id),
          async () => {
            await restoreEntityWithJoins(db.orgs, org, joins)
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
    assignOrg: assignment.assign,
    unassignOrg: assignment.unassign,
    bulkAssignOrg: assignment.bulkAssign,
    bulkUnassignOrg: assignment.bulkUnassign,

    getAssignedOrgs(todoId: number) {
      return get().assignedOrgsMap.get(todoId) ?? []
    },
  }
})
