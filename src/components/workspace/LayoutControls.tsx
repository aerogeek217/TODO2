import { useRef, useState } from 'react'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { MenuPopover, type MenuEntry } from '../shared/MenuPopover'
import { useUnsavedListIds } from '../../stores/list-draft-store'
import { DeleteLayoutDialog, LayoutNameDialog } from './LayoutDialogs'
import { UnsavedPrompt } from './UnsavedPrompt'
import { ChevronDownIcon, CopyIcon, LayoutIcon, PencilIcon, RevertIcon, SaveIcon, TrashIcon } from '../shared/icons'
import styles from './LayoutControls.module.css'

type Pending =
  | { kind: 'switch'; id: number; name: string }
  | { kind: 'save-as' }
  | { kind: 'rename' }
  | { kind: 'delete' }

/**
 * Top-bar layout chrome on the workspace: the layout picker (switch, save,
 * save as, discard, rename, delete) and the save button, lit while the open
 * layout has unsaved changes. Switching away from unsaved changes (to the
 * layout or to a list) asks Save / Discard / Cancel first.
 */
export function LayoutControls() {
  const layouts = useWorkspaceStore((s) => s.layouts)
  const working = useWorkspaceStore((s) => s.working)
  const isDirty = useWorkspaceStore((s) => s.isDirty)
  const activeLayoutId = useWorkspaceStore((s) => s.activeLayoutId)
  const unsavedLists = useUnsavedListIds()
  const [menuOpen, setMenuOpen] = useState(false)
  const [pending, setPending] = useState<Pending | null>(null)
  const pickerRef = useRef<HTMLButtonElement | null>(null)

  if (!working) return null
  const store = useWorkspaceStore.getState
  const name = working.name

  const switchTo = (id: number, targetName: string) => {
    if (id === activeLayoutId) return
    if (isDirty || unsavedLists.length > 0) setPending({ kind: 'switch', id, name: targetName })
    else void store().load(id)
  }

  const entries: MenuEntry[] = [
    { kind: 'label', text: 'Layouts' },
    ...layouts.map((l): MenuEntry => ({
      kind: 'item',
      label: l.name,
      icon: <LayoutIcon />,
      radio: true,
      checked: l.id === activeLayoutId,
      note: l.id === activeLayoutId && isDirty ? 'Edited' : undefined,
      onSelect: () => switchTo(l.id, l.name),
    })),
    { kind: 'separator' },
    { kind: 'item', label: 'Save changes', icon: <SaveIcon />, disabled: !isDirty, onSelect: () => { void store().save() } },
    { kind: 'item', label: 'Save as new layout…', icon: <CopyIcon />, onSelect: () => setPending({ kind: 'save-as' }) },
    { kind: 'item', label: 'Discard changes', icon: <RevertIcon />, disabled: !isDirty, onSelect: () => store().discard() },
    { kind: 'item', label: 'Rename…', icon: <PencilIcon />, onSelect: () => setPending({ kind: 'rename' }) },
    { kind: 'separator' },
    {
      kind: 'item',
      label: 'Delete layout…',
      icon: <TrashIcon />,
      danger: true,
      disabled: layouts.length <= 1,
      onSelect: () => setPending({ kind: 'delete' }),
    },
  ]

  const close = () => setPending(null)

  return (
    <div className={styles.controls}>
      <button
        ref={pickerRef}
        type="button"
        className={`${styles.picker} ${menuOpen ? styles.pickerOpen : ''}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label={`Layout: ${name}`}
        onClick={() => setMenuOpen((o) => !o)}
        data-testid="layout-picker"
      >
        <span className={styles.glyph}><LayoutIcon /></span>
        <span className={styles.name}>{name}</span>
        <ChevronDownIcon />
      </button>
      <button
        type="button"
        className={`${styles.save} ${isDirty ? styles.saveDirty : ''}`}
        aria-label={isDirty ? 'Save layout (unsaved changes)' : 'Layout saved'}
        title={isDirty ? 'Save layout · unsaved changes' : 'Layout saved'}
        aria-disabled={!isDirty}
        data-testid="layout-save"
        onClick={() => { if (isDirty) void store().save() }}
      >
        <SaveIcon />
      </button>

      {menuOpen && (
        <MenuPopover
          anchorRef={pickerRef}
          width={260}
          label="Layouts"
          entries={entries}
          onClose={() => setMenuOpen(false)}
        />
      )}
      {pending?.kind === 'switch' && (
        <UnsavedPrompt
          lead={`You’re switching to layout “${pending.name}”.`}
          layoutLead={`You’re switching to “${pending.name}”.`}
          layout={isDirty}
          listIds={unsavedLists}
          onDone={() => { close(); void store().load(pending.id) }}
          onCancel={close}
        />
      )}
      {pending?.kind === 'save-as' && (
        <LayoutNameDialog
          title="Save as new layout"
          confirmLabel="Save layout"
          initialName={`${name} copy`}
          onConfirm={(n) => { close(); void store().saveAs(n) }}
          onCancel={close}
        />
      )}
      {pending?.kind === 'rename' && activeLayoutId != null && (
        <LayoutNameDialog
          title="Rename layout"
          confirmLabel="Rename"
          initialName={name}
          onConfirm={(n) => { close(); void store().rename(activeLayoutId, n) }}
          onCancel={close}
        />
      )}
      {pending?.kind === 'delete' && activeLayoutId != null && (
        <DeleteLayoutDialog
          layoutName={name}
          onConfirm={() => { close(); void store().delete(activeLayoutId) }}
          onCancel={close}
        />
      )}
    </div>
  )
}
