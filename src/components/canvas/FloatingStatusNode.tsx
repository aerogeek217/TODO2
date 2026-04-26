import { memo } from 'react'
import { type NodeProps } from '@xyflow/react'
import type { FloatingStatus } from '../../models'
import { StatusSlotContent } from './rails/StatusSlotContent'
import { WidgetHeader } from '../shared/WidgetHeader'
import { WidgetKindMenu } from '../shared/WidgetKindMenu'
import { ResizeHandle } from '../shared/ResizeHandle'
import { useFloatingWidget } from '../../hooks/use-floating-widget'
import styles from './FloatingStatusNode.module.css'

export interface FloatingStatusNodeData {
  status: FloatingStatus
  onDelete: (id: number) => void
  onResize?: (id: number, width: number, height: number) => void
}

function FloatingStatusNodeInner({ data }: NodeProps & { data: FloatingStatusNodeData }) {
  const { status, onDelete, onResize } = data
  const width = status.width
  const height = status.height

  const { headerProps, handleChangeKind, kindAnchor, setKindAnchor } = useFloatingWidget({
    kind: 'status',
    id: status.id,
    rect: { x: status.x, y: status.y, width, height },
    onDelete,
  })

  return (
    <div className={styles.status} style={{ width, height }}>
      <WidgetHeader kind="status" title="Open by status" {...headerProps} floating />

      <div className={`${styles.body} nopan nodrag nowheel`}>
        <StatusSlotContent />
      </div>

      <ResizeHandle
        axis="xy"
        width={width}
        height={height}
        minW={280}
        minH={160}
        className={`${styles.resizeHandle} nopan nodrag`}
        bodySelector={`.${styles.status}`}
        onResize={(w, h) => { if (status.id != null) onResize?.(status.id, w, h) }}
      />
      {kindAnchor && (
        <WidgetKindMenu
          anchor={kindAnchor}
          currentKind="status"
          onChangeKind={(k) => { void handleChangeKind(k) }}
          onClose={() => setKindAnchor(null)}
        />
      )}
    </div>
  )
}

export const FloatingStatusNode = memo(FloatingStatusNodeInner)
