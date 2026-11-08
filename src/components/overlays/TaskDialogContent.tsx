import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { useIsMobile } from '../../hooks/use-is-mobile'
import { copyTasksRich } from '../../services/task-copy'
import {
  currentTaskDialogEnv,
  resolveTaskDialog,
  screenTaskDialogDescription,
  taskDialogCopySections,
  taskDialogCount,
  type TaskDialogRowGroup,
} from '../../services/task-dialog'
import type { TaskDialogPayload } from '../../stores/task-dialog-payload'
import { useFilterStore } from '../../stores/filter-store'
import { useAppliedLens } from '../../stores/screen-filter'
import { useScreenTaskCounts } from '../../hooks/use-screen-task-count'
import { withLens, type Lens } from '../../utils/lens'
import { usePersonStore } from '../../stores/person-store'
import { useStatusStore } from '../../stores/status-store'
import { useTodoStore } from '../../stores/todo-store'
import type { FilterCriteria } from '../../utils/filter-criteria'
import { useUIStore } from '../../stores/ui-store'
import { startOfToday } from '../../utils/date'
import { MobileTaskRow } from '../task/MobileTaskRow'
import { TaskRow } from '../task/TaskRow'
import { TaskRowGrid } from '../task/TaskRowGrid'
import { GlanceGlyph } from '../shared/GlanceGlyph'
import { ChevronDownIcon, EnvelopeIcon } from '../shared/icons'
import { PersonCheckinMenu } from '../shared/PersonCheckinMenu'
import styles from './TaskDialog.module.css'

interface Resolved {
  payload: TaskDialogPayload
  /** The screen filter the rows were resolved under. */
  screen: FilterCriteria
  groups: TaskDialogRowGroup[]
}

/** The payload's rows from the stores as they are now. */
function resolve(payload: TaskDialogPayload): Resolved {
  const env = currentTaskDialogEnv()
  return { payload, screen: env.screen, groups: resolveTaskDialog(payload.source, env) }
}

export interface TaskDialogContentProps {
  payload: TaskDialogPayload
  /** The heading's id (the surface's `aria-labelledby`). */
  titleId: string
  /** The surface the content sits in: focused again when the task editor on top closes. */
  panelRef: RefObject<HTMLElement | null>
  onClose: () => void
  /** Under the header (the phone's screen-filter bar). */
  filterBar?: ReactNode
}

/**
 * What the task dialog and the top bar's filtered-tasks panel show: the
 * header (glyph, title, count, ×), what is counted in words, the rows and
 * the footer. Rows are full task rows (no drag); clicking one opens the
 * task editor on top. The rows are fixed when the content mounts, so a task
 * completed here stays, struck through, until it closes, while the counts
 * behind update. The screen filter's tasks resolve again on every change of
 * that filter — fixed between changes — and their description follows it.
 * Footer: Copy tasks, Email check-in (a person's tasks: a menu to send the
 * person's check-in or paste their reply — `PersonCheckinMenu`), Close.
 */
export function TaskDialogContent({ payload, titleId, panelRef, onClose, filterBar }: TaskDialogContentProps) {
  const [resolved, setResolved] = useState<Resolved>(() => resolve(payload))
  const isScreen = payload.source.kind === 'screen'
  // The screen filter (the chips with the lens), only for its own tasks (no
  // other re-renders on a chip change).
  const chips = useFilterStore((s) => (isScreen ? s.filters : null))
  const lens = useAppliedLens()
  const screen = chips && withLens(chips, lens)
  // A new payload while open (e.g. a person chip in a row), or the screen
  // filter changed under its tasks: resolve it afresh.
  if (resolved.payload !== payload || (screen !== null && resolved.screen !== screen)) setResolved(resolve(payload))
  const { groups } = resolved

  const todos = useTodoStore((s) => s.todos)
  const assignedPeopleMap = usePersonStore((s) => s.assignedPeopleMap)
  const statuses = useStatusStore((s) => s.statuses)
  const editPopupMode = useUIStore((s) => s.editPopupMode)
  const openEditPopup = useUIStore((s) => s.openEditPopup)
  const isMobile = useIsMobile()
  const [copied, setCopied] = useState(false)

  const todoById = useMemo(() => new Map(todos.map((t) => [t.id, t])), [todos])
  const count = taskDialogCount(groups)
  const { personId } = payload

  // The editor closed: focus comes back here, so the next Esc closes this.
  const editorWasOpen = useRef(false)
  useEffect(() => {
    if (editPopupMode) {
      editorWasOpen.current = true
    } else if (editorWasOpen.current) {
      editorWasOpen.current = false
      panelRef.current?.focus()
    }
  }, [editPopupMode, panelRef])

  const copy = async () => {
    const ok = await copyTasksRich(taskDialogCopySections(groups, todoById), {
      assignedPeopleMap,
      statusMap: new Map(statuses.map((s) => [s.id!, s])),
      today: startOfToday(),
    })
    if (!ok) return
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  const rowsOf = (group: TaskDialogRowGroup) => group.todoIds.flatMap((id) => {
    const todo = todoById.get(id)
    if (!todo) return []
    const people = assignedPeopleMap.get(id)
    return [isMobile
      ? <MobileTaskRow key={`${group.key}:${id}`} todo={todo} assignedPeople={people} onOpenDetail={openEditPopup} />
      : (
        <TaskRow
          key={`${group.key}:${id}`}
          todo={todo}
          assignedPeople={people}
          onSelect={openEditPopup}
          onOpenDetail={openEditPopup}
        />
      )]
  })

  return (
    <>
      <div className={styles.header}>
        <GlanceGlyph name={payload.glyph} className={styles.glyph} />
        <h2 id={titleId} className={styles.title}>{payload.title}</h2>
        <span className={styles.countBadge} data-testid="task-dialog-count">{count}</span>
        <button type="button" className={styles.closeBtn} aria-label="Close" onClick={onClose}>×</button>
      </div>
      {filterBar}
      {chips
        ? <ScreenDescription chips={chips} lens={lens} />
        : <p className={styles.description}>{payload.description}</p>}
      <div className={styles.body} aria-label="Tasks" role="group">
        {count === 0 && <div className={styles.empty}>No tasks</div>}
        {/* The default split: no divider here. */}
        <TaskRowGrid>
          {groups.map((g) => (g.label == null
            ? <div key={g.key}>{rowsOf(g)}</div>
            : (
              <div key={g.key} className={styles.group} role="group" aria-label={g.label} data-task-dialog-group={g.key} data-row-group="">
                <div className={styles.groupHeader}>
                  <i className={styles.groupDot} style={{ background: g.color ?? 'var(--color-text-muted)' }} />
                  <span className={styles.groupName}>{g.label}</span>
                  <span className={styles.groupCount}>{g.todoIds.length}</span>
                  <span className={styles.groupRule} aria-hidden="true" />
                </div>
                {rowsOf(g)}
              </div>
            )))}
        </TaskRowGrid>
      </div>
      <div className={styles.footer}>
        <button type="button" className={styles.ghostBtn} onClick={() => { void copy() }} disabled={count === 0}>
          <CopyIcon />
          {copied ? 'Copied' : 'Copy tasks'}
        </button>
        {personId != null && <CheckinButton personId={personId} fallbackName={payload.title} />}
        <span className={styles.spacer} />
        <button type="button" className={styles.closeTextBtn} onClick={onClose}>
          Close<kbd className={styles.kbd}>Esc</kbd>
        </button>
      </div>
    </>
  )
}

/** A person's Email check-in: opens the menu to send their check-in or paste their reply. */
function CheckinButton({ personId, fallbackName }: { personId: number; fallbackName: string }) {
  const name = usePersonStore((s) => s.people.find((p) => p.id === personId)?.name) ?? fallbackName
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={styles.ghostBtn}
        data-task-dialog-checkin=""
        aria-label={`Email check-in options for ${name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <EnvelopeIcon size={12} />
        Email check-in
        <ChevronDownIcon size={12} />
      </button>
      {open && <PersonCheckinMenu person={{ id: personId, name }} anchorRef={ref} onClose={() => setOpen(false)} />}
    </>
  )
}

/**
 * The screen filter's tasks in words, kept current: with a lens, what it and
 * the chips keep (its own component: only it counts the tasks on a write).
 */
function ScreenDescription({ chips, lens }: { chips: FilterCriteria; lens: Lens | undefined }) {
  const counts = useScreenTaskCounts()
  return <p className={styles.description}>{screenTaskDialogDescription(chips, lens && { name: lens.name, counts })}</p>
}

function CopyIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M10.5 3.5v-.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h.5" />
    </svg>
  )
}
