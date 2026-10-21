import { useEffect, useMemo } from 'react'
import type { Person, Tag } from '../models'
import { useListDefinitionStore } from '../stores/list-definition-store'
import { useListDraftStore } from '../stores/list-draft-store'
import { usePersonStore } from '../stores/person-store'
import { useSettingsStore } from '../stores/settings-store'
import { useTagStore } from '../stores/tag-store'
import { useTodoStore } from '../stores/todo-store'
import { entityTaskUse, filterReferences, findUnused, type FilterSources, type UnusedEntry } from '../utils/unused-entities'
import { usePersonAssignmentsForLoadedTodos, useTagAssignmentsForLoadedTodos } from './use-entity-assignments-for-todos'

export interface UnusedEntities {
  /** Every task and its people and tags are loaded: until then nothing is listed (everyone would look unused). */
  ready: boolean
  people: UnusedEntry<Person>[]
  tags: UnusedEntry<Tag>[]
}

/**
 * The people and tags no task carries (with `ignoreCompleted`, also those
 * only completed tasks carry), each with where the filters name it — every
 * list (saved or as edited), the Eisenhower panes, the check-in filter.
 * Loads every task and its assignments, as the People / Tags editors do, and
 * follows them live (a task deleted or completed meanwhile, a removal).
 */
export function useUnusedEntities(ignoreCompleted: boolean): UnusedEntities {
  const todos = useTodoStore((s) => s.todos)
  const todosLoaded = useTodoStore((s) => s.loaded)
  const people = usePersonStore((s) => s.people)
  const peopleLoaded = usePersonStore((s) => s.loaded)
  const assignedPeopleMap = usePersonStore((s) => s.assignedPeopleMap)
  const tags = useTagStore((s) => s.tags)
  const tagsLoaded = useTagStore((s) => s.loaded)
  const assignedTagsMap = useTagStore((s) => s.assignedTagsMap)
  const lists = useListDefinitionStore((s) => s.listDefinitions)
  const listsLoaded = useListDefinitionStore((s) => s.loaded)
  const drafts = useListDraftStore((s) => s.drafts)
  const panes = useSettingsStore((s) => s.eisenhowerPanes)
  const checkinFilter = useSettingsStore((s) => s.checkinTaskFilter)

  useEffect(() => {
    void useTodoStore.getState().ensureAllLoaded()
    void usePersonStore.getState().ensureLoaded()
    void useTagStore.getState().ensureLoaded()
    void useListDefinitionStore.getState().ensureLoaded()
  }, [])
  usePersonAssignmentsForLoadedTodos()
  useTagAssignmentsForLoadedTodos()

  const ready = todosLoaded && peopleLoaded && tagsLoaded && listsLoaded
    && todos.every((t) => assignedPeopleMap.has(t.id) && assignedTagsMap.has(t.id))

  const sources = useMemo<FilterSources>(() => ({ lists, drafts, panes, checkinFilter }), [lists, drafts, panes, checkinFilter])
  const unusedPeople = useMemo(
    () => findUnused(people, entityTaskUse(todos, assignedPeopleMap), filterReferences(sources, 'person'), ignoreCompleted),
    [people, todos, assignedPeopleMap, sources, ignoreCompleted],
  )
  const unusedTags = useMemo(
    () => findUnused(tags, entityTaskUse(todos, assignedTagsMap), filterReferences(sources, 'tag'), ignoreCompleted),
    [tags, todos, assignedTagsMap, sources, ignoreCompleted],
  )
  return ready ? { ready, people: unusedPeople, tags: unusedTags } : { ready, people: [], tags: [] }
}
