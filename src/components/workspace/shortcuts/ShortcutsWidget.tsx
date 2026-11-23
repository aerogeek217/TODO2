import { useCallback, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, rectSortingStrategy, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { DRAG_ACTIVATION_DISTANCE_PX } from '../../../constants'
import type { ShortcutsTab } from '../../../models/workspace-layout'
import { useElementSize } from '../../../hooks/use-element-size'
import { useIsMobile } from '../../../hooks/use-is-mobile'
import { useShortcutListIds, useShortcutTile, type ShortcutTileData } from '../../../hooks/use-shortcuts'
import { useSortableRow } from '../../../hooks/use-sortable-row'
import { useOpenFullWidget, useWidgetFace } from '../../../hooks/use-widget-face'
import { openShortcutList } from '../../../services/widget-popup'
import { compactShortcutTiles, shortcutLists, shortcutPeekLines } from '../../../utils/shortcuts'
import { shortcutsFaceFor, shortcutsShape, type ShortcutsShape } from '../../../utils/widget-face'
import { AppIcon } from '../../shared/AppIcon'
import { BadgeCapsule } from '../../shared/BadgeCapsule'
import { LayoutIcon, MoreIcon, PlusIcon } from '../../shared/icons'
import { MenuPopover, type MenuEntry } from '../../shared/MenuPopover'
import { TabIcon } from '../TabIcon'
import { useTabTitle } from '../widget-hooks'
import { WidgetNameLine } from '../WidgetTopLine'
import { ADD_SHORTCUT_LABEL, moveShortcut, REMOVE_SHORTCUT_LABEL, removeShortcut, useAddShortcutEntries } from './shortcuts-menu'
import styles from './ShortcutsWidget.module.css'

const dragIdOf = (id: number) => `shortcut-${id}`
const listIdOf = (dragId: string | number) => Number(String(dragId).slice('shortcut-'.length))

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`

/** A tile's words for assistive tech: its name, its count, its layout. */
function tileLabel(data: ShortcutTileData): string {
  const count = data.count == null ? 'waits on its prompt' : plural(data.count, 'task')
  const badge = data.badge ? `, ${data.badge.summary.join(', ')}` : ''
  return `${data.name}: ${count}${badge}${data.layoutName ? `, in ${data.layoutName}` : ''}`
}

/**
 * Shortcuts (2026-11-23; widget kind `shortcuts`): a tile per list the user
 * picked, from any layout, to keep those lists in reach. A tile shows its
 * list tab's picked icon, its name, its tab badge (`BadgeCapsule`) and its
 * count (`—` while its prompt waits), the first task titles as built and its
 * layout's name; a click opens the list in the widget popup over this layout
 * (`openShortcutList`). Faces by size (`shortcutsFaceFor` /
 * `shortcutsShape`): small — the name and the number of lists; rows — a row
 * per list; compact — one line of tiles ending in `+N`; large — a grid of
 * tiles whose titles go first as it shrinks, then a dashed Add a list tile.
 * Tiles drag to reorder (their own `DndContext`; not on touch), one undo
 * step; a right-click (or a tile's ⋯) offers Open and Remove from Shortcuts.
 */
export function ShortcutsWidget({ tab }: { tab: ShortcutsTab }) {
  const [faceRef, face] = useWidgetFace(shortcutsFaceFor)
  const [sizeRef, size] = useElementSize()
  const setRef = useCallback((el: HTMLElement | null) => { faceRef(el); sizeRef(el) }, [faceRef, sizeRef])
  const shape = shortcutsShape(face, size.width)
  return (
    <div ref={setRef} className={styles.faceHost} data-shortcuts={tab.id} data-shortcuts-face={shape}>
      <ShortcutsFace tab={tab} shape={shape} width={size.width} />
    </div>
  )
}

function ShortcutsFace({ tab, shape, width }: { tab: ShortcutsTab; shape: ShortcutsShape; width: number }) {
  const ids = useShortcutListIds(shortcutLists(tab.config))
  const title = useTabTitle(tab)
  if (shape === 'small') {
    return (
      <div className={styles.smallFace} role="group" aria-label={`${title}: ${plural(ids.length, 'list')}`}>
        <TabIcon tab={tab} className={styles.smallIcon} />
        <span className={styles.smallTitle}>{title}</span>
        <span className={styles.smallCount}>{ids.length}</span>
      </div>
    )
  }
  return (
    <>
      <WidgetNameLine name="Shortcuts">
        <span className={styles.lineCount}>{plural(ids.length, 'list')}</span>
      </WidgetNameLine>
      {ids.length === 0 ? <Empty tab={tab} /> : <Tiles tab={tab} ids={ids} shape={shape} width={width} />}
    </>
  )
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
type TileMenu = { listId: number; at: { x: number; y: number } }

function Tiles({ tab, ids, shape, width }: { tab: ShortcutsTab; ids: number[]; shape: 'rows' | 'compact' | 'large'; width: number }) {
  const touch = useIsMobile()
  const openFull = useOpenFullWidget()
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: DRAG_ACTIVATION_DISTANCE_PX } }))
  const [menu, setMenu] = useState<TileMenu | null>(null)
  // A press that ended a drag is no click: the tile it ends on doesn't open.
  const dragged = useRef(false)
  const compact = shape === 'compact' ? compactShortcutTiles(ids.length, width) : null
  const shown = compact ? ids.slice(0, compact.shown) : ids
  const dragIds = shown.map(dragIdOf)

  const open = (listId: number) => {
    if (dragged.current) return
    void openShortcutList(listId)
  }
  const onDragEnd = (e: DragEndEvent) => {
    window.setTimeout(() => { dragged.current = false }, 0)
    if (!e.over || e.active.id === e.over.id) return
    moveShortcut(tab, listIdOf(e.active.id), listIdOf(e.over.id))
  }
  const menuEntries: MenuEntry[] = menu ? [
    { kind: 'item', label: 'Open', onSelect: () => open(menu.listId) },
    { kind: 'item', label: REMOVE_SHORTCUT_LABEL, onSelect: () => removeShortcut(tab, menu.listId) },
  ] : []

  const items = shown.map((id) => (
    <SortableTile
      key={id}
      listId={id}
      shape={shape}
      disabled={touch}
      onOpen={() => open(id)}
      onMenu={(at) => setMenu({ listId: id, at })}
    />
  ))
  return (
    <div
      className={styles.scroll}
      data-shortcuts-shape={shape}
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
            className={shape === 'rows' ? styles.rows : shape === 'compact' ? styles.line : styles.grid}
            role="list"
            aria-label="Shortcuts"
            style={compact ? { '--shortcut-columns': compact.columns } as CSSProperties : undefined}
          >
            {items}
            {compact && compact.more > 0 && (
              <button
                type="button"
                className={styles.moreTile}
                aria-label={`${compact.more} more`}
                data-shortcuts-more=""
                onClick={openFull}
                disabled={!openFull}
              >
                +{compact.more}
              </button>
            )}
            {shape === 'large' && <AddTile tab={tab} />}
          </div>
        </SortableContext>
      </DndContext>
      {menu && (
        <MenuPopover point={menu.at} restoreFocus closeOnScroll width={200} label="Shortcut options" entries={menuEntries} onClose={() => setMenu(null)} />
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
  listId: number
  shape: 'rows' | 'compact' | 'large'
  disabled: boolean
  onOpen: () => void
  onMenu: (at: { x: number; y: number }) => void
}

function SortableTile({ listId, shape, disabled, onOpen, onMenu }: TileProps) {
  const data = useShortcutTile(listId)
  const { setNodeRef, attributes, listeners, style, isDragging } = useSortableRow(dragIdOf(listId))
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
  const head = (
    <span className={styles.head}>
      {data.icon && <AppIcon icon={data.icon} size={13} className={styles.icon} />}
      <span className={styles.name} data-shortcut-name="">{data.name}</span>
      {data.badge && <BadgeCapsule counts={data.badge.counts} data-shortcut-badge="" />}
      <span className={styles.count} data-shortcut-count="">{data.count ?? '—'}</span>
    </span>
  )
  let body: ReactNode = head
  if (shape === 'large') body = <>{head}<Peek titles={data.titles} /><LayoutLine name={data.layoutName} /></>
  else if (shape === 'compact') body = <>{head}<LayoutLine name={data.layoutName} /></>
  return (
    <div
      ref={setNodeRef}
      role="listitem"
      className={shape === 'rows' ? styles.rowItem : styles.tile}
      data-shortcut-tile={listId}
      data-dragging={isDragging ? 'true' : undefined}
      style={style}
      {...(disabled ? undefined : listeners)}
    >
      <button
        type="button"
        className={styles.open}
        {...(disabled ? undefined : { 'aria-roledescription': attributes['aria-roledescription'], 'aria-describedby': attributes['aria-describedby'] })}
        aria-label={`${tileLabel(data)}. Open`}
        onClick={onOpen}
        onContextMenu={onContextMenu}
        onKeyDown={onKeyDown}
      >
        {body}
      </button>
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

/** The first task titles, as many whole lines as the tile's height leaves (0 – 3), each a little dimmer. */
function Peek({ titles }: { titles: string[] }) {
  const [ref, size] = useElementSize()
  const lines = titles.slice(0, shortcutPeekLines(size.height))
  return (
    <span ref={ref} className={styles.peek} aria-hidden="true">
      {lines.map((t, i) => <span key={i} className={styles.peekLine} data-peek-line={i}>{t}</span>)}
    </span>
  )
}

function LayoutLine({ name }: { name: string }) {
  if (!name) return null
  return (
    <span className={styles.layoutLine} data-shortcut-layout="">
      <LayoutIcon size={11} />
      <span className={styles.layoutName}>{name}</span>
    </span>
  )
}
