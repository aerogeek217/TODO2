import { memo } from 'react'
import { type NodeProps } from '@xyflow/react'
import type { FloatingHorizons } from '../../models'
import { HorizonsSlotContent } from './rails/HorizonsSlotContent'
import { WidgetHeader } from '../shared/WidgetHeader'
import { WidgetKindMenu } from '../shared/WidgetKindMenu'
import { ResizeHandle } from '../shared/ResizeHandle'
import { useFloatingWidget } from '../../hooks/use-floating-widget'
import styles from './FloatingHorizonsNode.module.css'

export interface FloatingHorizonsNodeData {
  horizons: FloatingHorizons
  onDelete: (id: number) => void
  onResize?: (id: number, width: number, height: number) => void
}

function FloatingHorizonsNodeInner({ data }: NodeProps & { data: FloatingHorizonsNodeData }) {
  const { horizons, onDelete, onResize } = data
  const width = horizons.width
  const height = horizons.height

  const { headerProps, handleChangeKind, kindAnchor, setKindAnchor } = useFloatingWidget({
    kind: 'horizons',
    id: horizons.id,
    rect: { x: horizons.x, y: horizons.y, width, height },
    onDelete,
  })

  return (
    <div className={styles.horizons} style={{ width, height }}>
      <WidgetHeader kind="horizons" title="Horizons" {...headerProps} floating />

      <div className={`${styles.body} nopan nodrag nowheel`}>
        <HorizonsSlotContent />
      </div>

      <ResizeHandle
        axis="xy"
        width={width}
        height={height}
        minW={320}
        minH={240}
        className={`${styles.resizeHandle} nopan nodrag`}
        bodySelector={`.${styles.horizons}`}
        onResize={(w, h) => { if (horizons.id != null) onResize?.(horizons.id, w, h) }}
      />
      {kindAnchor && (
        <WidgetKindMenu
          anchor={kindAnchor}
          currentKind="horizons"
          onChangeKind={(k) => { void handleChangeKind(k) }}
          onClose={() => setKindAnchor(null)}
        />
      )}
    </div>
  )
}

export const FloatingHorizonsNode = memo(FloatingHorizonsNodeInner)
