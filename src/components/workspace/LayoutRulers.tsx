import { useMemo, useRef, useState, type CSSProperties } from 'react'
import type { GridAxis, LayoutTab, WorkspaceLayout } from '../../models/workspace-layout'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { evenTracks, trackRemoval } from '../../utils/workspace-layout-ops'
import { spanOf } from '../../utils/workspace-grid'
import { columnShare, isSliverTrack, removeTrackMessage, rowCanCollapse, rowMark, sliverRun, trackNames } from '../../utils/layout-rulers'
import { MenuPopover, type MenuEntry } from '../shared/MenuPopover'
import { PlusIcon } from '../shared/icons'
import { useDrawnTracks, type DrawnTracks } from './use-drawn-tracks'
import { useTabTitles } from './widget-hooks'
import styles from './LayoutRulers.module.css'

/**
 * The layout edit mode's headers, in the frame round the table while the
 * mode is on: A, B, C… over the columns (a column's share shows on hover)
 * and 1, 2, 3… beside the rows (marked `fit` / `folded`), each a button on
 * its track that opens the track's menu. The selected card's columns and
 * rows are lit. A sliver (`utils/layout-rulers`) gets an unlabelled tick in
 * the band, whose menu merges it into a neighbour. They are grid items of
 * the table drawn into its padding (the frame), so they scroll with it and
 * no track makes room for them. Rows and columns are added from the
 * selected card's edge tabs (`EditSelection`) or these menus.
 */

/** A track's place in the grid (1-based lines), on `axis`, in the first track of the other. */
function onTrack(axis: GridAxis, i: number): CSSProperties {
  return axis === 'columns' ? { gridColumn: `${i + 1} / span 1`, gridRow: '1 / span 1' } : { gridRow: `${i + 1} / span 1`, gridColumn: '1 / span 1' }
}

/** A header's open menu: a track's, by axis and index. */
interface OpenMenu {
  axis: GridAxis
  index: number
}

export function LayoutRulers({ layout }: {
  /** The table as drawn: the draft, or a preview of an edit not yet made. */
  layout: WorkspaceLayout
}) {
  const editing = useWorkspaceStore((s) => s.editing != null)
  if (!editing || layout.cells.length === 0) return null
  return <Rulers layout={layout} />
}

function Rulers({ layout }: { layout: WorkspaceLayout }) {
  const anchor = useRef<HTMLDivElement | null>(null)
  const drawn = useDrawnTracks(anchor, layout)
  const [menu, setMenu] = useState<OpenMenu | null>(null)
  const triggers = useRef(new Map<string, HTMLButtonElement>())
  const menuAnchor = useRef<HTMLButtonElement | null>(null)
  const selectedId = useWorkspaceStore((s) => s.editing?.selectedCellId ?? null)
  const selected = selectedId != null ? layout.cells.find((c) => c.id === selectedId) : undefined

  const names = useMemo(() => ({
    columns: trackNames(layout, 'columns', drawn.columns),
    rows: trackNames(layout, 'rows', drawn.rows),
  }), [layout, drawn])
  const tabs = useMemo(() => layout.cells.flatMap((c) => c.tabs), [layout.cells])
  const titles = useTabTitles(tabs)
  const titleOf = useMemo(() => {
    const byId = new Map(tabs.map((t: LayoutTab, i) => [t.id, titles[i] ?? '']))
    return (tabId: string) => byId.get(tabId) ?? 'a widget'
  }, [tabs, titles])

  const keyOf = (axis: GridAxis, i: number) => `${axis}:${i}`
  const openMenu = (axis: GridAxis, index: number) => {
    menuAnchor.current = triggers.current.get(keyOf(axis, index)) ?? null
    setMenu({ axis, index })
  }

  const items: React.ReactNode[] = []
  for (const axis of ['columns', 'rows'] as const) {
    const count = layout.grid[axis].length
    const noun = axis === 'columns' ? 'column' : 'row'
    const [litFrom, litTo] = selected ? spanOf(selected.area, axis) : [-1, -1]
    for (let k = 0; k < count; k++) {
      const name = names[axis][k]
      const sliver = name == null
      const label = sliver
        ? `Narrow ${noun} ${k > 0 && names[axis][k - 1] ? `after ${names[axis][k - 1]}` : names[axis][k + 1] ? `before ${names[axis][k + 1]}` : ''} options`.replace('  ', ' ')
        : `${axis === 'columns' ? 'Column' : 'Row'} ${name} options`
      const mark = axis === 'rows' ? rowMark(layout, k) : null
      const share = axis === 'columns' && !sliver ? columnShare(layout, k) : ''
      const open = menu?.axis === axis && menu.index === k
      items.push(
        <button
          key={`ruler:${axis}:${k}`}
          ref={(el) => {
            if (el) triggers.current.set(keyOf(axis, k), el)
            else triggers.current.delete(keyOf(axis, k))
          }}
          type="button"
          className={sliver ? styles.tick : styles.ruler}
          data-axis={axis}
          data-open={open ? '' : undefined}
          data-lit={!sliver && k >= litFrom && k < litTo ? '' : undefined}
          style={onTrack(axis, k)}
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={open}
          data-tooltip={sliver ? `A narrow ${noun}: merge it into a neighbour` : undefined}
          data-ruler={`${axis}:${k}`}
          onClick={() => (open ? setMenu(null) : openMenu(axis, k))}
        >
          {!sliver && (
            <>
              <span className={styles.name}>{name}</span>
              {share && <small className={styles.share}>{share}</small>}
              {mark && <small className={styles.note}>{mark}</small>}
            </>
          )}
        </button>,
      )
    }
  }

  return (
    <div ref={anchor} className={styles.rulers} data-layout-rulers="">
      {items}
      {menu && (
        <MenuPopover
          anchorRef={menuAnchor}
          placement={menu.axis === 'columns' ? 'bottom-start' : 'right-start'}
          label={rulerMenuLabel(menu, names)}
          entries={rulerEntries(layout, menu, names, drawn, titleOf)}
          width={280}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}

function rulerMenuLabel(menu: OpenMenu, names: Record<GridAxis, Array<string | null>>): string {
  const name = names[menu.axis][menu.index]
  const noun = menu.axis === 'columns' ? 'Column' : 'Row'
  return name == null ? `Narrow ${noun.toLowerCase()}` : `${noun} ${name}`
}

/** A ruler's menu: a major track's Insert / Collapse / Even all / Remove, a sliver's Merge into. */
function rulerEntries(
  layout: WorkspaceLayout,
  menu: OpenMenu,
  names: Record<GridAxis, Array<string | null>>,
  drawn: DrawnTracks,
  title: (tabId: string) => string,
): MenuEntry[] {
  const { axis, index } = menu
  const store = useWorkspaceStore.getState
  const count = layout.grid[axis].length
  const noun = axis === 'columns' ? 'column' : 'row'
  // The menu closes itself after an item runs.
  const run = (fn: () => void) => () => fn()
  if (isSliverTrack(layout, axis, index, drawn[axis])) {
    const entries: MenuEntry[] = [{ kind: 'label', text: `Narrow ${noun}` }]
    for (const into of [index - 1, index + 1]) {
      if (into < 0 || into >= count) continue
      const name = names[axis][into]
      const where = name ?? (into < index ? (axis === 'columns' ? 'the column to the left' : 'the row above') : (axis === 'columns' ? 'the column to the right' : 'the row below'))
      entries.push({
        kind: 'item',
        label: `Merge into ${where}`,
        description: `Removes the line between them; the ${noun}’s space joins ${where}.`,
        descriptionTooltip: true,
        onSelect: run(() => { store().mergeTrackInto(axis, index, into) }),
      })
    }
    return entries
  }

  // On the line beside this track — with a sliver beside it, across the sliver's two lines, as an edge tab inserts.
  const insert = (line: number) => run(() => {
    const [first, last] = sliverRun(layout, axis, line, drawn[axis])
    const cellId = store().insertTrackAt(axis, first, index, last)
    if (cellId) store().selectEditCell(cellId)
  })
  const evenable = evenTracks(layout, axis) !== layout
  const entries: MenuEntry[] = axis === 'columns'
    ? [
        { kind: 'item', label: 'Insert column left', icon: <PlusIcon />, onSelect: insert(index) },
        { kind: 'item', label: 'Insert column right', icon: <PlusIcon />, onSelect: insert(index + 1) },
        { kind: 'item', label: 'Even all widths', disabled: !evenable, title: evenable ? undefined : 'The columns are even already', onSelect: run(() => { void store().evenTracks('columns') }) },
      ]
    : [
        { kind: 'item', label: 'Insert row above', icon: <PlusIcon />, onSelect: insert(index) },
        { kind: 'item', label: 'Insert row below', icon: <PlusIcon />, onSelect: insert(index + 1) },
        collapseEntry(layout, index, run),
        { kind: 'item', label: 'Even all heights', disabled: !evenable, title: evenable ? undefined : 'The rows are even already', onSelect: run(() => { void store().evenTracks('rows') }) },
      ]
  const plan = trackRemoval(layout, axis, index)
  entries.push({ kind: 'separator' })
  entries.push({
    kind: 'item',
    label: `Remove ${noun}`,
    danger: true,
    disabled: plan == null,
    ...(plan == null
      ? { title: `The layout’s only ${noun} can’t go` }
      : { description: removeTrackMessage(layout, axis, index, plan, title) }),
    onSelect: run(() => { store().removeTrack(axis, index) }),
  })
  return entries
}

function collapseEntry(layout: WorkspaceLayout, index: number, run: (fn: () => void) => () => void): MenuEntry {
  const track = layout.grid.rows[index]
  const store = useWorkspaceStore.getState
  if (track?.collapsed === true) {
    return { kind: 'item', label: 'Expand row', onSelect: run(() => { void store().setTrackCollapsed(track.id, false) }) }
  }
  const can = track != null && rowCanCollapse(layout, index)
  return {
    kind: 'item',
    label: 'Collapse row',
    disabled: !can,
    ...(can ? {} : { title: 'No widget lies only in this row' }),
    onSelect: run(() => { if (track) void store().setTrackCollapsed(track.id, true) }),
  }
}
