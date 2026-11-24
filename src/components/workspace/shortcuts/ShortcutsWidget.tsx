import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react'
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, rectSortingStrategy, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { DRAG_ACTIVATION_DISTANCE_PX } from '../../../constants'
import type { ShortcutsSource, ShortcutsTab } from '../../../models/workspace-layout'
import { useElementSize } from '../../../hooks/use-element-size'
import { useIsMobile } from '../../../hooks/use-is-mobile'
import { useLayoutListTabs, useShortcutListIds, useShortcutTile, type BoardEntry, type ShortcutTileData } from '../../../hooks/use-shortcuts'
import { useSortableRow } from '../../../hooks/use-sortable-row'
import { useWidgetFace } from '../../../hooks/use-widget-face'
import { openShortcutList, openWidgetLarger } from '../../../services/widget-popup'
import { showTab } from '../../../services/workspace-tabs'
import { useCellRoomStore } from '../../../stores/cell-room-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { WALL_TONE_NAMES, WALL_TONES, wallCountsText } from '../../../utils/list-wall'
import { boardLines, boardMinHeight, boardTileMinWidth, boardTileRoom, shortcutLists, shortcutsSource } from '../../../utils/shortcuts'
import { shortcutsFaceFor, shortcutsShape, type ShortcutsShape } from '../../../utils/widget-face'
import { AppIcon } from '../../shared/AppIcon'
import { BadgeCapsule } from '../../shared/BadgeCapsule'
import { MoreIcon, PlusIcon } from '../../shared/icons'
import { MenuPopover, type MenuEntry } from '../../shared/MenuPopover'
import type { TooltipLegendItem } from '../../shared/TooltipBubble'
import { useTooltip } from '../../shared/use-tooltip'
import { CellControlsContext } from '../cell-controls'
import { TabIcon } from '../TabIcon'
import { useTabTitle } from '../widget-hooks'
import { WidgetNameLine } from '../WidgetTopLine'
import { BoardBar, BoardSquares } from './board-parts'
import { ADD_SHORTCUT_LABEL, moveShortcut, REMOVE_SHORTCUT_LABEL, removeShortcut, useAddShortcutEntries } from './shortcuts-menu'
import styles from './ShortcutsWidget.module.css'

/** The widget's name: its name line's, its tiles' list. */
const BOARD_NAME = 'List board'

const dragIdOf = (key: string) => `shortcut-${key}`
const keyOf = (dragId: string | number) => String(dragId).slice('shortcut-'.length)

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`

/** What the squares mean: under each tile's tooltip. */
const BOARD_LEGEND: readonly TooltipLegendItem[] = WALL_TONES.map((t) => ({
  label: WALL_TONE_NAMES[t],
  swatch: <span className={styles.legendSquare} data-tone={t} />,
}))

const NO_IDS: readonly number[] = []

/** A tile's words for assistive tech: its name, its count, its badge, its layout (a list picked). */
function tileLabel(data: ShortcutTileData, withLayout: boolean): string {
  const count = data.count == null ? 'waits on its prompt' : plural(data.count, 'task')
  const badge = data.badge ? `, ${data.badge.summary.join(', ')}` : ''
  return `${data.name}: ${count}${badge}${withLayout && data.layoutName ? `, in ${data.layoutName}` : ''}`
}

/**
 * The List board (widget kind `shortcuts`): a tile per list — the lists
 * picked, of any layout (**Lists I pick**, `config.lists`), or every list tab
 * of the open layout in reading order (**This layout's lists**, `config.source`
 * `layout`) — each built as it shows on opening (`useShortcutTile`). A tile
 * shows its list tab's icon, its name, its badge capsule and its count, then
 * a square per open task, the trouble first (`board-parts`), as many whole
 * rows as it has room for, then its first task titles in the room left
 * (`boardTileRoom`); its tooltip ends with the squares' legend. A click opens
 * the list in the widget popup (`openShortcutList`; a tab of the layout opens
 * larger, `openWidgetLarger`). Faces by size (`shortcutsFaceFor` /
 * `shortcutsShape`): small — the name and the number of lists; rows — a row
 * per list with its bar; compact — the tiles' heads, squares where a row
 * fits; large — the tiles with their titles, then (lists picked) a dashed
 * Add a list tile. Both wrap the tiles, every tile as wide as the widest
 * head asks (`boardTileMinWidth`), and alone in its cell the board holds its
 * row at least as tall as its lines of heads (`boardMinHeight`,
 * `stores/cell-room-store`): no tile is ever cut off. Its name line shows with Settings › Show widget names.
 * Lists picked drag to reorder (their own `DndContext`; not on touch), one
 * undo step; a tile's right-click (or its ⋯) offers Open and Remove from
 * List board — for a tab of the layout, Open and Show in its cell.
 */
export function ShortcutsWidget({ tab }: { tab: ShortcutsTab }) {
  const [faceRef, face] = useWidgetFace(shortcutsFaceFor)
  const [sizeRef, size] = useElementSize()
  const setRef = useCallback((el: HTMLElement | null) => { faceRef(el); sizeRef(el) }, [faceRef, sizeRef])
  const shape = shortcutsShape(face, size.width)
  const source = shortcutsSource(tab.config)
  return (
    <div ref={setRef} className={styles.faceHost} data-shortcuts={tab.id} data-shortcuts-face={shape} data-shortcuts-source={source}>
      {shape !== 'small' && <WidgetNameLine name={BOARD_NAME} />}
      <ShortcutsFace tab={tab} source={source} shape={shape} width={size.width} />
    </div>
  )
}

function ShortcutsFace({ tab, source, shape, width }: { tab: ShortcutsTab; source: ShortcutsSource; shape: ShortcutsShape; width: number }) {
  const ids = useShortcutListIds(source === 'picked' ? shortcutLists(tab.config) : NO_IDS)
  const layoutTabs = useLayoutListTabs()
  const entries = useMemo<BoardEntry[]>(() => (source === 'layout'
    ? layoutTabs.map((t) => ({ key: t.id, listId: t.config.listDefinitionId ?? 0, tab: t }))
    : ids.map((id) => ({ key: String(id), listId: id }))), [source, layoutTabs, ids])
  const title = useTabTitle(tab)
  if (shape === 'small') {
    return (
      <div className={styles.smallFace} role="group" aria-label={`${title}: ${plural(entries.length, 'list')}`}>
        <TabIcon tab={tab} className={styles.smallIcon} />
        <span className={styles.smallTitle}>{title}</span>
        <span className={styles.smallCount}>{entries.length}</span>
      </div>
    )
  }
  if (entries.length === 0) {
    return source === 'layout'
      ? <div className={styles.empty}><p className={styles.emptyLine} role="status">No list tabs in this layout.</p></div>
      : <Empty tab={tab} />
  }
  return <Tiles tab={tab} source={source} entries={entries} shape={shape} width={width} />
}

/** The Add a list menu under `anchor` (the dashed tile, the empty state's button). */
function AddMenu({ tab, anchor, onClose }: { tab: ShortcutsTab; anchor: React.RefObject<HTMLElement | null>; onClose: () => void }) {
  const entries = useAddShortcutEntries(tab)
  return <MenuPopover anchorRef={anchor} placement="bottom-start" width={240} label={ADD_SHORTCUT_LABEL} entries={entries} onClose={onClose} />
}

function Empty({ tab }: { tab: ShortcutsTab }) {
  const ref = useRef<HTMLButtonElement | null>(null)
  const [open, setOpen] = useState(false)
  return (
    <div className={styles.empty}>
      <p className={styles.emptyLine} role="status">No lists added.</p>
      <button ref={ref} type="button" className={styles.emptyAdd} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <PlusIcon />
        {ADD_SHORTCUT_LABEL}
      </button>
      {open && <AddMenu tab={tab} anchor={ref} onClose={() => setOpen(false)} />}
    </div>
  )
}

/** A tile's menu: at the pointer (a right-click) or under its ⋯. */
type TileMenu = { entry: BoardEntry; at: { x: number; y: number } }

type TileShape = 'rows' | 'compact' | 'large'

interface TilesProps {
  tab: ShortcutsTab
  source: ShortcutsSource
  entries: BoardEntry[]
  shape: TileShape
  width: number
}

function Tiles({ tab, source, entries, shape, width }: TilesProps) {
  const touch = useIsMobile()
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: DRAG_ACTIVATION_DISTANCE_PX } }))
  const [menu, setMenu] = useState<TileMenu | null>(null)
  // The height each tile's head, squares and titles ask for: the tallest sets the tiles' most height.
  const [wants, setWants] = useState<ReadonlyMap<string, number>>(new Map())
  // The width each tile's head asks for on one line: the widest sets every tile's width.
  const [heads, setHeads] = useState<ReadonlyMap<string, number>>(new Map())
  // A press that ended a drag is no click: the tile it ends on doesn't open.
  const dragged = useRef(false)
  const picked = source === 'picked'
  const tiled = shape !== 'rows'
  const dragIds = entries.map((e) => dragIdOf(e.key))
  const tallest = Math.max(0, ...entries.map((e) => wants.get(e.key) ?? 0))
  const tileMin = boardTileMinWidth(entries.map((e) => heads.get(e.key) ?? 0))
  const withAdd = shape === 'large' && picked
  // The lines as the grid draws them: its own width (a scrollbar beside it counted), else the board's less its padding.
  const [gridRef, grid] = useElementSize()
  const gridWidth = grid.width > 0 ? grid.width : width - BOARD_PADDING_X_PX
  useBoardRowMin(tiled ? boardLines(entries.length + (withAdd ? 1 : 0), gridWidth, tileMin) : null)

  const onWant = useCallback((key: string, want: number) => {
    setWants((prev) => (prev.get(key) === want ? prev : new Map(prev).set(key, want)))
  }, [])
  const onHeadWidth = useCallback((key: string, w: number) => {
    setHeads((prev) => (prev.get(key) === w ? prev : new Map(prev).set(key, w)))
  }, [])
  const open = (entry: BoardEntry) => {
    if (dragged.current) return
    void (entry.tab ? openWidgetLarger(entry.tab.id) : openShortcutList(entry.listId))
  }
  const onDragEnd = (e: DragEndEvent) => {
    window.setTimeout(() => { dragged.current = false }, 0)
    if (!e.over || e.active.id === e.over.id) return
    moveShortcut(tab, Number(keyOf(e.active.id)), Number(keyOf(e.over.id)))
  }
  const menuEntries: MenuEntry[] = !menu ? [] : [
    { kind: 'item', label: 'Open', onSelect: () => open(menu.entry) },
    menu.entry.tab
      ? { kind: 'item', label: 'Show in its cell', onSelect: () => { if (menu.entry.tab) showTab(menu.entry.tab.id) } }
      : { kind: 'item', label: REMOVE_SHORTCUT_LABEL, onSelect: () => removeShortcut(tab, menu.entry.listId) },
  ]

  const items = entries.map((entry) => (
    <SortableTile
      key={entry.key}
      entry={entry}
      shape={shape}
      disabled={touch || !picked}
      onOpen={() => open(entry)}
      onMenu={(at) => setMenu({ entry, at })}
      onWant={onWant}
      onHeadWidth={tiled ? onHeadWidth : undefined}
    />
  ))
  return (
    <div
      className={styles.scroll}
      data-shortcuts-shape={shape}
      style={tallest > 0 ? { '--board-content-max': `${tallest}px` } as CSSProperties : undefined}
    >
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        autoScroll={false}
        onDragStart={() => { dragged.current = true }}
        onDragEnd={onDragEnd}
        onDragCancel={() => { window.setTimeout(() => { dragged.current = false }, 0) }}
      >
        <SortableContext items={dragIds} strategy={shape === 'rows' ? verticalListSortingStrategy : rectSortingStrategy}>
          <div
            ref={gridRef}
            className={tiled ? styles.grid : styles.rows}
            role="list"
            aria-label={BOARD_NAME}
            style={tiled ? { '--board-tile-min': `${tileMin}px` } as CSSProperties : undefined}
          >
            {items}
            {withAdd && <AddTile tab={tab} />}
          </div>
        </SortableContext>
      </DndContext>
      {menu && (
        <MenuPopover point={menu.at} restoreFocus closeOnScroll width={200} label={`${BOARD_NAME} options`} entries={menuEntries} onClose={() => setMenu(null)} />
      )}
    </div>
  )
}

function AddTile({ tab }: { tab: ShortcutsTab }) {
  const ref = useRef<HTMLButtonElement | null>(null)
  const [open, setOpen] = useState(false)
  return (
    <>
      <button ref={ref} type="button" className={styles.addTile} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-shortcuts-add="">
        <PlusIcon />
        {ADD_SHORTCUT_LABEL}
      </button>
      {open && <AddMenu tab={tab} anchor={ref} onClose={() => setOpen(false)} />}
    </>
  )
}

interface TileProps {
  entry: BoardEntry
  shape: TileShape
  disabled: boolean
  onOpen: () => void
  onMenu: (at: { x: number; y: number }) => void
  onWant: (key: string, want: number) => void
  /** A tile (not a row): tells the board the width its head asks for on one line. */
  onHeadWidth?: (key: string, width: number) => void
}

/** The board's padding across and the room its name line takes (px; the stylesheet's `.scroll`, `WidgetNameLine`). */
const BOARD_PADDING_X_PX = 20
const NAME_LINE_PX = 28
/** A tile's padding across and the gap between its name and its capsule or count (px; `.tile > .body`, `.head`). */
const TILE_PADDING_X_PX = 18
const HEAD_COLUMN_GAP_PX = 4

/**
 * Alone in its cell (`CellControlsContext`), the board holds its row at least
 * as tall as its `lines` of tiles' heads, and its name line when it shows
 * (`stores/cell-room-store`); `null` lets go — a row per list, or no cell.
 */
function useBoardRowMin(lines: number | null): void {
  const cellId = useContext(CellControlsContext)?.cellId
  const nameLine = useSettingsStore((s) => s.showWidgetNames)
  const px = lines == null ? null : boardMinHeight(lines) + (nameLine ? NAME_LINE_PX : 0)
  useEffect(() => {
    if (cellId == null) return
    useCellRoomStore.getState().setCellMinHeight(cellId, px)
  }, [cellId, px])
  useEffect(() => (cellId == null ? undefined : () => useCellRoomStore.getState().setCellMinHeight(cellId, null)), [cellId])
}

/**
 * The width a tile's head asks for on one line, told to the board
 * (`boardTileMinWidth`): the title with its name untruncated, the gap, the
 * capsule or count, the padding. Measured again as `content` (what the head
 * shows) changes, and as the capsule or count resizes.
 */
function useHeadWidth(entryKey: string, onHeadWidth: ((key: string, width: number) => void) | undefined, content: string) {
  const titleRef = useRef<HTMLSpanElement | null>(null)
  const nameRef = useRef<HTMLSpanElement | null>(null)
  const metaRef = useRef<HTMLSpanElement | null>(null)
  useLayoutEffect(() => {
    const title = titleRef.current
    const name = nameRef.current
    const meta = metaRef.current
    if (!onHeadWidth || !title || !name || !meta) return
    const measure = () => {
      // The title grows to fill the line, so never its own width (that would ratchet every tile wider): the icon and
      // gap before the name, and the name's whole text.
      const lead = Math.max(0, name.getBoundingClientRect().left - title.getBoundingClientRect().left)
      const width = lead + name.scrollWidth + HEAD_COLUMN_GAP_PX + meta.offsetWidth + TILE_PADDING_X_PX
      if (width > TILE_PADDING_X_PX) onHeadWidth(entryKey, Math.ceil(width))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(meta)
    return () => ro.disconnect()
  }, [entryKey, onHeadWidth, content])
  return { titleRef, nameRef, metaRef }
}

/**
 * A tile (or a row): its press a button over the whole of it, under its
 * marks — the squares are buttons of their own, so they sit beside it, not
 * in it.
 */
function SortableTile({ entry, shape, disabled, onOpen, onMenu, onWant, onHeadWidth }: TileProps) {
  const data = useShortcutTile(entry)
  const { setNodeRef, attributes, listeners, style, isDragging } = useSortableRow(dragIdOf(entry.key))
  const [headRef, head] = useElementSize()
  const tile = shape !== 'rows'
  // A tile shows the list tab's icon, as its strip does; its count only with no capsule beside it: the count is in
  // its tooltip and its squares.
  const icon = data?.icon
  const showCount = !tile || !data?.badge
  const { titleRef, nameRef, metaRef } = useHeadWidth(
    entry.key,
    onHeadWidth,
    data ? `${icon ? 'i' : ''}|${data.name}|${showCount ? (data.count ?? '—') : ''}|${data.badge?.summary.join(',') ?? ''}` : '',
  )
  const picked = !entry.tab
  const countLine = data && data.count != null ? `${plural(data.count, 'task')} · ` : ''
  const tip = data ? `${picked && data.layoutName ? `${data.name} · ${data.layoutName}` : data.name}\n${countLine}${wallCountsText(data.wall)}` : null
  const { triggerProps, tooltip } = useTooltip(tip, { legend: BOARD_LEGEND })
  if (!data) return null
  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault()
    onMenu({ x: e.clientX, y: e.clientY })
  }
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault()
      e.stopPropagation()
      const r = e.currentTarget.getBoundingClientRect()
      onMenu({ x: r.left, y: r.bottom + 4 })
    }
  }
  const describedBy = [triggerProps['aria-describedby'], disabled ? undefined : attributes['aria-describedby']].filter(Boolean).join(' ') || undefined
  return (
    <div
      ref={setNodeRef}
      role="listitem"
      className={shape === 'rows' ? styles.rowItem : styles.tile}
      data-shortcut-tile={entry.listId}
      data-board-tab={entry.tab?.id}
      data-dragging={isDragging ? 'true' : undefined}
      style={style}
      {...(disabled ? undefined : listeners)}
    >
      <button
        type="button"
        className={styles.open}
        {...triggerProps}
        aria-roledescription={disabled ? undefined : attributes['aria-roledescription']}
        aria-describedby={describedBy}
        aria-label={`${tileLabel(data, picked)}. Open`}
        onClick={onOpen}
        onContextMenu={onContextMenu}
        onKeyDown={onKeyDown}
      >
        {tooltip}
      </button>
      <span className={styles.body}>
        <span ref={headRef} className={styles.head} aria-hidden="true">
          <span ref={titleRef} className={styles.title}>
            {icon && <AppIcon icon={icon} size={13} className={styles.icon} />}
            <span ref={nameRef} className={styles.name} data-shortcut-name="">{data.name}</span>
          </span>
          <span ref={metaRef} className={styles.meta}>
            {data.badge && <BadgeCapsule counts={data.badge.counts} data-shortcut-badge="" />}
            {showCount && <span className={styles.count} data-shortcut-count="">{data.count ?? '—'}</span>}
          </span>
        </span>
        {shape === 'rows'
          ? <BoardBar wall={data.wall} />
          : <Room data={data} entryKey={entry.key} headHeight={head.height} withTitles={shape === 'large'} onWant={onWant} />}
      </span>
      {shape !== 'rows' && (
        <button
          type="button"
          className={styles.more}
          aria-label={`${data.name}: options`}
          aria-haspopup="menu"
          data-tooltip="Options"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            onMenu({ x: r.right - 200, y: r.bottom + 4 })
          }}
        >
          <MoreIcon size={13} />
        </button>
      )}
    </div>
  )
}

/** A tile's head before it is measured (one line), and the gap under it, px (the stylesheet's `.head`, `.body`). */
const HEAD_LINE_PX = 18
const HEAD_GAP_PX = 4

/**
 * The tile's room under its head: its squares, as many whole rows as the
 * room gives, then its first task titles in what is left, each a little
 * dimmer (`boardTileRoom`). It takes no part in the tile's least height
 * (`contain: size`); it tells the board the height its head and room ask
 * for (a head that wraps asks for its second line too).
 */
function Room({ data, entryKey, headHeight, withTitles, onWant }: {
  data: ShortcutTileData
  entryKey: string
  headHeight: number
  withTitles: boolean
  onWant: (key: string, want: number) => void
}) {
  const [ref, size] = useElementSize()
  const room = boardTileRoom(data.wall.squares.length, data.titles.length, size, withTitles)
  const want = (headHeight > 0 ? headHeight : HEAD_LINE_PX) + HEAD_GAP_PX + room.want
  useEffect(() => { onWant(entryKey, want) }, [onWant, entryKey, want])
  return (
    <span ref={ref} className={styles.room}>
      <BoardSquares wall={data.wall} columns={room.columns} rows={room.rows} />
      {room.lines > 0 && (
        <span className={styles.peek} aria-hidden="true">
          {data.titles.slice(0, room.lines).map((t, i) => <span key={i} className={styles.peekLine} data-peek-line={i}>{t}</span>)}
        </span>
      )}
    </span>
  )
}
