import { memo } from 'react'
import { type NodeProps } from '@xyflow/react'
import type { FloatingSnoozeGraveyard } from '../../models'
import { SnoozeGraveyardSlotContent } from './rails/SnoozeGraveyardSlotContent'
import { WidgetHeader } from '../shared/WidgetHeader'
import { WidgetKindMenu } from '../shared/WidgetKindMenu'
import { ResizeHandle } from '../shared/ResizeHandle'
import { useFloatingWidget } from '../../hooks/use-floating-widget'
import styles from './FloatingSnoozeGraveyardNode.module.css'

export interface FloatingSnoozeGraveyardNodeData {
  // React Flow's `Node['data']` requires `Record<string, unknown>`. The index
  // signature lets canvas builders register typed nodes without casting.
  [key: string]: unknown
  graveyard: FloatingSnoozeGraveyard
  onDelete: (id: number) => void
  onResize?: (id: number, width: number, height: number) => void
}

function FloatingSnoozeGraveyardNodeInner({ data }: NodeProps & { data: FloatingSnoozeGraveyardNodeData }) {
  const { graveyard, onDelete, onResize } = data
  const width = graveyard.width
  const height = graveyard.height

  const { headerProps, handleChangeKind, kindAnchor, setKindAnchor } = useFloatingWidget({
    kind: 'snoozeGraveyard',
    id: graveyard.id,
    rect: { x: graveyard.x, y: graveyard.y, width, height },
    onDelete,
  })

  return (
    <div className={styles.graveyard} style={{ width, height }}>
      <WidgetHeader kind="snoozeGraveyard" title="Snooze graveyard" {...headerProps} floating />

      <div className={`${styles.body} nopan nodrag nowheel`}>
        <SnoozeGraveyardSlotContent />
      </div>

      <ResizeHandle
        axis="xy"
        width={width}
        height={height}
        minW={280}
        minH={160}
        className={`${styles.resizeHandle} nopan nodrag`}
        bodySelector={`.${styles.graveyard}`}
        onResize={(w, h) => { if (graveyard.id != null) onResize?.(graveyard.id, w, h) }}
      />
      {kindAnchor && (
        <WidgetKindMenu
          anchor={kindAnchor}
          currentKind="snoozeGraveyard"
          onChangeKind={(k) => { void handleChangeKind(k) }}
          onClose={() => setKindAnchor(null)}
        />
      )}
    </div>
  )
}

export const FloatingSnoozeGraveyardNode = memo(FloatingSnoozeGraveyardNodeInner)
