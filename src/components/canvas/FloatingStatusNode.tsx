import { memo } from 'react'
import { type NodeProps } from '@xyflow/react'
import type { FloatingStatus } from '../../models'
import { StatusSlotContent } from './rails/StatusSlotContent'
import { SimpleFloatingWidget } from './SimpleFloatingWidget'

export interface FloatingStatusNodeData {
  // React Flow's `Node['data']` requires `Record<string, unknown>`. The index
  // signature lets canvas builders register typed nodes without casting.
  [key: string]: unknown
  status: FloatingStatus
  onDelete: (id: number) => void
  onResize?: (id: number, width: number, height: number) => void
}

function FloatingStatusNodeInner({ data }: NodeProps & { data: FloatingStatusNodeData }) {
  const { status, onDelete, onResize } = data
  return (
    <SimpleFloatingWidget
      kind="status"
      title="Open by status"
      minW={280}
      minH={240}
      id={status.id}
      rect={{ x: status.x, y: status.y, width: status.width, height: status.height }}
      onDelete={onDelete}
      onResize={onResize}
      body={<StatusSlotContent />}
    />
  )
}

export const FloatingStatusNode = memo(FloatingStatusNodeInner)
