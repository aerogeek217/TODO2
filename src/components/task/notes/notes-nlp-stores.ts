import type { Person, Status, Tag } from '../../../models'
import {
  personItems,
  statusItems,
  tagItems,
  type AutocompleteItem,
} from '../../../services/nlp-autocomplete'
import { usePersonStore } from '../../../stores/person-store'
import { autoFollowupInterval, useSettingsStore } from '../../../stores/settings-store'
import { useStatusStore } from '../../../stores/status-store'
import { useTagStore } from '../../../stores/tag-store'
import type { NotesNlpConfig } from './notes-nlp'
import { createNlpEntity } from '../../../services/nlp-create'

/** `build(list)`, recomputed only when the list itself changes. */
function memoBy<T, R>(build: (list: readonly T[]) => R): (list: readonly T[]) => R {
  let last: readonly T[] | null = null
  let result: R
  return (list) => {
    if (list !== last) {
      last = list
      result = build(list)
    }
    return result
  }
}

/**
 * The notes autocomplete over the live stores: people / tags / statuses and
 * the default follow-up as candidates; a picked create row creates the person
 * or tag straight away (`services/nlp-create`); when that fails it rejects
 * with a user-facing message.
 */
export function storeNotesNlpConfig(): NotesNlpConfig {
  const people = memoBy<Person, AutocompleteItem[]>(personItems)
  const tags = memoBy<Tag, AutocompleteItem[]>(tagItems)
  const statuses = memoBy<Status, AutocompleteItem[]>(statusItems)
  return {
    sources: () => ({
      people: people(usePersonStore.getState().people),
      tags: tags(useTagStore.getState().tags),
      statuses: statuses(useStatusStore.getState().statuses),
      commands: true,
      followupDefault: autoFollowupInterval(useSettingsStore.getState()),
      today: new Date(),
    }),
    resolverData: () => ({
      people: usePersonStore.getState().people,
      statuses: useStatusStore.getState().statuses,
    }),
    onCreate: createNlpEntity,
    subscribe: (listener) => {
      const unsubs = [
        usePersonStore.subscribe((s, prev) => { if (s.people !== prev.people) listener() }),
        useTagStore.subscribe((s, prev) => { if (s.tags !== prev.tags) listener() }),
        useStatusStore.subscribe((s, prev) => { if (s.statuses !== prev.statuses) listener() }),
      ]
      return () => unsubs.forEach((u) => u())
    },
  }
}
