import type { DraggableAttributes, DraggableSyntheticListeners } from '@dnd-kit/core'

interface DragHandleProps {
  className?: string
  attributes?: DraggableAttributes
  listeners?: DraggableSyntheticListeners
  ariaHidden?: boolean
}

/**
 * 6-dot drag-handle SVG with optional dnd-kit `attributes`/`listeners`
 * spread onto the wrapper span. Decorative when `ariaHidden` is true (the
 * default) — actual drag wiring lives elsewhere; spread the dnd-kit pair
 * when this span IS the activator.
 */
export function DragHandle({ className, attributes, listeners, ariaHidden = true }: DragHandleProps) {
  return (
    <span className={className} aria-hidden={ariaHidden ? true : undefined} {...attributes} {...listeners}>
      <svg width="8" height="14" viewBox="0 0 8 14" fill="currentColor">
        <circle cx="2" cy="2" r="1.2" /><circle cx="6" cy="2" r="1.2" />
        <circle cx="2" cy="7" r="1.2" /><circle cx="6" cy="7" r="1.2" />
        <circle cx="2" cy="12" r="1.2" /><circle cx="6" cy="12" r="1.2" />
      </svg>
    </span>
  )
}
