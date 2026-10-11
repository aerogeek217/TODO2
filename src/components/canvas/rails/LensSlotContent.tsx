import type { PersistedTodoItem } from '../../../models'
import { useIsMobile } from '../../../hooks/use-is-mobile'
import { ListDefinitionBody } from '../ListDefinitionBody'
import { DraggableTaskRow } from '../shared/DraggableTaskRow'
import { MobileTaskRow } from '../../task/MobileTaskRow'
import styles from './LensSlotContent.module.css'

interface LensSlotContentProps {
  listDefinitionId: number | undefined
  onTitleChange?: (title: string, count: number, todos: PersistedTodoItem[]) => void
  runtimeFilterValue?: number[]
  onRuntimeFilterChange?: (value: number[] | undefined) => void
}

/**
 * A list widget's body. On mobile the rows are touch rows and are not
 * draggable (task drag is desktop-only).
 */
export function LensSlotContent({
  listDefinitionId,
  onTitleChange,
  runtimeFilterValue,
  onRuntimeFilterChange,
}: LensSlotContentProps) {
  const isMobile = useIsMobile()
  if (listDefinitionId == null) {
    return <div className={styles.empty}>No list configured</div>
  }
  return (
    <ListDefinitionBody
      listDefinitionId={listDefinitionId}
      onResult={({ name, count, todos }) => onTitleChange?.(name ?? '(Deleted list)', count, todos)}
      showContext
      className={styles.list}
      emptyClassName={styles.empty}
      runtimeFilterValue={runtimeFilterValue}
      onRuntimeFilterChange={onRuntimeFilterChange}
      showAddTask
      renderRow={({ todo, assignedPeople, onOpenDetail }) => isMobile ? (
        <MobileTaskRow
          key={todo.id}
          todo={todo}
          assignedPeople={assignedPeople}
          onOpenDetail={onOpenDetail}
        />
      ) : (
        <DraggableTaskRow
          key={todo.id}
          todo={todo}
          assignedPeople={assignedPeople}
          onOpenDetail={onOpenDetail}
          surface="lens"
          showContext
        />
      )}
    />
  )
}
