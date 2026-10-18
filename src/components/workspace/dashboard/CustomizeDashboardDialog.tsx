import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type UniqueIdentifier,
} from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { DRAG_ACTIVATION_DISTANCE_PX } from '../../../constants'
import {
  DASHBOARD_LOOK_AHEAD_CHOICES,
  DASHBOARD_TREND_RANGES,
  defaultDashboardConfig,
  normalizeDashboardConfig,
  type DashboardSectionId,
  type DashboardSectionOptions,
  type DashboardTabConfig,
} from '../../../models/dashboard-config'
import type { DashboardTab, WorkspaceLayout } from '../../../models/workspace-layout'
import { useLatestRef } from '../../../hooks/use-latest-ref'
import { useToday } from '../../../hooks/use-today'
import { useSortableReorderHandler, useSortableRow } from '../../../hooks/use-sortable-row'
import { isListTileEligible } from '../../../services/stats/list-tiles'
import { useListDefinitionStore } from '../../../stores/list-definition-store'
import { useListDraftStore } from '../../../stores/list-draft-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { bySortOrder } from '../../../utils/sort-order'
import { getTab } from '../../../utils/workspace-layout-ops'
import { DragHandle } from '../../shared/DragHandle'
import { DialogFrame } from '../../shared/Dialog'
import { MenuPopover, type MenuEntry } from '../../shared/MenuPopover'
import { ChevronDownIcon, CloseIcon } from '../../shared/icons'
import { tileCatalogHint, trendRangeLabel } from './dashboard-copy'
import {
  customizeStateFrom,
  knownListTiles,
  moveItem,
  sectionOptionValues,
  sectionsFor,
  tilesFor,
  toggled,
  withSectionOption,
  type CustomizeState,
} from './dashboard-customize'
import { TILES } from './dashboard-tiles'
import { DashGlyph } from '../../shared/DashGlyph'
import { SECTION_META } from './section-meta'
import { useListTileHints } from './use-list-tile-hints'
import styles from './CustomizeDashboardDialog.module.css'

export const PROMPTED_LIST_TILE_NOTE = 'Lists that ask for a value can’t be tiles'

/** The dashboard tab `tabId` of the working layout, if it's still there. */
function dashboardTabOf(layout: WorkspaceLayout | null, tabId: string): DashboardTab | null {
  if (!layout) return null
  const tab = getTab(layout, tabId)
  return tab?.kind === 'dashboard' ? tab : null
}

export interface CustomizeDashboardDialogProps {
  tabId: string
  /** Opened from "+ Add list tile": the list tiles in view, "Add a saved list" focused. */
  focusListTiles?: boolean
  onClose: () => void
}

/**
 * Customize dashboard (a standard dialog, 800 wide): tiles (show + reorder), list
 * tiles (add a saved list, remove, reorder) and sections (show, reorder,
 * their options). Every change is written to the tab's config at once — it
 * shows behind the dialog and makes the layout unsaved (Save / Discard is
 * the undo). Reorder by dragging a row's grip, or from the keyboard: focus
 * the grip, Space lifts, arrows move, Space drops, Esc cancels.
 */
export function CustomizeDashboardDialog({ tabId, focusListTiles = false, onClose }: CustomizeDashboardDialogProps) {
  const tab = useWorkspaceStore((s) => dashboardTabOf(s.working, tabId))
  useEffect(() => {
    if (!tab) onClose()
  }, [tab, onClose])
  if (!tab) return null
  return <CustomizePanel tab={tab} focusListTiles={focusListTiles} onClose={onClose} />
}

function CustomizePanel({ tab, focusListTiles, onClose }: { tab: DashboardTab; focusListTiles: boolean; onClose: () => void }) {
  const config = useMemo(() => normalizeDashboardConfig(tab.config), [tab.config])
  const [state, setState] = useState<CustomizeState>(() => customizeStateFrom(config))
  const [dragging, setDragging] = useState(false)
  const today = useToday()
  const urgentRange = useSettingsStore((s) => s.urgentDueWithinDays)
  const savedDefs = useListDefinitionStore((s) => s.listDefinitions)
  const drafts = useListDraftStore((s) => s.drafts)
  const hints = useListTileHints()
  const titleId = useId()
  const addListRef = useRef<HTMLButtonElement>(null)
  const [addListOpen, setAddListOpen] = useState(false)

  // Names follow unsaved list edits, as the tiles do.
  const defs = useMemo(() => [...savedDefs].sort(bySortOrder).map((d) => drafts[d.id] ?? d), [savedDefs, drafts])
  const defById = useMemo(() => new Map(defs.map((d) => [d.id, d])), [defs])
  const listTiles = knownListTiles(config, new Set(defById.keys()))

  const patch = (p: Partial<DashboardTabConfig>) => useWorkspaceStore.getState().patchTabConfig(tab.id, 'dashboard', p)
  const shownTiles = new Set(config.tiles)
  const shownSections = new Set(config.sections.map((s) => s.id))

  const update = (next: CustomizeState, p: Partial<DashboardTabConfig>) => {
    setState(next)
    patch(p)
  }

  const reset = () => {
    const def = defaultDashboardConfig()
    update(customizeStateFrom(def), def)
  }

  const setOption = <K extends keyof DashboardSectionOptions>(id: DashboardSectionId, key: K, value: DashboardSectionOptions[K]) => {
    const next = withSectionOption(state, id, key, value)
    update(next, { sections: sectionsFor(next, shownSections) })
  }

  // Opened from "+ Add list tile": "Add a saved list" takes the focus, in view.
  const initialFocus = focusListTiles ? addListRef : 'panel'
  useEffect(() => {
    if (focusListTiles) addListRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [focusListTiles])
  // Esc during a keyboard reorder cancels the move, not the dialog.
  const draggingRef = useLatestRef(dragging)
  const escapeBelongsElsewhere = useCallback(() => draggingRef.current, [draggingRef])

  const addListEntries: MenuEntry[] = defs.length === 0
    ? [{ kind: 'item', label: 'No saved lists yet', disabled: true }]
    : defs.map((d) => {
      const added = listTiles.includes(d.id)
      const eligible = isListTileEligible(d)
      return {
        kind: 'item',
        label: d.name,
        icon: <DashGlyph name="list" />,
        disabled: added || !eligible,
        note: added ? 'Added' : !eligible ? 'Asks for a value' : undefined,
        title: !eligible ? PROMPTED_LIST_TILE_NOTE : undefined,
        onSelect: () => patch({ listTiles: [...listTiles, d.id] }),
      }
    })

  return (
    <DialogFrame
      onClose={onClose}
      layer="overlay"
      initialFocus={initialFocus}
      escapeBelongsElsewhere={escapeBelongsElsewhere}
      aria-labelledby={titleId}
      className={styles.dialog}
      data={{ 'customize-dashboard': tab.id }}
    >
      <div className={styles.header}>
        <h2 id={titleId} className={styles.title}>Customize dashboard</h2>
        <button type="button" className={styles.closeBtn} aria-label="Close" onClick={onClose}><CloseIcon size={12} /></button>
      </div>
      <p className={styles.sub}>
        Changes show behind this dialog as you make them. They are saved with the layout, so the layout’s save icon lights up.
      </p>
      <div className={styles.columns}>
        <div className={styles.column}>
          <GroupHead label="Tiles" hint="Drag to reorder · 6 fit in a row" />
          <SortableGroup
            group="tile"
            label="Tiles"
            items={state.tileOrder}
            nameOf={(id) => TILES[id].label}
            onDraggingChange={setDragging}
            onMove={(from, to) => {
              const next = { ...state, tileOrder: moveItem(state.tileOrder, from, to) }
              update(next, { tiles: tilesFor(next, shownTiles) })
            }}
            renderRow={(id) => (
              <>
                <label className={styles.check}>
                  <input
                    type="checkbox"
                    checked={shownTiles.has(id)}
                    onChange={() => patch({ tiles: tilesFor(state, toggled(shownTiles, id)) })}
                  />
                  <DashGlyph name={TILES[id].glyph} color={TILES[id].color} />
                  <span className={styles.name}>{TILES[id].label}</span>
                </label>
                <span className={styles.hint}>{tileCatalogHint(id, { today, urgentRange })}</span>
              </>
            )}
          />

          <GroupHead label="List tiles" hint="Saved list count · its filters + screen filter" />
          {listTiles.length === 0 && <p className={styles.empty}>No list tiles yet.</p>}
          <SortableGroup
            group="list"
            label="List tiles"
            items={listTiles}
            nameOf={(id) => defById.get(id)?.name ?? 'List'}
            onDraggingChange={setDragging}
            onMove={(from, to) => patch({ listTiles: moveItem(listTiles, from, to) })}
            renderRow={(id) => {
              const def = defById.get(id)
              const eligible = def ? isListTileEligible(def) : true
              return (
                <>
                  <span className={styles.check}>
                    <DashGlyph name="list" className={styles.listGlyph} />
                    <span className={styles.name}>{def?.name ?? 'List'}</span>
                  </span>
                  <span className={styles.hint} title={eligible ? undefined : PROMPTED_LIST_TILE_NOTE}>
                    {eligible ? hints.get(id) ?? '' : 'Asks for a value, so it isn’t shown'}
                  </span>
                  <button
                    type="button"
                    className={styles.remove}
                    aria-label={`Remove ${def?.name ?? 'list'}`}
                    title="Remove list tile"
                    onClick={() => patch({ listTiles: listTiles.filter((x) => x !== id) })}
                  >
                    <CloseIcon size={10} />
                  </button>
                </>
              )
            }}
          />
          <button
            ref={addListRef}
            type="button"
            className={styles.addList}
            aria-haspopup="menu"
            aria-expanded={addListOpen}
            onClick={() => setAddListOpen((o) => !o)}
          >
            <DashGlyph name="plus" size={12} strokeWidth={2} />
            Add a saved list
            <DashGlyph name="chevron" size={12} />
          </button>
          {addListOpen && (
            <MenuPopover
              anchorRef={addListRef}
              placement="right-start"
              width={260}
              label="Saved lists"
              entries={addListEntries}
              onClose={() => setAddListOpen(false)}
            />
          )}
        </div>

        <div className={styles.column}>
          <GroupHead label="Sections" hint="Drag to reorder" />
          <SortableGroup
            group="section"
            label="Sections"
            items={state.sectionOrder}
            nameOf={(id) => SECTION_META[id].title}
            onDraggingChange={setDragging}
            onMove={(from, to) => {
              const next = { ...state, sectionOrder: moveItem(state.sectionOrder, from, to) }
              update(next, { sections: sectionsFor(next, shownSections) })
            }}
            renderRow={(id) => {
              const meta = SECTION_META[id]
              const shown = shownSections.has(id)
              const values = sectionOptionValues(state.options[id])
              return (
                <>
                  <label className={styles.check}>
                    <input
                      type="checkbox"
                      checked={shown}
                      onChange={() => patch({ sections: sectionsFor(state, toggled(shownSections, id)) })}
                    />
                    <DashGlyph name={meta.glyph} color={meta.glyphColor} />
                    <span className={styles.name}>{meta.title}</span>
                  </label>
                  {meta.options.includes('lookAhead') && (
                    <OptionSelect
                      label="Look ahead"
                      disabled={!shown}
                      choices={DASHBOARD_LOOK_AHEAD_CHOICES.map((n) => ({ key: String(n), label: `${n} days`, checked: values.lookAhead === n, onSelect: () => setOption(id, 'lookAhead', n) }))}
                    />
                  )}
                  {meta.options.includes('range') && (
                    <OptionSelect
                      label="Range"
                      disabled={!shown}
                      choices={DASHBOARD_TREND_RANGES.map((r) => ({ key: r, label: trendRangeLabel(r).replace(/^Last /, ''), checked: values.range === r, onSelect: () => setOption(id, 'range', r) }))}
                    />
                  )}
                  {meta.options.includes('showUnassigned') && (
                    <OptionSelect
                      label="Unassigned"
                      disabled={!shown}
                      choices={[true, false].map((v) => ({ key: String(v), label: v ? 'Shown' : 'Hidden', checked: values.showUnassigned === v, onSelect: () => setOption(id, 'showUnassigned', v) }))}
                    />
                  )}
                </>
              )
            }}
          />
          <p className={styles.note}>
            Sections fill the cell in this order, three to a row on a wide cell. A narrow cell shows them in one column.
          </p>
        </div>
      </div>
      <div className={styles.footer}>
        <button type="button" className={styles.ghostBtn} onClick={reset}>Reset to default</button>
        <span className={styles.spacer} />
        <button type="button" className={styles.primaryBtn} onClick={onClose}>Done</button>
      </div>
    </DialogFrame>
  )
}

function GroupHead({ label, hint }: { label: string; hint: string }) {
  return (
    <div className={styles.groupHead}>
      <span className={styles.groupLabel}>{label}</span>
      <span className={styles.groupHint}>{hint}</span>
    </div>
  )
}

interface OptionChoice {
  key: string
  label: string
  checked: boolean
  onSelect: () => void
}

/** A section option: its label and a small select button opening the choices. */
function OptionSelect({ label, choices, disabled }: { label: string; choices: readonly OptionChoice[]; disabled: boolean }) {
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const current = choices.find((c) => c.checked)?.label ?? ''
  return (
    <span className={styles.option}>
      <span className={styles.optionLabel}>{label}</span>
      <button
        ref={ref}
        type="button"
        className={styles.select}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${label}: ${current}`}
        onClick={() => setOpen((o) => !o)}
      >
        {current}
        <ChevronDownIcon />
      </button>
      {open && (
        <MenuPopover
          anchorRef={ref}
          placement="bottom-end"
          label={label}
          entries={choices.map((c) => ({ kind: 'item', label: c.label, radio: true, checked: c.checked, onSelect: c.onSelect }))}
          onClose={() => setOpen(false)}
        />
      )}
    </span>
  )
}

/** A reorderable group of rows (its own drag context: rows move only within it). */
function SortableGroup<T extends string | number>({ group, label, items, nameOf, onMove, onDraggingChange, renderRow }: {
  group: string
  label: string
  items: readonly T[]
  nameOf: (item: T) => string
  onMove: (from: number, to: number) => void
  onDraggingChange: (dragging: boolean) => void
  renderRow: (item: T) => ReactNode
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: DRAG_ACTIVATION_DISTANCE_PX } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const sortId = (item: T) => `${group}:${item}`
  const ids = items.map(sortId)
  const onDragEnd = useSortableReorderHandler(items, sortId, onMove)
  const itemOf = (id: UniqueIdentifier) => items.find((it) => sortId(it) === id)
  const name = (id: UniqueIdentifier) => {
    const item = itemOf(id)
    return item === undefined ? 'item' : nameOf(item)
  }
  const position = (id: UniqueIdentifier) => ids.indexOf(String(id)) + 1
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${name(active.id)}.`,
    onDragOver: ({ active, over }) => (over
      ? `${name(active.id)} is at position ${position(over.id)} of ${ids.length}.`
      : `${name(active.id)} is no longer over the list.`),
    onDragEnd: ({ active, over }) => (over
      ? `${name(active.id)} dropped at position ${position(over.id)} of ${ids.length}.`
      : `${name(active.id)} dropped.`),
    onDragCancel: ({ active }) => `Moving ${name(active.id)} was cancelled.`,
  }

  if (items.length === 0) return null
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      accessibility={{ announcements }}
      onDragStart={() => onDraggingChange(true)}
      onDragCancel={() => onDraggingChange(false)}
      onDragEnd={(e) => {
        onDraggingChange(false)
        onDragEnd(e)
      }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ul className={styles.rows} aria-label={label}>
          {items.map((item) => (
            <SortableRow key={sortId(item)} sortId={sortId(item)} name={nameOf(item)}>
              {renderRow(item)}
            </SortableRow>
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  )
}

function SortableRow({ sortId, name, children }: { sortId: string; name: string; children: ReactNode }) {
  const { setNodeRef, attributes, listeners, style, isDragging } = useSortableRow(sortId)
  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`${styles.row} ${isDragging ? styles.rowDragging : ''}`}
      data-customize-row={sortId}
    >
      <DragHandle className={styles.grip} attributes={attributes} listeners={listeners} ariaHidden={false} label={`Move ${name}`} />
      {children}
    </li>
  )
}
