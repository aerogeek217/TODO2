import { memo } from 'react'
import { type NodeProps } from '@xyflow/react'
import type { FloatingScoreboard } from '../../models'
import { ScoreboardSlotContent } from './rails/ScoreboardSlotContent'
import { WidgetHeader } from '../shared/WidgetHeader'
import { WidgetKindMenu } from '../shared/WidgetKindMenu'
import { ResizeHandle } from '../shared/ResizeHandle'
import { useFloatingWidget } from '../../hooks/use-floating-widget'
import styles from './FloatingScoreboardNode.module.css'

export interface FloatingScoreboardNodeData {
  scoreboard: FloatingScoreboard
  onDelete: (id: number) => void
  onResize?: (id: number, width: number, height: number) => void
}

function FloatingScoreboardNodeInner({ data }: NodeProps & { data: FloatingScoreboardNodeData }) {
  const { scoreboard, onDelete, onResize } = data
  const width = scoreboard.width
  const height = scoreboard.height

  const { headerProps, handleChangeKind, kindAnchor, setKindAnchor } = useFloatingWidget({
    kind: 'scoreboard',
    id: scoreboard.id,
    rect: { x: scoreboard.x, y: scoreboard.y, width, height },
    onDelete,
  })

  return (
    <div className={styles.scoreboard} style={{ width, height }}>
      <WidgetHeader kind="scoreboard" title="Discipline" {...headerProps} floating />

      <div className={`${styles.body} nopan nodrag nowheel`}>
        <ScoreboardSlotContent />
      </div>

      <ResizeHandle
        axis="xy"
        width={width}
        height={height}
        minW={420}
        minH={200}
        className={`${styles.resizeHandle} nopan nodrag`}
        bodySelector={`.${styles.scoreboard}`}
        onResize={(w, h) => { if (scoreboard.id != null) onResize?.(scoreboard.id, w, h) }}
      />
      {kindAnchor && (
        <WidgetKindMenu
          anchor={kindAnchor}
          currentKind="scoreboard"
          onChangeKind={(k) => { void handleChangeKind(k) }}
          onClose={() => setKindAnchor(null)}
        />
      )}
    </div>
  )
}

export const FloatingScoreboardNode = memo(FloatingScoreboardNodeInner)
