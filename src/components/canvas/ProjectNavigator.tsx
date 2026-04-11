import { useRef } from 'react'
import type { Project, PersistedTodoItem } from '../../models'
import type { ReactFlowInstance } from '@xyflow/react'
import { useClickOutside } from '../../hooks/use-click-outside'
import { useUIStore } from '../../stores/ui-store'
import styles from './ProjectNavigator.module.css'

interface ProjectNavigatorProps {
  projects: Project[]
  todosByProject: Map<number, PersistedTodoItem[]>
  rfInstance: ReactFlowInstance | null
}

export function ProjectNavigator({ projects, todosByProject, rfInstance }: ProjectNavigatorProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  useClickOutside(panelRef, () => useUIStore.getState().toggleProjectNavigator(), true)

  const handleClick = (project: Project) => {
    if (!rfInstance || !project.id) return
    rfInstance.fitView({
      nodes: [{ id: String(project.id) }],
      padding: 0.3,
      duration: 300,
    })
  }

  return (
    <div ref={panelRef} className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.headerTitle}>Projects</span>
        <button
          className={styles.closeButton}
          onClick={() => useUIStore.getState().toggleProjectNavigator()}
        >
          &times;
        </button>
      </div>
      <div className={styles.list}>
        {projects.map(project => (
          <button
            key={project.id}
            className={styles.item}
            onClick={() => handleClick(project)}
          >
            <span
              className={styles.dot}
              style={{ backgroundColor: project.color || 'var(--color-accent)' }}
            />
            <span className={styles.name}>{project.name}</span>
            <span className={styles.count}>{todosByProject.get(project.id!)?.length ?? 0}</span>
          </button>
        ))}
        {projects.length === 0 && (
          <div className={styles.empty}>No projects</div>
        )}
      </div>
    </div>
  )
}
