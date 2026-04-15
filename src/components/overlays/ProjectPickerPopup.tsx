import { useEffect, useRef } from 'react'
import { ProjectPicker } from '../shared/ProjectPicker'
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

const WIDTH_PX = 240
const EST_HEIGHT_PX = 300
const MARGIN_PX = 8

export function ProjectPickerPopup({ x, y, projectId, projects, onSelect, onClose }: ProjectPickerPopupProps) {
  const popupRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handler, true)
    document.addEventListener('keydown', keyHandler, true)
    return () => {
      document.removeEventListener('mousedown', handler, true)
      document.removeEventListener('keydown', keyHandler, true)
    }
  }, [onClose])

  useEffect(() => {
    if (!popupRef.current) return
    const rect = popupRef.current.getBoundingClientRect()
    if (rect.right > window.innerWidth) {
      popupRef.current.style.left = `${window.innerWidth - rect.width - MARGIN_PX / 2}px`
    }
    if (rect.bottom > window.innerHeight) {
      popupRef.current.style.top = `${window.innerHeight - rect.height - MARGIN_PX / 2}px`
    }
  }, [x, y])

  const clampedX = Math.min(x, window.innerWidth - WIDTH_PX - MARGIN_PX)
  const clampedY = Math.min(y, window.innerHeight - EST_HEIGHT_PX - MARGIN_PX)

  return (
    <div ref={popupRef} className={styles.popup} style={{ left: Math.max(MARGIN_PX, clampedX), top: Math.max(MARGIN_PX, clampedY) }}>
      <ProjectPicker
        projectId={projectId}
        projects={projects}
        onSelect={(id) => { onSelect(id); onClose() }}
        autoFocus
      />
    </div>
  )
}
