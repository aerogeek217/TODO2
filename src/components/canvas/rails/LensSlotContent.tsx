import type { PersistedTodoItem } from '../../../models'
import { ListDefinitionBody } from '../ListDefinitionBody'
import { DraggableTaskRow } from '../shared/DraggableTaskRow'
import styles from './LensSlotContent.module.css'

interface LensSlotContentProps {
  listDefinitionId: number | undefined
  onTitleChange?: (title: string, count: number, todos: PersistedTodoItem[]) => void
  runtimeFilterValue?: number[]
  onRuntimeFilterChange?: (value: number[] | undefined) => void
}

export function LensSlotContent({
  listDefinitionId,
  onTitleChange,
  runtimeFilterValue,
  onRuntimeFilterChange,
}: LensSlotContentProps) {
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
      renderRow={({ todo, assignedPeople, onOpenDetail }) => (
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
