import { useRef } from 'react'
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent, type Modifier } from '@dnd-kit/core'
import { SortableContext, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { DRAG_ACTIVATION_DISTANCE_PX } from '../../constants'
import type { PersistedWorkspaceLayout } from '../../models/workspace-layout'
import { LayoutIcon, PlusIcon } from '../shared/icons'
import styles from './LayoutControls.module.css'

type Layout = PersistedWorkspaceLayout

/** A tab's place for its menu: under it (keyboard) or at the pointer. */
type MenuPoint = { x: number; y: number }

interface LayoutTabsProps {
  /** The saved layouts, in their order. */
  layouts: readonly Layout[]
  activeLayoutId: number | null
  /** A kept new layout not saved yet (open, after the saved ones; not draggable), else `null`. */
  unsavedNew: Layout | null
  /** The open layout has unsaved changes: its tab's dot. */
  dirty: boolean
  onActivate: (layout: Layout) => void
  /** `id` `null` = the kept new layout's tab. */
  onOpenMenu: (id: number | null, point: MenuPoint) => void
  /** A saved layout dragged to position `toIndex` among the saved layouts. */
  onMove: (id: number, toIndex: number) => void
  onNew: () => void
}

const dragIdOf = (id: number) => `layout-${id}`

/** Only sideways: the tabs reorder along the bar. */
const horizontalOnly: Modifier = ({ transform }) => ({ ...transform, y: 0 })

/**
 * The open layout and the others as tabs in the top bar, then `+` (New
 * layout). Click or Enter / Space opens a layout; ← → / Home / End move the
 * focus; right-click or Shift+F10 / the context-menu key opens the tab's
 * menu. Saved layouts drag sideways to reorder, with their own `DndContext`
 * (never the workspace's).
 */
export function LayoutTabs({ layouts, activeLayoutId, unsavedNew, dirty, onActivate, onOpenMenu, onMove, onNew }: LayoutTabsProps) {
  const tabEls = useRef(new Map<string, HTMLDivElement>())
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: DRAG_ACTIVATION_DISTANCE_PX } }))
  const ids = layouts.map((l) => dragIdOf(l.id))
  const keys = [...ids, ...(unsavedNew ? ['new'] : [])]
  const focusKey = unsavedNew ? 'new' : activeLayoutId != null ? dragIdOf(activeLayoutId) : ids[0]

  const focusSibling = (from: string, delta: 1 | -1 | 'first' | 'last') => {
    const i = keys.indexOf(from)
    const n = keys.length
    const next = delta === 'first' ? 0 : delta === 'last' ? n - 1 : (i + delta + n) % n
    const key = keys[next]
    if (key) tabEls.current.get(key)?.focus()
  }

  const onDragEnd = (e: DragEndEvent) => {
    const to = e.over ? ids.indexOf(String(e.over.id)) : -1
    const moved = layouts[ids.indexOf(String(e.active.id))]
    if (moved && to >= 0 && e.active.id !== e.over?.id) onMove(moved.id, to)
  }


  return (
    <div className={styles.tabStrip}>
      <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[horizontalOnly]} autoScroll={false} onDragEnd={onDragEnd}>
        <SortableContext items={ids} strategy={horizontalListSortingStrategy}>
          <div className={styles.tabs} role="tablist" aria-label="Layouts">
            {layouts.map((l) => {
              const key = dragIdOf(l.id)
              const active = !unsavedNew && l.id === activeLayoutId
              return (
                <SortableLayoutTab
                  key={l.id}
                  dragId={key}
                  layout={l}
                  active={active}
                  dirty={active && dirty}
                  focusable={key === focusKey}
                  onActivate={() => onActivate(l)}
                  onOpenMenu={(p) => onOpenMenu(l.id, p)}
                  onFocusSibling={(d) => focusSibling(key, d)}
                  setRef={(el) => {
                    if (el) tabEls.current.set(key, el)
                    else tabEls.current.delete(key)
                  }}
                />
              )
            })}
            {unsavedNew && (
              <LayoutTabView
                layout={unsavedNew}
                active
                dirty={dirty}
                focusable={focusKey === 'new'}
                onActivate={() => {}}
                onOpenMenu={(p) => onOpenMenu(null, p)}
                onFocusSibling={(d) => focusSibling('new', d)}
                setRef={(el) => {
                  if (el) tabEls.current.set('new', el)
                  else tabEls.current.delete('new')
                }}
              />
            )}
          </div>
        </SortableContext>
      </DndContext>
      <button
        type="button"
        className={styles.add}
        aria-label="New layout"
        title="New layout"
        onClick={onNew}
        data-testid="layout-new"
      >
        <PlusIcon />
      </button>
    </div>
  )
}

function SortableLayoutTab({ dragId, ...props }: LayoutTabViewProps & { dragId: string }) {
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({ id: dragId })
  return (
    <LayoutTabView
      {...props}
      sortable={{
        ref: setNodeRef,
        listeners,
        style: { transform: CSS.Translate.toString(transform), transition },
        dragging: isDragging,
      }}
    />
  )
}

interface LayoutTabViewProps {
  layout: Layout
  active: boolean
  dirty: boolean
  /** The tab the Tab key reaches (roving focus). */
  focusable: boolean
  onActivate: () => void
  onOpenMenu: (point: MenuPoint) => void
  onFocusSibling: (delta: 1 | -1 | 'first' | 'last') => void
  setRef: (el: HTMLDivElement | null) => void
  sortable?: {
    ref: (el: HTMLElement | null) => void
    listeners: ReturnType<typeof useSortable>['listeners']
    style: React.CSSProperties
    dragging: boolean
  }
}

function LayoutTabView({ layout, active, dirty, focusable, onActivate, onOpenMenu, onFocusSibling, setRef, sortable }: LayoutTabViewProps) {
  return (
    <div
      ref={(el) => { sortable?.ref(el); setRef(el) }}
      {...sortable?.listeners}
      style={sortable?.style}
      role="tab"
      aria-selected={active}
      tabIndex={focusable ? 0 : -1}
      data-layout-tab={layout.id}
      data-testid="layout-tab"
      className={[
        styles.tab,
        active ? styles.tabActive : '',
        sortable?.dragging ? styles.tabDragging : '',
      ].join(' ')}
      title={layout.name}
      onClick={() => { if (!active) onActivate() }}
      onContextMenu={(e) => {
        e.preventDefault()
        onOpenMenu({ x: e.clientX, y: e.clientY })
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { if (!active) onActivate() }
        else if (e.key === 'ArrowRight') onFocusSibling(1)
        else if (e.key === 'ArrowLeft') onFocusSibling(-1)
        else if (e.key === 'Home') onFocusSibling('first')
        else if (e.key === 'End') onFocusSibling('last')
        else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
          const r = e.currentTarget.getBoundingClientRect()
          onOpenMenu({ x: r.left, y: r.bottom + 4 })
        } else return
        // A key the tab handles is the tab's: the app shortcuts (Enter opens
        // the selected task, Space completes it, …) never see it.
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      <span className={styles.tabIcon}><LayoutIcon size={12} /></span>
      <span className={styles.tabName}>{layout.name}</span>
      {dirty && <span className={styles.unsavedDot} role="img" aria-label="unsaved changes" />}
    </div>
  )
}
