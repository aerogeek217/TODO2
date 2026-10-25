import { useRef, useState } from 'react'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { ownerLayoutId } from '../../models/list-definition'
import { UNSAVED_LAYOUT_ID } from '../../models/workspace-layout'
import { MenuPopover, type MenuEntry } from '../shared/MenuPopover'
import { useUnsavedListIds } from '../../hooks/use-list-draft'
import { DeleteLayoutDialog, LayoutNameDialog } from './LayoutDialogs'
import { LayoutTabs } from './LayoutTabs'
import { UnsavedPrompt } from './UnsavedPrompt'
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, CopyIcon, HuedLayoutIcon, PencilIcon, PlusIcon, RevertIcon, SaveIcon, TrashIcon } from '../shared/icons'
import styles from './LayoutControls.module.css'
import { withViewTransition } from '../shared/view-transition'

/** How the top bar shows the layouts: one tab each, or folded into the picker's drop-down. */
export type LayoutControlsMode = 'tabs' | 'menu'

/** A layout an action is for: a saved one by id, or (`null`) a kept new layout not saved yet. */
type LayoutRef = number | null

type Pending =
  | { kind: 'switch'; id: number; name: string }
  | { kind: 'new-name' }
  | { kind: 'new-confirm'; name: string }
  | { kind: 'save-as' }
  | { kind: 'save-new' }
  | { kind: 'rename'; id: LayoutRef; name: string }
  | { kind: 'delete'; id: LayoutRef; name: string }

/**
 * Top-bar layout chrome on the workspace: the layouts as tabs (`tabs`) or
 * the layout picker (`menu`, when the bar has no room for the tabs), then
 * the save button, lit while the open layout has unsaved changes.
 *
 * - Tabs: click opens a layout; right-click / Shift+F10 → its menu (the open
 *   one: Save changes, Save as new layout…, Discard changes; every one:
 *   Rename…, Move left / right, Delete layout…); drag to reorder; `+` = New layout.
 * - Picker: the layouts (drag to reorder), then New layout…, Save changes,
 *   Save as new layout…, Discard changes, Rename…, Delete layout….
 *
 * One order feeds both (the store's `layouts`); a reorder is saved at once,
 * not a layout change. New layout asks for a name and stores the empty
 * layout at once. Leaving unsaved changes (to the layout or to a list) for
 * another layout or a new one asks Save / Discard / Cancel first. A new
 * layout an older build kept unsaved shows as the open tab until saved —
 * its Save asks for a name — and deleting it just drops it.
 */
export function LayoutControls({ mode }: { mode: LayoutControlsMode }) {
  const layouts = useWorkspaceStore((s) => s.layouts)
  const working = useWorkspaceStore((s) => s.working)
  const isDirty = useWorkspaceStore((s) => s.isDirty)
  const activeLayoutId = useWorkspaceStore((s) => s.activeLayoutId)
  const isNew = useWorkspaceStore((s) => s.working !== null && s.saved === null)
  const unsavedLists = useUnsavedListIds()
  const [menuOpen, setMenuOpen] = useState(false)
  const [tabMenu, setTabMenu] = useState<{ id: LayoutRef; x: number; y: number } | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const pickerRef = useRef<HTMLButtonElement | null>(null)

  if (!working) return null
  const store = useWorkspaceStore.getState
  const name = working.name
  const unsaved = isDirty || unsavedLists.length > 0

  const close = () => setPending(null)
  const switchTo = (id: number, targetName: string) => {
    if (id === activeLayoutId) return
    if (unsaved) setPending({ kind: 'switch', id, name: targetName })
    else withViewTransition(() => store().load(id))
  }
  const create = (layoutName: string) => { void store().createLayout(layoutName) }
  // A kept new layout's Save asks for its name (Save as, under it).
  const saveOpen = () => {
    if (isNew) setPending({ kind: 'save-new' })
    else if (isDirty) void store().save()
  }
  const nameOf = (id: LayoutRef) => (id == null ? name : layouts.find((l) => l.id === id)?.name ?? '')
  const hueOf = (id: LayoutRef) => (id == null ? working.hue : layouts.find((l) => l.id === id)?.hue) ?? null
  const indexOf = (id: number) => layouts.findIndex((l) => l.id === id)
  const canDelete = (id: LayoutRef) => id == null || layouts.length > 1

  /** The open layout's actions (tab menu of the open tab, and the picker). */
  const openLayoutEntries: MenuEntry[] = [
    { kind: 'item', label: 'Save changes', icon: <SaveIcon />, disabled: !isDirty, onSelect: saveOpen },
    { kind: 'item', label: 'Save as new layout…', icon: <CopyIcon />, onSelect: () => setPending({ kind: 'save-as' }) },
    { kind: 'item', label: 'Discard changes', icon: <RevertIcon />, disabled: !isDirty, onSelect: () => store().discard() },
  ]

  const pickerEntries: MenuEntry[] = [
    { kind: 'label', text: 'Layouts' },
    ...layouts.map((l): MenuEntry => ({
      kind: 'item',
      label: l.name,
      icon: <HuedLayoutIcon hue={l.hue} />,
      radio: true,
      checked: l.id === activeLayoutId,
      note: l.id === activeLayoutId && isDirty ? 'Edited' : undefined,
      dragId: String(l.id),
      onSelect: () => switchTo(l.id, l.name),
    })),
    // A kept new layout, until it's saved.
    ...(isNew ? [{ kind: 'item' as const, label: name, icon: <HuedLayoutIcon hue={working.hue} />, radio: true, checked: true, note: 'New' }] : []),
    { kind: 'separator' },
    { kind: 'item', label: 'New layout…', icon: <PlusIcon />, onSelect: () => setPending({ kind: 'new-name' }) },
    ...openLayoutEntries,
    { kind: 'item', label: 'Rename…', icon: <PencilIcon />, onSelect: () => setPending({ kind: 'rename', id: isNew ? null : activeLayoutId, name }) },
    { kind: 'separator' },
    {
      kind: 'item',
      label: 'Delete layout…',
      icon: <TrashIcon />,
      danger: true,
      disabled: !canDelete(isNew ? null : activeLayoutId),
      onSelect: () => setPending({ kind: 'delete', id: isNew ? null : activeLayoutId, name }),
    },
  ]

  const tabMenuEntries = (id: LayoutRef): MenuEntry[] => {
    const open = id == null || id === activeLayoutId
    const index = id == null ? -1 : indexOf(id)
    return [
      ...(open ? [...openLayoutEntries, { kind: 'separator' as const }] : []),
      { kind: 'item', label: 'Rename…', icon: <PencilIcon />, onSelect: () => setPending({ kind: 'rename', id, name: nameOf(id) }) },
      {
        kind: 'item',
        label: 'Move left',
        icon: <ChevronLeftIcon />,
        disabled: index <= 0,
        onSelect: () => { if (id != null) void store().moveLayout(id, index - 1) },
      },
      {
        kind: 'item',
        label: 'Move right',
        icon: <ChevronRightIcon />,
        disabled: index < 0 || index >= layouts.length - 1,
        onSelect: () => { if (id != null) void store().moveLayout(id, index + 1) },
      },
      { kind: 'separator' },
      {
        kind: 'item',
        label: 'Delete layout…',
        icon: <TrashIcon />,
        danger: true,
        disabled: !canDelete(id),
        onSelect: () => setPending({ kind: 'delete', id, name: nameOf(id) }),
      },
    ]
  }

  return (
    <div className={styles.controls} data-layout-controls={mode}>
      {mode === 'tabs' ? (
        <LayoutTabs
          layouts={layouts}
          activeLayoutId={activeLayoutId}
          unsavedNew={isNew ? working : null}
          dirty={isDirty}
          onActivate={(l) => switchTo(l.id, l.name)}
          onOpenMenu={(id, p) => setTabMenu({ id, ...p })}
          onMove={(id, to) => { void store().moveLayout(id, to) }}
          onNew={() => setPending({ kind: 'new-name' })}
        />
      ) : (
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
          <span className={styles.glyph}><HuedLayoutIcon hue={working.hue} /></span>
          <span className={styles.name}>{name}</span>
          <ChevronDownIcon />
        </button>
      )}
      <button
        type="button"
        className={`${styles.save} ${isDirty ? styles.saveDirty : ''}`}
        aria-label={isDirty ? 'Save layout (unsaved changes)' : 'Layout saved'}
        title={isDirty ? 'Save layout · unsaved changes' : 'Layout saved'}
        aria-disabled={!isDirty}
        data-testid="layout-save"
        onClick={saveOpen}
      >
        <SaveIcon />
      </button>

      {menuOpen && mode === 'menu' && (
        <MenuPopover
          anchorRef={pickerRef}
          width={260}
          label="Layouts"
          entries={pickerEntries}
          onReorder={(dragId, to) => { void store().moveLayout(Number(dragId), to) }}
          onClose={() => setMenuOpen(false)}
        />
      )}
      {tabMenu && mode === 'tabs' && (
        <MenuPopover
          point={{ x: tabMenu.x, y: tabMenu.y }}
          width={220}
          label={`Layout ${nameOf(tabMenu.id)}`}
          entries={tabMenuEntries(tabMenu.id)}
          restoreFocus
          closeOnScroll
          onClose={() => setTabMenu(null)}
        />
      )}
      {pending?.kind === 'switch' && (
        <UnsavedPrompt
          lead={`You’re switching to layout “${pending.name}”.`}
          layoutLead={`You’re switching to “${pending.name}”.`}
          layout={isDirty}
          listIds={unsavedLists}
          onDone={() => { close(); withViewTransition(() => store().load(pending.id)) }}
          onCancel={close}
        />
      )}
      {pending?.kind === 'new-name' && (
        <LayoutNameDialog
          title="New layout"
          confirmLabel="Create layout"
          initialName=""
          placeholder="Layout name"
          onConfirm={(n) => {
            if (unsaved) setPending({ kind: 'new-confirm', name: n })
            else { close(); create(n) }
          }}
          onCancel={close}
        />
      )}
      {pending?.kind === 'new-confirm' && (
        <UnsavedPrompt
          lead={`You’re starting a new layout “${pending.name}”.`}
          layout={isDirty}
          listIds={unsavedLists}
          onDone={() => { close(); create(pending.name) }}
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
      {pending?.kind === 'save-new' && (
        <LayoutNameDialog
          title="Save layout"
          confirmLabel="Save layout"
          initialName={name}
          onConfirm={(n) => { close(); void store().saveAs(n) }}
          onCancel={close}
        />
      )}
      {pending?.kind === 'rename' && (
        <LayoutNameDialog
          title="Rename layout"
          confirmLabel="Rename"
          initialName={pending.name}
          initialHue={hueOf(pending.id)}
          onConfirm={(n, hue) => { close(); void store().rename(pending.id ?? UNSAVED_LAYOUT_ID, n, hue) }}
          onCancel={close}
        />
      )}
      {pending?.kind === 'delete' && (
        <DeleteLayoutConfirm
          layoutId={pending.id}
          layoutName={pending.name}
          onConfirm={() => {
            close()
            if (pending.id == null) store().discard()
            else void store().delete(pending.id)
          }}
          onCancel={close}
        />
      )}
    </div>
  )
}

/** Delete layout…'s confirm, naming the lists that go with it. */
function DeleteLayoutConfirm({ layoutId, layoutName, onConfirm, onCancel }: {
  layoutId: LayoutRef
  layoutName: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const ownedLists = useListDefinitionStore((s) => (layoutId == null
    ? 0
    : s.listDefinitions.filter((d) => ownerLayoutId(d) === layoutId).length))
  return <DeleteLayoutDialog layoutName={layoutName} ownedLists={ownedLists} onConfirm={onConfirm} onCancel={onCancel} />
}
