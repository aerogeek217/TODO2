import { useEffect, useRef, useState } from 'react'
import { useClickOutside } from '../../hooks/use-click-outside'
import styles from './PortalDropdown.module.css'

interface PortalDropdownProps {
  anchorRef: React.RefObject<HTMLElement | null>
  onClickOutside: () => void
  children: React.ReactNode
}

/**
 * Portal-rendered dropdown anchored below a trigger element. Tracks the
 * anchor's bounding rect on resize, scroll (capture-phase, so containers count),
 * and React Flow viewport transforms; clamps so the panel stays inside the
 * viewport. Used by `TaskRow`'s status / people / scheduled menus, and by
 * `MobileTaskRow`'s long-press context menu + chip popovers (Phase 6 parity).
 */
export function PortalDropdown({ anchorRef, onClickOutside, children }: PortalDropdownProps) {
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: -9999, left: -9999 })

  useClickOutside(dropdownRef, onClickOutside, true)

  useEffect(() => {
    const update = () => {
      const rect = anchorRef.current?.getBoundingClientRect()
      if (!rect) return
      const margin = 8
      let top = rect.bottom + 4
      let left = rect.left
      const dd = dropdownRef.current?.getBoundingClientRect()
      if (dd && dd.width > 0) {
        const maxLeft = window.innerWidth - dd.width - margin
        if (left > maxLeft) left = Math.max(margin, maxLeft)
        const maxTop = window.innerHeight - dd.height - margin
        if (top > maxTop) top = Math.max(margin, maxTop)
      }
      setPos(prev => (prev.top === top && prev.left === left ? prev : { top, left }))
    }
    update()

    const ro = new ResizeObserver(update)
    if (anchorRef.current) ro.observe(anchorRef.current)
    if (dropdownRef.current) ro.observe(dropdownRef.current)

    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)

    const transformEl = anchorRef.current?.closest('.react-flow')?.querySelector('.react-flow__viewport') as HTMLElement | null
    const mo = transformEl ? new MutationObserver(update) : null
    if (mo && transformEl) mo.observe(transformEl, { attributes: true, attributeFilter: ['style'] })

    return () => {
      ro.disconnect()
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
      mo?.disconnect()
    }
  }, [anchorRef])

  return (
    <div ref={dropdownRef} className={styles.portalDropdown} style={{ top: pos.top, left: pos.left }}>
      {children}
    </div>
  )
}
