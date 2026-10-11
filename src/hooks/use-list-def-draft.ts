import { useState, type Dispatch, type SetStateAction } from 'react'
import type { PersistedListDefinition } from '../models/list-definition'
import { defsEqual } from '../utils/list-def-equal'

/**
 * Next draft when the upstream (persisted) def changes under an open editor.
 * A clean draft — or one for a different def — adopts upstream. A dirty draft
 * keeps the user's in-flight edits but forwards the externally-managed fields
 * (pin, sortOrder) so a reorder doesn't get reverted on Save.
 */
export function reconcileListDefDraft(
  prev: PersistedListDefinition | null,
  upstream: PersistedListDefinition | null,
): PersistedListDefinition | null {
  if (!upstream) return null
  if (!prev || prev.id !== upstream.id) return upstream
  if (defsEqual(prev, upstream)) return upstream
  return {
    ...prev,
    pinnedToDashboard: upstream.pinnedToDashboard,
    sortOrder: upstream.sortOrder,
  }
}

/**
 * Local edit draft for a list definition editor (Lists manager + standalone
 * dialog). Re-syncs via `reconcileListDefDraft` whenever the `upstream` def
 * identity changes. The sync runs during render (React's "adjust state when a
 * prop changes" pattern) rather than in an effect, so the editor never renders
 * a frame with a stale or null draft.
 */
export function useListDefDraft(
  upstream: PersistedListDefinition | null,
): [PersistedListDefinition | null, Dispatch<SetStateAction<PersistedListDefinition | null>>] {
  const [draft, setDraft] = useState<PersistedListDefinition | null>(upstream)
  const [syncedFrom, setSyncedFrom] = useState<PersistedListDefinition | null>(upstream)
  if (upstream !== syncedFrom) {
    setSyncedFrom(upstream)
    setDraft((prev) => reconcileListDefDraft(prev, upstream))
  }
  return [draft, setDraft]
}
