import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useIsMobile } from '../../hooks/use-is-mobile'
import { copyTasksRich } from '../../services/task-copy'
import {
  resolveTaskDialog,
  taskDialogCopySections,
  taskDialogCount,
  type TaskDialogEnv,
  type TaskDialogPayload,
  type TaskDialogRowGroup,
} from '../../services/task-dialog'
import { useFilterStore } from '../../stores/filter-store'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { useListDraftStore } from '../../stores/list-draft-store'
import { useListOrderStore } from '../../stores/list-order-store'
import { usePersonStore } from '../../stores/person-store'
import { currentFilterSettings, useSettingsStore } from '../../stores/settings-store'
import { useStatusStore } from '../../stores/status-store'
import { useTagStore } from '../../stores/tag-store'
import { useTodoStore } from '../../stores/todo-store'
import type { WorkspaceLayout } from '../../models/workspace-layout'
import { useUIStore } from '../../stores/ui-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { startOfToday } from '../../utils/date'
import { findTab } from '../../utils/workspace-layout-ops'
import { DialogFrame } from '../shared/Dialog'
import { MobileTaskRow } from '../task/MobileTaskRow'
import { TaskRow } from '../task/TaskRow'
import { DashGlyph } from '../workspace/dashboard/glyphs'
import { EnvelopeIcon } from '../workspace/icons'
import styles from './TaskDialog.module.css'

/** The stores as they are now: what a source is resolved with when the dialog opens. */
function currentEnv(): TaskDialogEnv {
  const drafts = useListDraftStore.getState().drafts
  const people = usePersonStore.getState()
  const tags = useTagStore.getState()
  return {
    todos: useTodoStore.getState().todos,
    today: startOfToday(),
    weekStartsOn: useSettingsStore.getState().weekStartsOn,
    markerSettings: currentFilterSettings(),
    assignedPeopleMap: people.assignedPeopleMap,
    assignedTagsMap: tags.assignedTagsMap,
    people: people.people,
    statuses: useStatusStore.getState().statuses,
    listDefinitions: useListDefinitionStore.getState().listDefinitions.map((d) => drafts[d.id] ?? d),
    screen: useFilterStore.getState().filters,
    listRanks: useListOrderStore.getState().ranks,
  }
}

interface Resolved {
  payload: TaskDialogPayload
  groups: TaskDialogRowGroup[]
}

const resolve = (payload: TaskDialogPayload): Resolved => ({ payload, groups: resolveTaskDialog(payload.source, currentEnv()) })

/** The cell holding tab `tabId`, and the tab's index there. */
function cellOfTab(layout: WorkspaceLayout, tabId: string | undefined): { cellId: string; index: number } | null {
  if (tabId == null) return null
  const loc = findTab(layout, tabId)
  const cell = loc ? layout.columns[loc.colIdx]?.cells[loc.cellIdx] : undefined
  return loc && cell ? { cellId: cell.id, index: loc.tabIdx } : null
}

/**
 * The task dialog: the tasks behind a dashboard number or a person chip
 * (`ui-store.taskDialog`). Rows are full task rows (no drag); clicking one
 * opens the task editor on top. The rows are fixed when the dialog opens, so
 * a task completed here stays, struck through, until it closes, while the
 * counts behind update. Footer: Copy tasks, Email check-in (a person's
 * tasks: opens the check-in dialog over this one with that person ticked),
 * Open as tab (a list's dialog opened from a widget), Close.
 *
 * It sits low (the editor's own layer) so the rows' menus and popovers open
 * above it; the editor stacks over it (`nested`) and takes focus. Esc closes
 * it unless the editor (or another layer) has the key.
 */
export function TaskDialog() {
  const payload = useUIStore((s) => s.taskDialog)
  if (!payload) return null
  return <TaskDialogPanel payload={payload} />
}

function TaskDialogPanel({ payload }: { payload: TaskDialogPayload }) {
  const [resolved, setResolved] = useState<Resolved>(() => resolve(payload))
  // A new payload while open (e.g. a person chip in a row): resolve it afresh.
  if (resolved.payload !== payload) setResolved(resolve(payload))
  const { groups } = resolved

  const todos = useTodoStore((s) => s.todos)
  const assignedPeopleMap = usePersonStore((s) => s.assignedPeopleMap)
  const statuses = useStatusStore((s) => s.statuses)
  const editPopupMode = useUIStore((s) => s.editPopupMode)
  const openEditPopup = useUIStore((s) => s.openEditPopup)
  const hide = useUIStore((s) => s.hideTaskDialog)
  const isMobile = useIsMobile()
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState(false)

  const todoById = useMemo(() => new Map(todos.map((t) => [t.id, t])), [todos])
  const count = taskDialogCount(groups)
  const { personId } = payload

  // Open as tab: a list's dialog opened from a widget whose tab is still there.
  const workingLayout = useWorkspaceStore((s) => s.working)
  const tabTarget = useMemo(
    () => (payload.source.kind === 'list' && workingLayout ? cellOfTab(workingLayout, payload.fromTabId) : null),
    [payload, workingLayout],
  )

  // The editor closed: focus comes back here, so the next Esc closes the dialog.
  const editorWasOpen = useRef(false)
  useEffect(() => {
    if (editPopupMode) {
      editorWasOpen.current = true
    } else if (editorWasOpen.current) {
      editorWasOpen.current = false
      panelRef.current?.focus()
    }
  }, [editPopupMode])

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

  const openAsTab = () => {
    if (payload.source.kind !== 'list' || !tabTarget) return
    useWorkspaceStore.getState().addWidget(
      'lens',
      { kind: 'cell', cellId: tabTarget.cellId, index: tabTarget.index + 1 },
      { listDefinitionId: payload.source.listDefinitionId },
    )
    hide()
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
    <DialogFrame
      onClose={hide}
      layer="overlay"
      initialFocus="panel"
      // The editor on top owns Esc while it's open.
      escapeBelongsElsewhere={editorIsOpen}
      aria-labelledby={titleId}
      className={styles.dialog}
      data={{ 'task-dialog': '' }}
      panelRef={panelRef}
    >
        <div className={styles.header}>
          <DashGlyph name={payload.glyph} className={styles.glyph} />
          <h2 id={titleId} className={styles.title}>{payload.title}</h2>
          <span className={styles.countBadge} data-testid="task-dialog-count">{count}</span>
          <button type="button" className={styles.closeBtn} aria-label="Close" onClick={hide}>×</button>
        </div>
        <p className={styles.description}>{payload.description}</p>
        <div className={styles.body} aria-label="Tasks" role="group">
          {count === 0 && <div className={styles.empty}>No tasks</div>}
          {groups.map((g) => (g.label == null
            ? <div key={g.key}>{rowsOf(g)}</div>
            : (
              <div key={g.key} role="group" aria-label={g.label} data-task-dialog-group={g.key}>
                <div className={styles.groupHeader}>
                  <i className={styles.groupDot} style={{ background: g.color ?? 'var(--color-text-muted)' }} />
                  <span>{g.label}</span>
                  <span className={styles.groupCount}>· {g.todoIds.length}</span>
                </div>
                {rowsOf(g)}
              </div>
            )))}
        </div>
        <div className={styles.footer}>
          <button type="button" className={styles.ghostBtn} onClick={() => { void copy() }} disabled={count === 0}>
            <CopyIcon />
            {copied ? 'Copied' : 'Copy tasks'}
          </button>
          {personId != null && (
            <button
              type="button"
              className={styles.ghostBtn}
              data-task-dialog-checkin=""
              onClick={() => useUIStore.getState().openCheckinDialog([personId])}
            >
              <EnvelopeIcon size={12} />
              Email check-in
            </button>
          )}
          <span className={styles.spacer} />
          {tabTarget && (
            <button type="button" className={styles.ghostBtn} onClick={openAsTab}>Open as tab</button>
          )}
          <button type="button" className={styles.closeTextBtn} onClick={hide}>
            Close<kbd className={styles.kbd}>Esc</kbd>
          </button>
        </div>
    </DialogFrame>
  )
}

const editorIsOpen = () => useUIStore.getState().editPopupMode != null

function CopyIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M10.5 3.5v-.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h.5" />
    </svg>
  )
}
