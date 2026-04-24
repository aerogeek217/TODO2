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
import { HORIZON_KEYS, type HorizonKey } from '../../../services/horizons'
import { startOfToday } from '../../../utils/date'
import { HorizonRibbon } from '../../dashboard/HorizonRibbon'
import { DraggableTaskRow } from '../shared/DraggableTaskRow'
import { DashboardListsEditor } from '../../settings/DashboardListsEditor'
import { ListDefinitionPickerPopup } from '../../overlays/ListDefinitionPickerPopup'
import styles from './HorizonsSlotContent.module.css'

/**
 * Rail/float widget body for the retired Dashboard view's horizon ribbon.
 * Renders the 5-slot ribbon up top and the currently-selected horizon's
 * task list below. All state (`horizonSlots` / `selectedHorizon`) lives
 * in settings — identical across every surface rendering the widget, same
 * pattern as calendar/notes/taskboard.
 */
export function HorizonsSlotContent() {
  const todos = useTodoStore((s) => s.todos)
  const assignedPeopleMap = usePersonStore((s) => s.assignedPeopleMap)
  const assignedOrgsMap = useOrgStore((s) => s.assignedOrgsMap)
  const personOrgMap = useOrgStore((s) => s.personOrgMap)
  const assignedTagsMap = useTagStore((s) => s.assignedTagsMap)
  const loadTagAssignments = useTagStore((s) => s.loadAssignments)
  const statuses = useStatusStore((s) => s.statuses)
  const listDefinitions = useListDefinitionStore((s) => s.listDefinitions)
  const horizonSlots = useSettingsStore((s) => s.horizonSlots)
  const selectedHorizon = useSettingsStore((s) => s.selectedHorizon)
  const setSelectedHorizon = useSettingsStore((s) => s.setSelectedHorizon)
  const setHorizonSlot = useSettingsStore((s) => s.setHorizonSlot)
  const weekStartsOn = useSettingsStore((s) => s.weekStartsOn)
  const openEditPopup = useUIStore((s) => s.openEditPopup)

  const [slotPickerAt, setSlotPickerAt] = useState<{ key: HorizonKey; x: number; y: number } | null>(null)
  const [showHorizonEditor, setShowHorizonEditor] = useState(false)

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

  useEffect(() => {
    if (todos.length === 0) return
    loadTagAssignments(todos.map((t) => t.id))
  }, [todos, loadTagAssignments])

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

  const horizonDefIds = useMemo(() => {
    const ids: number[] = []
    for (const key of HORIZON_KEYS) {
      const id = horizonSlots[key]
      if (id != null) ids.push(id)
    }
    return ids
  }, [horizonSlots])

  const horizonDefs = useMemo(() => {
    const setIds = new Set(horizonDefIds)
    return listDefinitions.filter((d) => d.id != null && setIds.has(d.id))
  }, [listDefinitions, horizonDefIds])

  const lists = useMemo<DashboardList[]>(() => {
    return buildDashboardLists(horizonDefs, todos, {
      today,
      evalPredicate,
      assignedTagsMap,
    })
  }, [horizonDefs, todos, today, evalPredicate, assignedTagsMap])

  const listsById = useMemo(() => {
    const map = new Map<number, DashboardList>()
    for (const l of lists) map.set(l.id, l)
    return map
  }, [lists])

  const horizonLists = useMemo(() => {
    const out: Partial<Record<HorizonKey, DashboardList>> = {}
    for (const key of HORIZON_KEYS) {
      const defId = horizonSlots[key]
      if (defId == null) continue
      const list = listsById.get(defId)
      if (list) out[key] = list
    }
    return out
  }, [horizonSlots, listsById])

  const tasksByHorizon = useMemo(() => {
    const out = {} as Record<HorizonKey, PersistedTodoItem[]>
    for (const key of HORIZON_KEYS) {
      out[key] = horizonLists[key]?.todos ?? []
    }
    return out
  }, [horizonLists])

  const labelsByHorizon = useMemo(() => {
    const out = {} as Record<HorizonKey, string>
    for (const key of HORIZON_KEYS) {
      out[key] = horizonLists[key]?.label ?? ''
    }
    return out
  }, [horizonLists])

  const unmappedSlots = useMemo(() => {
    const s = new Set<HorizonKey>()
    for (const key of HORIZON_KEYS) {
      if (!horizonLists[key]) s.add(key)
    }
    return s
  }, [horizonLists])

  const openSlotPicker = useCallback((key: HorizonKey) => {
    const el = document.querySelector(`[data-horizon="${key}"]`) as HTMLElement | null
    const rect = el?.getBoundingClientRect()
    setSlotPickerAt({
      key,
      x: rect?.left ?? 40,
      y: (rect?.bottom ?? 80) + 4,
    })
  }, [])

  const handleSlotPick = useCallback(async (listDefinitionId: number) => {
    if (slotPickerAt) {
      await setHorizonSlot(slotPickerAt.key, listDefinitionId)
      setSlotPickerAt(null)
    }
  }, [slotPickerAt, setHorizonSlot])

  const heroList = horizonLists[selectedHorizon]
  const assignedPeopleMapCast = assignedPeopleMap as Map<number, Person[]>

  return (
    <div className={styles.wrap}>
      <HorizonRibbon
        tasksByHorizon={tasksByHorizon}
        labelsByHorizon={labelsByHorizon}
        selectedHorizon={selectedHorizon}
        today={today}
        weekStartsOn={weekStartsOn}
        onSelect={(k) => { void setSelectedHorizon(k) }}
        onConfigureSlot={openSlotPicker}
        unmappedSlots={unmappedSlots}
        onEditHorizons={horizonDefIds.length > 0 ? () => setShowHorizonEditor(true) : undefined}
      />
      <div className={styles.body}>
        {heroList ? (
          heroList.todos.length === 0 ? (
            <div className={styles.empty}>No tasks</div>
          ) : (
            <div className={styles.list}>
              {heroList.todos.map((todo) => (
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
            {unmappedSlots.has(selectedHorizon) ? 'Configure this horizon to see tasks.' : 'No tasks'}
          </div>
        )}
      </div>
      {slotPickerAt && (
        <ListDefinitionPickerPopup
          x={slotPickerAt.x}
          y={slotPickerAt.y}
          mode="canvas"
          onSelect={(id) => { void handleSlotPick(id) }}
          onCreateNew={() => { setShowHorizonEditor(true); setSlotPickerAt(null) }}
          onClose={() => setSlotPickerAt(null)}
        />
      )}
      {showHorizonEditor && (
        <DashboardListsEditor
          onClose={() => setShowHorizonEditor(false)}
          filterIds={horizonDefIds}
          title="Edit horizons"
        />
      )}
    </div>
  )
}
