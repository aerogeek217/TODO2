import { useRef, useState } from 'react'
import { Dialog, DialogActions, DialogBody } from '../shared/Dialog'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { useListDraftStore } from '../../stores/list-draft-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { UnsavedChangesDialog } from './LayoutDialogs'
import { countListWidgets } from '../../hooks/use-list-widget-count'
import { ownerLayoutId } from '../../models/list-definition'
import { layoutListRefs } from '../../utils/workspace-layout-ops'
import styles from './LayoutDialogs.module.css'

interface UnsavedPromptProps {
  /**
   * What the user is about to do, as a sentence: `You’re switching to layout
   * “Daily”.`, `You’re leaving the workspace.`
   */
  lead: string
  /** The layout name to use in the single-layout prompt's lead (`You’re switching to “Daily”.`). */
  layoutLead?: string
  /** Ask about the open layout's unsaved changes. */
  layout: boolean
  /** Lists with unsaved edits to ask about. */
  listIds: readonly number[]
  /** After Save / Discard: carry on with what the user was doing. */
  onDone: () => void
  onCancel: () => void
}

/**
 * Save / Discard / Cancel before unsaved work would be lost: the layout's
 * prompt when only the layout is unsaved, a list's prompt when only one list
 * is, else one combined prompt with a checked row per item (unchecking an
 * item discards it).
 */
export function UnsavedPrompt({ lead, layoutLead, layout, listIds, onDone, onCancel }: UnsavedPromptProps) {
  const layoutName = useWorkspaceStore((s) => s.working?.name ?? '')
  if (layout && listIds.length === 0) {
    return (
      <UnsavedChangesDialog
        layoutName={layoutName}
        lead={layoutLead ?? lead}
        // A failed save keeps the prompt open (the snackbar says why), so
        // leaving never drops the changes it was asked to keep.
        onSave={() => { void useWorkspaceStore.getState().save().then((ok) => { if (ok) onDone() }) }}
        onDiscard={() => { useWorkspaceStore.getState().discard(); onDone() }}
        onCancel={onCancel}
      />
    )
  }
  const [only] = listIds
  if (!layout && listIds.length === 1 && only != null) {
    return <UnsavedListDialog listId={only} onDone={onDone} onCancel={onCancel} />
  }
  return <CombinedDialog lead={lead} layout={layout} listIds={listIds} onDone={onDone} onCancel={onCancel} />
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
function UnsavedListDialog({ listId, onDone, onCancel }: { listId: number; onDone: () => void; onCancel: () => void }) {
  const saveRef = useRef<HTMLButtonElement>(null)
  const name = listName(listId)
  const n = widgetCount(listId)
  const body = n <= 1
    ? 'Your changes will be lost if you don’t save.'
    : `This list is shown in ${n} widgets. Saving updates ${n === 2 ? 'both' : 'all of them'}.`
  return (
    <Dialog open onClose={onCancel} title={`Save changes to list “${name}”?`} initialFocusRef={saveRef} nested>
      <DialogBody>{body}</DialogBody>
      <DialogActions className={styles.actions}>
        <button type="button" className={styles.dangerGhost} onClick={() => { useListDraftStore.getState().discard(listId); onDone() }}>Discard</button>
        <span className={styles.spacer} />
        <button type="button" className={styles.ghost} onClick={onCancel}>
          Cancel <kbd className={styles.kbd}>Esc</kbd>
        </button>
        <button
          ref={saveRef}
          type="button"
          className={styles.primary}
          onClick={() => { void useListDraftStore.getState().save(listId).then(onDone) }}
        >
          Save list
        </button>
      </DialogActions>
    </Dialog>
  )
}

/** "Save your changes?" with one checked row per unsaved layout / list. */
/**
 * The open layout's own lists among `listIds` that only its unsaved edits
 * show: discarding the layout deletes them, so their rows follow its row.
 */
function listsMadeForEdits(listIds: readonly number[]): Set<number> {
  const { saved } = useWorkspaceStore.getState()
  if (!saved) return new Set()
  const shownSaved = layoutListRefs(saved)
  const defs = useListDefinitionStore.getState().listDefinitions
  return new Set(listIds.filter((id) => {
    const def = defs.find((d) => d.id === id)
    return def != null && ownerLayoutId(def) === saved.id && !shownSaved.has(id)
  }))
}

function CombinedDialog({ lead, layout, listIds, onDone, onCancel }: Omit<UnsavedPromptProps, 'layoutLead'>) {
  const saveRef = useRef<HTMLButtonElement>(null)
  const layoutName = useWorkspaceStore((s) => s.working?.name ?? '')
  const [followers] = useState(() => (layout ? listsMadeForEdits(listIds) : new Set<number>()))
  const items = [
    ...(layout ? [{ key: 'layout', label: `Layout “${layoutName}”`, note: '', follows: false }] : []),
    ...listIds.map((id) => {
      const follows = followers.has(id)
      const n = widgetCount(id)
      return {
        key: `list-${id}`,
        label: `List “${listName(id)}”`,
        note: follows ? 'goes with the layout changes' : n === 1 ? '1 widget' : `${n} widgets`,
        follows,
      }
    }),
  ]
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set(items.map((i) => i.key)))
  // A list made for the layout's edits is saved with them or goes with them.
  const checked: ReadonlySet<string> = new Set(items
    .filter((i) => (i.follows ? ticked.has('layout') : ticked.has(i.key)))
    .map((i) => i.key))
  const toggle = (key: string) => setTicked((prev) => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })

  const finish = async (save: ReadonlySet<string>) => {
    const workspace = useWorkspaceStore.getState()
    const drafts = useListDraftStore.getState()
    if (layout) {
      if (save.has('layout')) {
        // A failed save keeps the prompt open: leaving would drop the layout.
        if (!(await workspace.save())) return
      } else await workspace.discard()
    }
    for (const id of listIds) {
      if (save.has(`list-${id}`)) await drafts.save(id)
      // A list made for discarded layout edits is gone with its draft.
      else if (!(layout && followers.has(id) && !save.has('layout'))) drafts.discard(id)
    }
    onDone()
  }

  return (
    <Dialog open onClose={onCancel} title="Save your changes?" initialFocusRef={saveRef} nested>
      <DialogBody>
        {lead} These have unsaved changes:
        <div className={styles.unsavedItems}>
          {items.map((item) => (
            <label key={item.key} className={styles.unsavedItem}>
              <input type="checkbox" checked={checked.has(item.key)} disabled={item.follows} onChange={() => toggle(item.key)} />
              <span className={styles.unsavedName}>{item.label}</span>
              {item.note && <span className={styles.unsavedNote}>{item.note}</span>}
            </label>
          ))}
        </div>
      </DialogBody>
      <DialogActions className={styles.actions}>
        <button type="button" className={styles.dangerGhost} onClick={() => { void finish(new Set()) }}>Discard all</button>
        <span className={styles.spacer} />
        <button type="button" className={styles.ghost} onClick={onCancel}>
          Cancel <kbd className={styles.kbd}>Esc</kbd>
        </button>
        <button ref={saveRef} type="button" className={styles.primary} disabled={checked.size === 0} onClick={() => { void finish(checked) }}>
          Save {checked.size} checked
        </button>
      </DialogActions>
    </Dialog>
  )
}
