import { useMemo } from 'react'
import type { PersistedListDefinition } from '../models/list-definition'
import { useListDefinitionStore } from '../stores/list-definition-store'
import { useListDraftStore } from '../stores/list-draft-store'
import { usePersonStore } from '../stores/person-store'
import { useSettingsStore } from '../stores/settings-store'
import { useStatusStore } from '../stores/status-store'
import { useTagStore } from '../stores/tag-store'
import { useWorkspaceStore } from '../stores/workspace-store'
import { filterChips, listFilterHint } from '../utils/filter-chips'
import { copySourceGroups, type CopySourceGroup, type CopySourceRef } from '../utils/list-copy'

/** A list Copy from offers. */
export interface CopySource extends CopySourceRef {
  /** The list as it shows: its unsaved draft, else the saved list. */
  def: PersistedListDefinition
  /** Its name as it shows (a blank draft name reads as the saved one). */
  name: string
  /** Its filters in a few words (`listFilterHint`). */
  hint: string
}

/**
 * Copy from's choices (`copySourceGroups`): every layout's lists by layout,
 * the open layout's first, then the Eisenhower's — each list as it shows,
 * with its filters in words. `excludeId`: the list being edited.
 */
export function useCopySources(excludeId?: number): CopySourceGroup<CopySource>[] {
  const defs = useListDefinitionStore((s) => s.listDefinitions)
  const drafts = useListDraftStore((s) => s.drafts)
  const layouts = useWorkspaceStore((s) => s.layouts)
  const openLayoutId = useWorkspaceStore((s) => s.saved?.id)
  const eisenhowerListId = useSettingsStore((s) => s.eisenhowerListId)
  const people = usePersonStore((s) => s.people)
  const tags = useTagStore((s) => s.tags)
  const statuses = useStatusStore((s) => s.statuses)
  return useMemo(() => {
    const names = { people, tags, statuses }
    // Grouped by the saved list's owner and order (a draft keeps both).
    const lists = defs.map((saved): CopySource => {
      const def = drafts[saved.id] ?? saved
      return {
        id: saved.id,
        owner: saved.owner,
        sortOrder: saved.sortOrder,
        def,
        name: def.name.trim() || saved.name,
        hint: listFilterHint(filterChips(def.membership.predicate, names)),
      }
    })
    return copySourceGroups({ lists, layouts, openLayoutId, eisenhowerListId, excludeId })
  }, [defs, drafts, layouts, openLayoutId, eisenhowerListId, excludeId, people, tags, statuses])
}
