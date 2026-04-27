import { createPortal } from 'react-dom'
import { ProjectPicker } from '../shared/ProjectPicker'
import { usePopoverAnchor } from '../../hooks/use-popover-anchor'
import styles from './ProjectPickerPopup.module.css'

interface ProjectItem {
  id?: number
  name: string
  color?: string
}

interface ProjectPickerPopupProps {
  x: number
  y: number
  projectId: number | undefined
  projects: ProjectItem[]
  onSelect: (id: number | undefined) => void
  onClose: () => void
}

/**
 * Project assignment picker shown by right-click context menus and TopBar's
 * search-result "Move to project…" path. Portals internally so callers
 * don't need their own `createPortal` wrapper.
 */
export function ProjectPickerPopup({ x, y, projectId, projects, onSelect, onClose }: ProjectPickerPopupProps) {
  const { panelRef, style } = usePopoverAnchor({
    anchor: { kind: 'point', x, y },
    open: true,
    onClose,
  })

  return createPortal(
    <div ref={panelRef} className={styles.popup} style={style}>
      <ProjectPicker
        projectId={projectId}
        projects={projects}
        onSelect={(id) => { onSelect(id); onClose() }}
        autoFocus
      />
    </div>,
    document.body,
  )
}
