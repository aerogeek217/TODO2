import type { ReactNode } from 'react'
import type { SlotKind } from '../../models/canvas-rails'
import { WidgetHeader } from '../shared/WidgetHeader'
import { WidgetKindMenu } from '../shared/WidgetKindMenu'
import { ResizeHandle } from '../shared/ResizeHandle'
import { useFloatingWidget } from '../../hooks/use-floating-widget'
import styles from './SimpleFloatingWidget.module.css'

export interface SimpleFloatingWidgetProps {
  kind: SlotKind
  title: string
  body: ReactNode
  minW: number
  minH: number
  id: number | undefined
  rect: { x: number; y: number; width: number; height: number }
  onDelete: (id: number) => void
  onResize?: (id: number, width: number, height: number) => void
}

/**
 * Shared chrome (header + body + resize-handle + kind-switch menu) for the
 * five "thin" floating canvas widgets — note, horizons, status, scoreboard,
 * snooze-graveyard. Each ships only its kind-specific body (`<NotesBody>`,
 * `<HorizonsSlotContent>`, …). Calendar + Taskboard stay bespoke (calendar
 * threads orientation/weekOffset header meta; taskboard owns drop hit-testing
 * + collapse semantics).
 *
 * `useFloatingWidget` is unchanged — same kind-switch / dock / close
 * plumbing the bespoke nodes already used. The shell preserves the original
 * width/height/minW props and the body's `nopan nodrag nowheel` classes
 * verbatim, so React Flow gesture interception matches the pre-refactor shape.
 */
export function SimpleFloatingWidget({
  kind,
  title,
  body,
  minW,
  minH,
  id,
  rect,
  onDelete,
  onResize,
}: SimpleFloatingWidgetProps) {
  const { width, height } = rect
  const { headerProps, handleChangeKind, kindAnchor, setKindAnchor } = useFloatingWidget({
    kind,
    id,
    rect,
    onDelete,
  })

  return (
    <div className={styles.widget} style={{ width, height, minWidth: minW }}>
      <WidgetHeader kind={kind} title={title} {...headerProps} floating />

      <div className={`${styles.body} nopan nodrag nowheel`} data-kind={kind}>
        {body}
      </div>

      <ResizeHandle
        axis="xy"
        width={width}
        height={height}
        minW={minW}
        minH={minH}
        className={`${styles.resizeHandle} nopan nodrag`}
        bodySelector={`.${styles.widget}`}
        onResize={(w, h) => { if (id != null) onResize?.(id, w, h) }}
      />
      {kindAnchor && (
        <WidgetKindMenu
          anchor={kindAnchor}
          currentKind={kind}
          onChangeKind={(k) => { void handleChangeKind(k) }}
          onClose={() => setKindAnchor(null)}
        />
      )}
    </div>
  )
}
