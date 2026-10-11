import { useCallback, useMemo } from 'react'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { useUIStore } from '../../stores/ui-store'
import { defsEqual } from '../../utils/list-def-equal'
import { ListEditorBody } from './ListEditorBody'
import { ListEditorDialog } from './ListEditorDialog'
import { useListDefDraft } from '../../hooks/use-list-def-draft'
import { useEffectiveListDefinition, useListDraftStore } from '../../stores/list-draft-store'
import { useListWidgetCount } from '../workspace/widget-hooks'

/**
 * The "Edit list…" dialog opened from a list widget's tab menu or options
 * (`useUIStore.listEditorDialogId`). It starts from the list as shown — its
 * unsaved inline edits, if any. Save writes the definition at once (the
 * inline edits with it); Cancel drops only the dialog's own edits.
 */
export function StandaloneListEditor() {
  const id = useUIStore((s) => s.listEditorDialogId)
  const closeDialog = useUIStore((s) => s.closeListEditorDialog)
  const showBulkConfirmation = useUIStore((s) => s.showBulkConfirmation)
  // Starts from the list as shown: its unsaved inline edits, if any.
  const editingList = useEffectiveListDefinition(id ?? undefined) ?? null
  const update = useListDefinitionStore((s) => s.update)
  const widgetCount = useListWidgetCount(id ?? undefined)


  const [draft, setDraft] = useListDefDraft(editingList)

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
    // Saving writes the definition at once — including any unsaved inline
    // edits it started from, which are then no longer unsaved.
    void update({ ...draft, name: trimmedName })
    useListDraftStore.getState().discard(draft.id)
    closeDialog()
  }, [draft, update, closeDialog])

  return (
    <ListEditorDialog
      open={!!editingList && !!draft}
      list={editingList ? { id: editingList.id, name: editingList.name } : null}
      widgetCount={widgetCount}
      onClose={handleClose}
      onSave={handleSave}
    >
      {draft && <ListEditorBody draft={draft} onChange={setDraft} />}
    </ListEditorDialog>
  )
}
