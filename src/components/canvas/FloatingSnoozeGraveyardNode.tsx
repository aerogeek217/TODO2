import { memo } from 'react'
import { type NodeProps } from '@xyflow/react'
import type { FloatingSnoozeGraveyard } from '../../models'
import { SnoozeGraveyardSlotContent } from './rails/SnoozeGraveyardSlotContent'
import { SimpleFloatingWidget } from './SimpleFloatingWidget'

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
  return (
    <SimpleFloatingWidget
      kind="snoozeGraveyard"
      title="Snooze graveyard"
      minW={280}
      minH={160}
      id={graveyard.id}
      rect={{ x: graveyard.x, y: graveyard.y, width: graveyard.width, height: graveyard.height }}
      onDelete={onDelete}
      onResize={onResize}
      body={<SnoozeGraveyardSlotContent />}
    />
  )
}

export const FloatingSnoozeGraveyardNode = memo(FloatingSnoozeGraveyardNodeInner)
