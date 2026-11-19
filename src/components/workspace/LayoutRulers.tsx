import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { getActiveTab, type GridAxis, type LayoutCell, type LayoutTab, type WorkspaceLayout } from '../../models/workspace-layout'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { evenTracks, trackRemoval } from '../../utils/workspace-layout-ops'
import { columnShare, isSliverTrack, removeTrackMessage, rowCanCollapse, rowMark, runPlaceWords, sliverRun, trackNames } from '../../utils/layout-rulers'
import { MenuPopover, type MenuEntry } from '../shared/MenuPopover'
import { PlusIcon } from '../shared/icons'
import { useDrawnTracks, type DrawnTracks } from './use-drawn-tracks'
import { useTabTitles } from './widget-hooks'
import { insertPreview, showStructurePreview } from './insert-preview'
import styles from './LayoutRulers.module.css'

/**
 * The layout edit mode's rulers (E2), drawn into the table's own grid while
 * the mode is on: a ruler along the top of each column (A, B, C… with its
 * share) and down the left of each row (1, 2, 3…, marked `fit` / `folded`),
 * each a button on its track that opens the track's menu; a "+" on every
 * line between them and at both ends, inserting a full column / row there
 * (while it is hovered the table draws the insert — its new slots, the
 * cells that stretch across it — and the mode bar says it, the "+" pinned
 * in place meanwhile: round two, `insert-preview`). A sliver (`utils/layout-rulers`) gets an
 * unlabelled tick whose menu merges it into a neighbour; it and its two
 * lines act as one line for an insert (`sliverRun`): one "+", which merges
 * the sliver away and inserts on the line left. They overlay the gutters and the cells' edges, so no
 * cell moves; the dividers are the mode's gutters.
 */

/** A track's place in the grid (1-based lines), on `axis`, in the first track of the other. */
function onTrack(axis: GridAxis, i: number): CSSProperties {
  return axis === 'columns' ? { gridColumn: `${i + 1} / span 1`, gridRow: '1 / span 1' } : { gridRow: `${i + 1} / span 1`, gridColumn: '1 / span 1' }
}

/** Which end of the axis a track or a line is at: the first, the last, both (a lone track), or neither. */
function endOf(i: number, count: number): 'first' | 'last' | 'only' | undefined {
  if (count === 1) return 'only'
  if (i === 0) return 'first'
  if (i === count - 1) return 'last'
  return undefined
}

/**
 * Where line `k` of `axis` (of `count` tracks) is drawn: in the track after
 * it, at its start — the last line in the last track, at its end; over the
 * other axis's first track, or `along` (track range `[start, end)`) it.
 */
function onLine(axis: GridAxis, k: number, count: number, along?: readonly [number, number]): CSSProperties {
  const last = k === count
  const track = last ? count : k + 1
  const span = along ? `${along[0] + 1} / ${along[1] + 1}` : '1 / span 1'
  return axis === 'columns'
    ? { gridColumn: `${track} / span 1`, gridRow: span }
    : { gridRow: `${track} / span 1`, gridColumn: span }
}

/** A ruler's open menu: a track's, by axis and index. */
interface OpenMenu {
  axis: GridAxis
  index: number
}

export function LayoutRulers({ layout, working }: {
  /** The table as drawn: the draft, or a preview of an edit not yet made. */
  layout: WorkspaceLayout
  /** The draft: what a "+" inserts into. */
  working: WorkspaceLayout
}) {
  const editing = useWorkspaceStore((s) => s.editing != null)
  if (!editing || layout.cells.length === 0) return null
  return <Rulers layout={layout} working={working} />
}

/**
 * A "+" pinned while its preview shows: where it was (the viewport's px),
 * its line and the run it inserts on (the draft's lines). The same button
 * stays there, fixed — the table reflows under it —, so the pointer stays on
 * it and nothing flickers; leaving it ends the preview.
 */
interface Pinned {
  rect: { left: number; top: number; width: number; height: number }
  axis: GridAxis
  line: number
  first: number
  last: number
}

function Rulers({ layout, working }: { layout: WorkspaceLayout; working: WorkspaceLayout }) {
  const anchor = useRef<HTMLDivElement | null>(null)
  const drawn = useDrawnTracks(anchor, layout)
  const [menu, setMenu] = useState<OpenMenu | null>(null)
  const [pinned, setPinned] = useState<Pinned | null>(null)
  const triggers = useRef(new Map<string, HTMLButtonElement>())
  const menuAnchor = useRef<HTMLButtonElement | null>(null)

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

  const store = useWorkspaceStore.getState
  const keyOf = (axis: GridAxis, i: number) => `${axis}:${i}`
  const openMenu = (axis: GridAxis, index: number) => {
    menuAnchor.current = triggers.current.get(keyOf(axis, index)) ?? null
    setMenu({ axis, index })
  }
  /** A "+": a full track on the run of lines `first` … `last` (one line, or a sliver's two, `sliverRun`). */
  const insertAt = (axis: GridAxis, first: number, last: number) => {
    // Widgets in hand (Move / Copy to layout): the new track holds them.
    if (store().editing?.incoming && store().placeIncoming({ kind: 'line', axis, index: first, through: last })) return
    const cellId = store().insertTrackAt(axis, first, undefined, last)
    if (cellId) store().selectEditCell(cellId)
  }
  /** A card by its active widget's title. */
  const cellName = useCallback((cell: LayoutCell) => {
    const tab = getActiveTab(cell)
    return tab ? titleOf(tab.id) : 'An empty slot'
  }, [titleOf])
  /**
   * A "+" hovered (round two, concept A): the table draws the insert
   * (`insertPreview`), the "+" pinned where it is while the table reflows
   * under it. Only while the table draws the draft — its lines are the
   * draft's then.
   */
  const startPreview = (el: HTMLElement, axis: GridAxis, line: number, first: number, last: number, where: string) => {
    if (layout !== working || pinned) return
    const preview = insertPreview(working, axis, first, last, where, cellName)
    if (!preview) return
    const r = el.getBoundingClientRect()
    setPinned({ rect: { left: r.left, top: r.top, width: r.width, height: r.height }, axis, line, first, last })
    showStructurePreview(preview)
  }
  const endPreview = useCallback(() => {
    setPinned(null)
    showStructurePreview(null)
  }, [])
  // Gone while its preview shows (the mode closed, the table re-mounted): the preview goes with it.
  const previewing = pinned != null
  useEffect(() => (previewing ? () => showStructurePreview(null) : undefined), [previewing])
  // A scroll or a resize moves the table under the pinned "+": the preview ends.
  useEffect(() => {
    if (!previewing) return
    window.addEventListener('resize', endPreview)
    window.addEventListener('scroll', endPreview, true)
    return () => {
      window.removeEventListener('resize', endPreview)
      window.removeEventListener('scroll', endPreview, true)
    }
  }, [previewing, endPreview])

  const items: React.ReactNode[] = []
  for (const axis of ['columns', 'rows'] as const) {
    const tracks = layout.grid[axis]
    const count = tracks.length
    const sizes = drawn[axis]
    const noun = axis === 'columns' ? 'column' : 'row'
    for (let k = 0; k <= count; k++) {
      // A "+" on every line — but a sliver and its two lines are one line: one "+", on the first (the two would overlap).
      const [first, last] = sliverRun(layout, axis, k, sizes)
      // The pinned "+" (its preview showing: the table drawn as the insert would leave it) stays, fixed where it was.
      const pin = pinned?.axis === axis && pinned.line === k ? pinned : null
      const plusShown = first === k || pin != null
      const between = runPlaceWords(names[axis], first, last, noun)
      if (plusShown) items.push(
        <button
          key={`plus:${axis}:${k}`}
          type="button"
          className={styles.plus}
          data-axis={axis}
          data-end={k === 0 ? 'first' : k === count ? 'last' : undefined}
          data-sliver-run={last > first ? '' : undefined}
          data-pinned={pin ? '' : undefined}
          style={pin
            ? { position: 'fixed', left: pin.rect.left, top: pin.rect.top, width: pin.rect.width, height: pin.rect.height, margin: 0 }
            : onLine(axis, k, count)}
          aria-label={`Insert ${noun} here`}
          data-tooltip={pin ? undefined : `Insert ${noun} ${between}`}
          data-ruler-plus={`${axis}:${k}`}
          // A move onto it, not an enter (a "+" appearing under a resting pointer previews nothing), and not while a
          // button is held (a card or tab dragged over it): a preview would move the table under the drop.
          onMouseMove={(e) => { if (e.buttons === 0 && !pin) startPreview(e.currentTarget, axis, k, first, last, between) }}
          onMouseLeave={pin ? endPreview : undefined}
          onClick={() => {
            if (pin) {
              endPreview()
              insertAt(axis, pin.first, pin.last)
            } else {
              insertAt(axis, first, last)
            }
          }}
        >
          <PlusIcon size={12} strokeWidth={2.2} />
        </button>,
      )
      if (k === count) break
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
          data-end={endOf(k, count)}
          data-before-sliver={!sliver && k + 1 < count && isSliverTrack(layout, axis, k + 1, sizes) ? '' : undefined}
          data-open={open ? '' : undefined}
          style={onTrack(axis, k)}
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={open}
          data-tooltip={sliver ? `A narrow ${noun}: merge it into a neighbour` : `${axis === 'columns' ? 'Column' : 'Row'} ${name}${share ? ` · ${share}` : ''}${mark ? ` · ${mark}` : ''}`}
          data-ruler={`${axis}:${k}`}
          onClick={() => (open ? setMenu(null) : openMenu(axis, k))}
        >
          {!sliver && (
            <>
              <span className={styles.name}>{name}</span>
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

  // On the line beside this track — with a sliver beside it, across the sliver's two lines, as its "+" inserts.
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
