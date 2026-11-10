import type { PersistedListDefinition } from '../models/list-definition'
import { useListDefinitionStore } from '../stores/list-definition-store'
import { useListDraftStore } from '../stores/list-draft-store'

/** The list as shown (`listAsShown`): Edit list's draft while it is open on it, else the saved definition. */
export function useEffectiveListDefinition(id: number | undefined): PersistedListDefinition | undefined {
  const saved = useListDefinitionStore((s) => (id != null ? s.listDefinitions.find((d) => d.id === id) : undefined))
  const draft = useListDraftStore((s) => (id != null ? s.drafts[id] : undefined))
  return saved ? (draft ?? saved) : undefined
}
