import { useMemo } from 'react'
import type { PersistedListDefinition } from '../models/list-definition'
import { useListDefinitionStore } from '../stores/list-definition-store'
import { draftListIds, useListDraftStore } from '../stores/list-draft-store'

/** The list as shown: its unsaved draft, else the saved definition. */
export function useEffectiveListDefinition(id: number | undefined): PersistedListDefinition | undefined {
  const saved = useListDefinitionStore((s) => (id != null ? s.listDefinitions.find((d) => d.id === id) : undefined))
  const draft = useListDraftStore((s) => (id != null ? s.drafts[id] : undefined))
  return saved ? (draft ?? saved) : undefined
}

/** Whether the list has unsaved edits. */
export function useIsListDirty(id: number | undefined): boolean {
  const hasSaved = useListDefinitionStore((s) => id != null && s.listDefinitions.some((d) => d.id === id))
  const hasDraft = useListDraftStore((s) => id != null && s.drafts[id] != null)
  return hasSaved && hasDraft
}

/** Ids of the lists with unsaved edits, kept current. */
export function useUnsavedListIds(): number[] {
  const drafts = useListDraftStore((s) => s.drafts)
  const defs = useListDefinitionStore((s) => s.listDefinitions)
  return useMemo(() => draftListIds(drafts, defs), [drafts, defs])
}
