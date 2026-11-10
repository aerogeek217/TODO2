import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useUIStore, type LayoutRequest } from '../../stores/ui-store'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { ownerLayoutId } from '../../models/list-definition'
import { MenuPopover, type MenuEntry } from '../shared/MenuPopover'
import { useUnsavedListIds } from '../../hooks/use-list-draft'
import { DeleteLayoutDialog, LayoutNameDialog } from './LayoutDialogs'
import { LayoutTabs } from './LayoutTabs'
import { UnsavedPrompt } from './UnsavedPrompt'
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, CopyIcon, HuedLayoutIcon, PencilIcon, PlusIcon, TrashIcon, WarningIcon } from '../shared/icons'
import styles from './LayoutControls.module.css'
import { withViewTransition } from '../shared/view-transition'

/** How the top bar shows the layouts: one tab each, or folded into the picker's drop-down. */
export type LayoutControlsMode = 'tabs' | 'menu'

type Pending =
  | { kind: 'switch'; id: number; name: string }
  | { kind: 'new-name' }
  | { kind: 'new-confirm'; name: string }
  | { kind: 'duplicate' }
  | { kind: 'rename'; id: number; name: string }
  | { kind: 'delete'; id: number; name: string }

/**
 * Top-bar layout chrome on the workspace: the layouts as tabs (`tabs`) or
 * the layout picker (`menu`, when the bar has no room for the tabs). Every
 * layout edit is saved at once; only while a write has failed does a
 * `Couldn't save · Retry` control follow (`WriteFailedButton`).
 *
 * - Tabs: click opens a layout; right-click / Shift+F10 → its menu (the open
 *   one: Duplicate layout…; every one: Edit…, Move left / right, Delete
 *   layout…); drag to reorder; `+` = New layout.
 * - Picker: the layouts (drag to reorder), then New layout…, Duplicate
 *   layout…, Edit…, Delete layout….
 *
 * One order feeds both (the store's `layouts`); a reorder is saved at once.
 * New layout asks for a name and stores the empty layout at once. Leaving
 * a list with unsaved edits for another layout or a new one asks Save /
 * Discard / Cancel first (the layout itself never asks: it is saved).
 */
export function LayoutControls({ mode }: { mode: LayoutControlsMode }) {
  const layouts = useWorkspaceStore((s) => s.layouts)
  const working = useWorkspaceStore((s) => s.working)
  const activeLayoutId = useWorkspaceStore((s) => s.activeLayoutId)
  const writing = useWorkspaceStore((s) => s.writesPending > 0)
  const unsavedLists = useUnsavedListIds()
  const [menuOpen, setMenuOpen] = useState(false)
  const [tabMenu, setTabMenu] = useState<{ id: number; x: number; y: number } | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const pickerRef = useRef<HTMLButtonElement | null>(null)
  const store = useWorkspaceStore.getState
  const unsaved = unsavedLists.length > 0

  const switchTo = (id: number, targetName: string) => {
    if (id === activeLayoutId) return
    if (unsaved) setPending({ kind: 'switch', id, name: targetName })
    else withViewTransition(() => store().load(id))
  }

  // A layout action asked for elsewhere (the palette, `ui-store.requestLayout`): run as the tabs and the picker run it.
  const runRequest = useEffectEvent((r: LayoutRequest) => {
    if (r.kind === 'new') setPending({ kind: 'new-name' })
    else if (r.kind === 'duplicate') setPending({ kind: 'duplicate' })
    else switchTo(r.layoutId, layouts.find((l) => l.id === r.layoutId)?.name ?? '')
  })
  useEffect(() => useUIStore.subscribe((s) => {
    const r = s.layoutRequest
    if (!r) return
    useUIStore.getState().clearLayoutRequest()
    runRequest(r)
  }), [])

  if (!working) return null
  const name = working.name

  const close = () => setPending(null)
  const create = (layoutName: string) => { void store().createLayout(layoutName) }
  const nameOf = (id: number) => layouts.find((l) => l.id === id)?.name ?? ''
  const hueOf = (id: number) => layouts.find((l) => l.id === id)?.hue ?? null
  const indexOf = (id: number) => layouts.findIndex((l) => l.id === id)
  const canDelete = layouts.length > 1

  /** The open layout's actions (tab menu of the open tab, and the picker). */
  const openLayoutEntries: MenuEntry[] = [
    { kind: 'item', label: 'Duplicate layout…', icon: <CopyIcon />, onSelect: () => setPending({ kind: 'duplicate' }) },
  ]

  const pickerEntries: MenuEntry[] = [
    { kind: 'label', text: 'Layouts' },
    ...layouts.map((l): MenuEntry => ({
      kind: 'item',
      label: l.name,
      icon: <HuedLayoutIcon hue={l.hue} />,
      radio: true,
      checked: l.id === activeLayoutId,
      dragId: String(l.id),
      onSelect: () => switchTo(l.id, l.name),
    })),
    { kind: 'separator' },
    { kind: 'item', label: 'New layout…', icon: <PlusIcon />, onSelect: () => setPending({ kind: 'new-name' }) },
    ...openLayoutEntries,
    {
      kind: 'item',
      label: 'Edit…',
      icon: <PencilIcon />,
      onSelect: () => { if (activeLayoutId != null) setPending({ kind: 'rename', id: activeLayoutId, name }) },
    },
    { kind: 'separator' },
    {
      kind: 'item',
      label: 'Delete layout…',
      icon: <TrashIcon />,
      danger: true,
      disabled: !canDelete,
      onSelect: () => { if (activeLayoutId != null) setPending({ kind: 'delete', id: activeLayoutId, name }) },
    },
  ]

  const tabMenuEntries = (id: number): MenuEntry[] => {
    const open = id === activeLayoutId
    const index = indexOf(id)
    return [
      ...(open ? [...openLayoutEntries, { kind: 'separator' as const }] : []),
      { kind: 'item', label: 'Edit…', icon: <PencilIcon />, onSelect: () => setPending({ kind: 'rename', id, name: nameOf(id) }) },
      {
        kind: 'item',
        label: 'Move left',
        icon: <ChevronLeftIcon />,
        disabled: index <= 0,
        onSelect: () => { void store().moveLayout(id, index - 1) },
      },
      {
        kind: 'item',
        label: 'Move right',
        icon: <ChevronRightIcon />,
        disabled: index < 0 || index >= layouts.length - 1,
        onSelect: () => { void store().moveLayout(id, index + 1) },
      },
      { kind: 'separator' },
      {
        kind: 'item',
        label: 'Delete layout…',
        icon: <TrashIcon />,
        danger: true,
        disabled: !canDelete,
        onSelect: () => setPending({ kind: 'delete', id, name: nameOf(id) }),
      },
    ]
  }

  return (
    <div className={styles.controls} data-layout-controls={mode} data-layout-writing={writing ? '' : undefined}>
      {mode === 'tabs' ? (
        <LayoutTabs
          layouts={layouts}
          activeLayoutId={activeLayoutId}
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
      <WriteFailedButton />

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
          listIds={unsavedLists}
          onDone={() => { close(); create(pending.name) }}
          onCancel={close}
        />
      )}
      {pending?.kind === 'duplicate' && (
        <LayoutNameDialog
          title="Duplicate layout"
          confirmLabel="Duplicate"
          initialName={`${name} copy`}
          onConfirm={(n) => { close(); void store().duplicateLayout(n) }}
          onCancel={close}
        />
      )}
      {pending?.kind === 'rename' && (
        <LayoutNameDialog
          title="Edit layout"
          confirmLabel="Apply"
          initialName={pending.name}
          initialHue={hueOf(pending.id)}
          onConfirm={(n, hue) => { close(); void store().rename(pending.id, n, hue) }}
          onCancel={close}
        />
      )}
      {pending?.kind === 'delete' && (
        <DeleteLayoutConfirm
          layoutId={pending.id}
          layoutName={pending.name}
          onConfirm={() => {
            close()
            void store().delete(pending.id)
          }}
          onCancel={close}
        />
      )}
    </div>
  )
}

/**
 * `Couldn't save · Retry`: shown only while the open layout's last write
 * failed (`writeFailed`) — a click writes it again.
 */
function WriteFailedButton() {
  const failed = useWorkspaceStore((s) => s.writeFailed)
  const name = useWorkspaceStore((s) => s.working?.name ?? '')
  if (!failed) return null
  return (
    <button
      type="button"
      className={styles.writeFailed}
      title={`Layout “${name}” couldn’t be saved. Retry`}
      aria-label={`Couldn't save layout ${name}. Retry`}
      data-testid="layout-write-failed"
      onClick={() => { void useWorkspaceStore.getState().retryWrite() }}
    >
      <WarningIcon size={12} />
      <span>Couldn’t save</span>
      <span aria-hidden="true">·</span>
      <span className={styles.writeFailedAction}>Retry</span>
    </button>
  )
}

/** Delete layout…'s confirm, naming the lists that go with it. */
function DeleteLayoutConfirm({ layoutId, layoutName, onConfirm, onCancel }: {
  layoutId: number
  layoutName: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const ownedLists = useListDefinitionStore((s) => s.listDefinitions.filter((d) => ownerLayoutId(d) === layoutId).length)
  return <DeleteLayoutDialog layoutName={layoutName} ownedLists={ownedLists} onConfirm={onConfirm} onCancel={onCancel} />
}
