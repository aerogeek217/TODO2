import { ListDefinitionBody } from '../ListDefinitionBody'
import { DraggableTaskRow } from '../shared/DraggableTaskRow'
import styles from './LensSlotContent.module.css'

interface LensSlotContentProps {
  listDefinitionId: number | undefined
  onTitleChange?: (title: string, count: number) => void
}

export function LensSlotContent({ listDefinitionId, onTitleChange }: LensSlotContentProps) {
  if (listDefinitionId == null) {
    return <div className={styles.empty}>No list configured</div>
  }
  return (
    <ListDefinitionBody
      listDefinitionId={listDefinitionId}
      onResult={({ name, count }) => onTitleChange?.(name ?? '(Deleted list)', count)}
      showContext
      compact
      className={styles.list}
      emptyClassName={styles.empty}
      renderRow={({ todo, assignedPeople, onOpenDetail }) => (
        <DraggableTaskRow
          key={todo.id}
          todo={todo}
          assignedPeople={assignedPeople}
          onOpenDetail={onOpenDetail}
          idPrefix="lens"
          showContext
        />
      )}
    />
  )
}
