import { memo } from 'react'
import { type NodeProps } from '@xyflow/react'
import type { FloatingScoreboard } from '../../models'
import { ScoreboardSlotContent } from './rails/ScoreboardSlotContent'
import { SimpleFloatingWidget } from './SimpleFloatingWidget'

export interface FloatingScoreboardNodeData {
  // React Flow's `Node['data']` requires `Record<string, unknown>`. The index
  // signature lets canvas builders register typed nodes without casting.
  [key: string]: unknown
  scoreboard: FloatingScoreboard
  onDelete: (id: number) => void
  onResize?: (id: number, width: number, height: number) => void
}

function FloatingScoreboardNodeInner({ data }: NodeProps & { data: FloatingScoreboardNodeData }) {
  const { scoreboard, onDelete, onResize } = data
  return (
    <SimpleFloatingWidget
      kind="scoreboard"
      title="Discipline"
      minW={420}
      minH={200}
      id={scoreboard.id}
      rect={{ x: scoreboard.x, y: scoreboard.y, width: scoreboard.width, height: scoreboard.height }}
      onDelete={onDelete}
      onResize={onResize}
      body={<ScoreboardSlotContent />}
    />
  )
}

export const FloatingScoreboardNode = memo(FloatingScoreboardNodeInner)
