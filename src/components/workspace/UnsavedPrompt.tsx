import { useRef, useState } from 'react'
import { Dialog, DialogActions, DialogBody } from '../shared/Dialog'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { useListDraftStore } from '../../stores/list-draft-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { countListWidgets } from '../../hooks/use-list-widget-count'
import styles from './LayoutDialogs.module.css'

interface UnsavedPromptProps {
  /**
   * What the user is about to do, as a sentence: `You’re switching to layout
   * “Daily”.`, `You’re leaving the workspace.`
   */
  lead: string
  /** Lists with unsaved edits to ask about. */
  listIds: readonly number[]
  /** After Save / Discard: carry on with what the user was doing. */
  onDone: () => void
  onCancel: () => void
}

/**
 * Save / Discard / Cancel before unsaved list edits would be lost: a list's
 * prompt when one list is unsaved, else one combined prompt with a checked
 * row per list (unchecking one discards it). (Layouts are saved at once:
 * nothing about them is asked.)
 */
export function UnsavedPrompt({ lead, listIds, onDone, onCancel }: UnsavedPromptProps) {
  const [only] = listIds
  if (listIds.length === 1 && only != null) {
    return <UnsavedListDialog listId={only} onDone={onDone} onCancel={onCancel} />
  }
  return <CombinedDialog lead={lead} listIds={listIds} onDone={onDone} onCancel={onCancel} />
}

function listName(id: number): string {
  const drafts = useListDraftStore.getState().drafts
  const saved = useListDefinitionStore.getState().listDefinitions.find((d) => d.id === id)
  return saved?.name ?? drafts[id]?.name ?? 'List'
}

function widgetCount(id: number): number {
  return countListWidgets(useWorkspaceStore.getState(), id)
}

/** "Save changes to list …?" for one list. */
function UnsavedListDialog({ listId, onDone, onCancel }: {
  listId: number
  onDone: () => void
  onCancel: () => void
}) {
  const saveRef = useRef<HTMLButtonElement>(null)
  // A save in flight: a second press waits for it (cr31 W8).
  const [busy, setBusy] = useState(false)
  const name = listName(listId)
  const n = widgetCount(listId)
  const body = n <= 1
    ? 'Your changes will be lost if you don’t save.'
    : `This list is shown in ${n} widgets. Saving updates ${n === 2 ? 'both' : 'all of them'}.`
  return (
    <Dialog open onClose={onCancel} title={`Save changes to list “${name}”?`} initialFocusRef={saveRef} nested>
      <DialogBody>{body}</DialogBody>
      <DialogActions className={styles.actions}>
        <button
          type="button"
          className={styles.dangerGhost}
          disabled={busy}
          onClick={() => {
            useListDraftStore.getState().discard(listId)
            onDone()
          }}
        >
          Discard
        </button>
        <span className={styles.spacer} />
        <button type="button" className={styles.ghost} onClick={onCancel}>
          Cancel <kbd className={styles.kbd}>Esc</kbd>
        </button>
        <button
          ref={saveRef}
          type="button"
          className={styles.primary}
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void useListDraftStore.getState().save(listId).then(() => {
              setBusy(false)
              // Not stored (the store kept the draft and said so): the prompt stays.
              if (listId in useListDraftStore.getState().drafts) return
              onDone()
            })
          }}
        >
          Save list
        </button>
      </DialogActions>
    </Dialog>
  )
}

/** "Save your changes?" with one checked row per unsaved list. */
function CombinedDialog({ lead, listIds, onDone, onCancel }: UnsavedPromptProps) {
  const saveRef = useRef<HTMLButtonElement>(null)
  const items = listIds.map((id) => {
    const n = widgetCount(id)
    return { key: `list-${id}`, label: `List “${listName(id)}”`, note: n === 1 ? '1 widget' : `${n} widgets` }
  })
  const [checked, setChecked] = useState<ReadonlySet<string>>(() => new Set(items.map((i) => i.key)))
  const toggle = (key: string) => setChecked((prev) => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })

  // A finish in flight: the buttons wait for it, so a double click saves once (cr31 W8).
  const [busy, setBusy] = useState(false)
  const finish = async (save: ReadonlySet<string>) => {
    if (busy) return
    setBusy(true)
    try {
      const drafts = useListDraftStore.getState()
      let failed = false
      for (const id of listIds) {
        if (save.has(`list-${id}`)) {
          await drafts.save(id)
          // Not stored: the store kept its draft; the prompt stays to say so.
          if (id in useListDraftStore.getState().drafts) failed = true
        } else drafts.discard(id)
      }
      if (failed) return
      onDone()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onClose={onCancel} title="Save your changes?" initialFocusRef={saveRef} nested>
      <DialogBody>
        {lead} These have unsaved changes:
        <div className={styles.unsavedItems}>
          {items.map((item) => (
            <label key={item.key} className={styles.unsavedItem}>
              <input type="checkbox" checked={checked.has(item.key)} onChange={() => toggle(item.key)} />
              <span className={styles.unsavedName}>{item.label}</span>
              {item.note && <span className={styles.unsavedNote}>{item.note}</span>}
            </label>
          ))}
        </div>
      </DialogBody>
      <DialogActions className={styles.actions}>
        <button type="button" className={styles.dangerGhost} disabled={busy} onClick={() => { void finish(new Set()) }}>Discard all</button>
        <span className={styles.spacer} />
        <button type="button" className={styles.ghost} onClick={onCancel}>
          Cancel <kbd className={styles.kbd}>Esc</kbd>
        </button>
        <button ref={saveRef} type="button" className={styles.primary} disabled={busy || checked.size === 0} onClick={() => { void finish(checked) }}>
          Save {checked.size} checked
        </button>
      </DialogActions>
    </Dialog>
  )
}
