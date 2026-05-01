import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PersistedTodoItem, TodoPredicate, Person } from '../../../models'
import { useTodoStore } from '../../../stores/todo-store'
import { usePersonStore } from '../../../stores/person-store'
import { useOrgStore } from '../../../stores/org-store'
import { useTagStore } from '../../../stores/tag-store'
import { useStatusStore } from '../../../stores/status-store'
import { useListDefinitionStore } from '../../../stores/list-definition-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useUIStore } from '../../../stores/ui-store'
import {
  matchesFilter,
  predicateToCriteria,
  computeFilterPersonOrgIds,
} from '../../../stores/filter-store'
import { buildDashboardLists, type DashboardList } from '../../../services/dashboard-lists'
import { classifyByDateSource } from '../../../services/horizons'
import { startOfToday } from '../../../utils/date'
import { HorizonRibbon, type HorizonRow } from '../../dashboard/HorizonRibbon'
import { DraggableTaskRow } from '../shared/DraggableTaskRow'
import { DashboardListsEditor } from '../../settings/DashboardListsEditor'
import { ListDefinitionPickerPopup } from '../../overlays/ListDefinitionPickerPopup'
import { CanvasContextMenu } from '../../overlays/CanvasContextMenu'
import type { ContextMenuItem } from '../../../models/context-menu'
import styles from './HorizonsSlotContent.module.css'

type PickerMode =
  | { kind: 'add'; x: number; y: number }
  | { kind: 'add-at'; index: number; x: number; y: number }
  | { kind: 'swap'; index: number; x: number; y: number }

interface RowContextMenu {
  defId: number
  index: number
  x: number
  y: number
}

/**
 * Rail/float widget body for the horizons widget. Renders the labeled-bars
 * ribbon (one row per horizon list-def in `settings.horizonSlots`) above
 * the currently-selected row's task list. State (horizonSlots / selected
 * defId) lives in settings — identical across every surface rendering the
 * widget, same pattern as calendar/notes/taskboard.
 */
export function HorizonsSlotContent() {
  const todos = useTodoStore((s) => s.todos)
  const todosVersion = useTodoStore((s) => s.todosVersion)
  const assignedPeopleMap = usePersonStore((s) => s.assignedPeopleMap)
  const assignedOrgsMap = useOrgStore((s) => s.assignedOrgsMap)
  const personOrgMap = useOrgStore((s) => s.personOrgMap)
  const assignedTagsMap = useTagStore((s) => s.assignedTagsMap)
  const loadTagAssignments = useTagStore((s) => s.loadAssignments)
  const statuses = useStatusStore((s) => s.statuses)
  const listDefinitions = useListDefinitionStore((s) => s.listDefinitions)
  const horizonSlots = useSettingsStore((s) => s.horizonSlots)
  const selectedHorizonDefId = useSettingsStore((s) => s.selectedHorizonDefId)
  const setSelectedHorizonDefId = useSettingsStore((s) => s.setSelectedHorizonDefId)
  const addHorizon = useSettingsStore((s) => s.addHorizon)
  const removeHorizon = useSettingsStore((s) => s.removeHorizon)
  const reorderHorizons = useSettingsStore((s) => s.reorderHorizons)
  const setHorizonAt = useSettingsStore((s) => s.setHorizonAt)
  const weekStartsOn = useSettingsStore((s) => s.weekStartsOn)
  const openEditPopup = useUIStore((s) => s.openEditPopup)
  const openListEditorDialog = useUIStore((s) => s.openListEditorDialog)

  const [picker, setPicker] = useState<PickerMode | null>(null)
  const [showHorizonEditor, setShowHorizonEditor] = useState(false)
  const [rowContextMenu, setRowContextMenu] = useState<RowContextMenu | null>(null)

  // Date-sensitive predicates roll at midnight; re-key `today` on day change.
  const [dayKey, setDayKey] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
  })
  useEffect(() => {
    const now = new Date()
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime()
    const timer = setTimeout(() => {
      const d = new Date()
      setDayKey(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`)
    }, Math.max(1000, nextMidnight - now.getTime() + 50))
    return () => clearTimeout(timer)
  }, [dayKey])
  const today = useMemo(() => startOfToday(), [dayKey])

  // Reload tag assignments only when the id-set changes — see horizons P5
  // commit: gating on `${length}:${todosVersion}` keeps both ends stable
  // across field edits.
  const todoIdsKey = `${todos.length}:${todosVersion}`
  useEffect(() => {
    if (todos.length === 0) return
    loadTagAssignments(todos.map((t) => t.id))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todoIdsKey, loadTagAssignments])

  const evalPredicate = useCallback(
    (predicate: TodoPredicate, todo: PersistedTodoItem) => {
      const criteria = predicateToCriteria(predicate)
      const people = assignedPeopleMap.get(todo.id) ?? []
      const personIds = people.map((p) => p.id!)
      const personOrgIds = people.flatMap((p) => personOrgMap.get(p.id!) ?? [])
      const directOrgIds = (assignedOrgsMap.get(todo.id) ?? []).map((o) => o.id!)
      const assignedTagIds = (assignedTagsMap.get(todo.id) ?? []).map((t) => t.id!)
      const filterPersonOrgIds = computeFilterPersonOrgIds(criteria.personIds, criteria.personFilterMode, personOrgMap)
      return matchesFilter(criteria, todo, personIds, personOrgIds, directOrgIds, filterPersonOrgIds, statuses, today, undefined, assignedTagIds)
    },
    [assignedPeopleMap, assignedOrgsMap, personOrgMap, assignedTagsMap, statuses, today],
  )

  // Resolve every slot's def in array order (filters out deleted defs).
  const horizonDefs = useMemo(() => {
    const byId = new Map(listDefinitions.filter((d) => d.id != null).map((d) => [d.id!, d]))
    const out = []
    for (const id of horizonSlots) {
      const def = byId.get(id)
      if (def) out.push(def)
    }
    return out
  }, [listDefinitions, horizonSlots])

  const lists = useMemo<DashboardList[]>(() => {
    return buildDashboardLists(horizonDefs, todos, {
      today,
      weekStartsOn,
      evalPredicate,
      assignedTagsMap,
    })
  }, [horizonDefs, todos, today, weekStartsOn, evalPredicate, assignedTagsMap])

  // Bucket each list's todos into scheduled-derived vs. due-derived rows for
  // the stacked bar render. A todo lands in exactly one row (the def's
  // membership predicate decided that); the split only describes which date
  // drove it.
  const rows = useMemo<HorizonRow[]>(() => {
    const listsById = new Map(lists.map((l) => [l.id, l]))
    const out: HorizonRow[] = []
    for (const def of horizonDefs) {
      const list = listsById.get(def.id)
      if (!list) continue
      const scheduled: PersistedTodoItem[] = []
      const due: PersistedTodoItem[] = []
      for (const todo of list.todos) {
        if (classifyByDateSource(todo, today, weekStartsOn) === 'scheduled') scheduled.push(todo)
        else due.push(todo)
      }
      out.push({
        defId: def.id,
        label: list.label,
        scheduled,
        due,
        total: list.todos.length,
      })
    }
    return out
  }, [lists, horizonDefs, today, weekStartsOn])

  const selectedRow = useMemo(() => {
    if (selectedHorizonDefId == null) return null
    return rows.find((r) => r.defId === selectedHorizonDefId) ?? null
  }, [rows, selectedHorizonDefId])

  const handleSelect = useCallback((defId: number) => {
    void setSelectedHorizonDefId(defId)
  }, [setSelectedHorizonDefId])

  const handleSwap = useCallback((defId: number, anchor: { x: number; y: number }) => {
    const idx = horizonSlots.indexOf(defId)
    if (idx === -1) return
    setPicker({ kind: 'swap', index: idx, x: anchor.x, y: anchor.y })
  }, [horizonSlots])

  const handleRowContext = useCallback((defId: number, anchor: { x: number; y: number }) => {
    const idx = horizonSlots.indexOf(defId)
    if (idx === -1) return
    setRowContextMenu({ defId, index: idx, x: anchor.x, y: anchor.y })
  }, [horizonSlots])

  const handleAdd = useCallback((anchor: { x: number; y: number }) => {
    setPicker({ kind: 'add', x: anchor.x, y: anchor.y })
  }, [])

  const handleReorder = useCallback((from: number, to: number) => {
    void reorderHorizons(from, to)
  }, [reorderHorizons])

  const handlePick = useCallback(async (defId: number) => {
    if (!picker) return
    if (picker.kind === 'add') {
      await addHorizon(defId)
    } else if (picker.kind === 'add-at') {
      await addHorizon(defId, picker.index)
    } else {
      await setHorizonAt(picker.index, defId)
    }
    setPicker(null)
  }, [picker, addHorizon, setHorizonAt])

  const rowContextMenuItems = useMemo<ContextMenuItem[]>(() => {
    if (!rowContextMenu) return []
    const { defId, index, x, y } = rowContextMenu
    return [
      {
        label: 'Edit list',
        action: () => openListEditorDialog(defId),
      },
      {
        label: 'Insert below',
        action: () => setPicker({ kind: 'add-at', index: index + 1, x, y }),
      },
      {
        label: 'Remove',
        danger: true,
        action: () => { void removeHorizon(index) },
      },
    ]
  }, [rowContextMenu, openListEditorDialog, removeHorizon])

  const assignedPeopleMapCast = assignedPeopleMap as Map<number, Person[]>
  const selectedTodos = useMemo(() => {
    if (!selectedRow) return [] as PersistedTodoItem[]
    // scheduled + due are disjoint partitions of the def's todos already.
    return [...selectedRow.scheduled, ...selectedRow.due]
  }, [selectedRow])

  return (
    <div className={styles.wrap}>
      <HorizonRibbon
        rows={rows}
        selectedDefId={selectedHorizonDefId}
        onSelect={handleSelect}
        onSwap={handleSwap}
        onRowContext={handleRowContext}
        onAdd={handleAdd}
        onReorder={handleReorder}
      />
      <div className={styles.body}>
        {selectedRow ? (
          selectedTodos.length === 0 ? (
            <div className={styles.empty}>No tasks</div>
          ) : (
            <div className={styles.list}>
              {selectedTodos.map((todo) => (
                <DraggableTaskRow
                  key={todo.id}
                  todo={todo}
                  assignedPeople={assignedPeopleMapCast.get(todo.id)}
                  onOpenDetail={openEditPopup}
                  surface="lens"
                  showContext
                />
              ))}
            </div>
          )
        ) : (
          <div className={styles.empty}>
            {horizonSlots.length === 0 ? 'Add a horizon to start.' : 'Select a horizon to see tasks.'}
          </div>
        )}
      </div>
      {picker && (
        <ListDefinitionPickerPopup
          x={picker.x}
          y={picker.y}
          excludeIds={picker.kind === 'add' || picker.kind === 'add-at' ? horizonSlots : undefined}
          onSelect={(id) => { void handlePick(id) }}
          onCreateNew={() => { setShowHorizonEditor(true); setPicker(null) }}
          onClose={() => setPicker(null)}
        />
      )}
      {showHorizonEditor && (
        <DashboardListsEditor
          onClose={() => setShowHorizonEditor(false)}
          filterIds={horizonSlots}
          title="Edit horizons"
        />
      )}
      {rowContextMenu && (
        <CanvasContextMenu
          x={rowContextMenu.x}
          y={rowContextMenu.y}
          items={rowContextMenuItems}
          onClose={() => setRowContextMenu(null)}
        />
      )}
    </div>
  )
}
