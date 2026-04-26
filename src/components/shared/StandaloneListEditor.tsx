import { useCallback, useEffect, useMemo, useState } from 'react'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { useUIStore } from '../../stores/ui-store'
import type { PersistedListDefinition } from '../../models/list-definition'
import { defsEqual } from '../../utils/list-def-equal'
import { ListEditorBody } from './ListEditorBody'
import { ListEditorDialog } from './ListEditorDialog'

/**
 * Direct list-editor dialog mounted by `CanvasPage` (triage-2026-04-26 P5 /
 * Q7=A). Drives the "Edit list" entry from a tab pill / float's
 * widget-kind menu (`SlotRenderer` + `ListInsetNode`) — the editor opens
 * over a dimmed canvas with NO `DashboardListsEditor` (Lists manager modal)
 * underneath. Subscribes to `useUIStore.listEditorDialogId` for its open
 * state and target def; the manager surface remains the entry point for
 * Settings → "Lists" and the on-canvas list-create-then-edit flow.
 */
export function StandaloneListEditor() {
  const id = useUIStore((s) => s.listEditorDialogId)
  const closeDialog = useUIStore((s) => s.closeListEditorDialog)
  const showBulkConfirmation = useUIStore((s) => s.showBulkConfirmation)
  const editingList = useListDefinitionStore((s) =>
    id == null ? null : s.listDefinitions.find((d) => d.id === id) ?? null,
  )
  const update = useListDefinitionStore((s) => s.update)
  const setFavorited = useListDefinitionStore((s) => s.setFavorited)

  const [draft, setDraft] = useState<PersistedListDefinition | null>(null)

  useEffect(() => {
    if (!editingList) {
      setDraft(null)
      return
    }
    setDraft((prev) => {
      if (!prev || prev.id !== editingList.id) return editingList
      const dirty = !defsEqual(prev, editingList)
      if (!dirty) return editingList
      return {
        ...prev,
        favorited: editingList.favorited,
        pinnedToDashboard: editingList.pinnedToDashboard,
        sortOrder: editingList.sortOrder,
      }
    })
  }, [editingList])

  const dirty = useMemo(() => {
    if (!draft || !editingList) return false
    return !defsEqual(draft, editingList)
  }, [draft, editingList])

  const guardDirty = useCallback(
    (perform: () => void) => {
      if (!dirty) {
        perform()
        return
      }
      showBulkConfirmation('custom', [], {
        title: 'Discard changes?',
        message: 'Unsaved changes to this list will be lost.',
        confirmLabel: 'Discard',
        onConfirm: perform,
      })
    },
    [dirty, showBulkConfirmation],
  )

  const handleClose = useCallback(() => {
    guardDirty(closeDialog)
  }, [guardDirty, closeDialog])

  const handleSave = useCallback(() => {
    if (!draft) {
      closeDialog()
      return
    }
    const trimmedName = draft.name.trim()
    if (!trimmedName) {
      // Match `rename()`'s validation — refuse to save an empty name.
      // Editor stays open so the user can fix it.
      return
    }
    if (dirty) {
      void update({ ...draft, name: trimmedName })
    }
    closeDialog()
  }, [draft, dirty, update, closeDialog])

  const handleToggleFavorite = useCallback(() => {
    if (!editingList) return
    void setFavorited(editingList.id, !editingList.favorited)
  }, [editingList, setFavorited])

  return (
    <ListEditorDialog
      open={!!editingList && !!draft}
      list={
        editingList
          ? { id: editingList.id, name: editingList.name, favorited: editingList.favorited }
          : null
      }
      onClose={handleClose}
      onSave={handleSave}
      onToggleFavorite={handleToggleFavorite}
    >
      {draft && <ListEditorBody draft={draft} onChange={setDraft} />}
    </ListEditorDialog>
  )
}
