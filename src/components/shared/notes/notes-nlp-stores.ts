import type { Person, Status, Tag } from '../../../models'
import {
  personItems,
  statusItems,
  tagItems,
  type AutocompleteItem,
} from '../../../services/nlp-autocomplete'
import { usePersonStore } from '../../../stores/person-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useStatusStore } from '../../../stores/status-store'
import { useTagStore } from '../../../stores/tag-store'
import { TagLimitError } from '../../../utils/tags'
import type { NotesNlpConfig } from './notes-nlp'

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
 * (`getOrCreate`) or tag (`add`, lookup-or-create) straight away. `onError`
 * gets a user-facing message when that fails (e.g. the tag limit).
 */
export function storeNotesNlpConfig(onError?: (message: string) => void): NotesNlpConfig {
  const people = memoBy<Person, AutocompleteItem[]>(personItems)
  const tags = memoBy<Tag, AutocompleteItem[]>(tagItems)
  const statuses = memoBy<Status, AutocompleteItem[]>(statusItems)
  return {
    sources: () => ({
      people: people(usePersonStore.getState().people),
      tags: tags(useTagStore.getState().tags),
      statuses: statuses(useStatusStore.getState().statuses),
      commands: true,
      followupDefault: useSettingsStore.getState().followupDefaultInterval,
      today: new Date(),
    }),
    resolverData: () => ({
      people: usePersonStore.getState().people,
      statuses: useStatusStore.getState().statuses,
    }),
    onCreate: (trigger, name) => {
      const created = trigger === '@'
        ? usePersonStore.getState().getOrCreate(name)
        : useTagStore.getState().add(name)
      created.catch((err: unknown) => {
        onError?.(err instanceof TagLimitError ? err.message : `Couldn't create ${trigger}${name}`)
      })
    },
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
