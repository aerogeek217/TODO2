import { memo } from 'react'
import { type NodeProps } from '@xyflow/react'
import type { FloatingHorizons } from '../../models'
import { HorizonsSlotContent } from './rails/HorizonsSlotContent'
import { SimpleFloatingWidget } from './SimpleFloatingWidget'

export interface FloatingHorizonsNodeData {
  // React Flow's `Node['data']` requires `Record<string, unknown>`. The index
  // signature lets canvas builders register typed nodes without casting.
  [key: string]: unknown
  horizons: FloatingHorizons
  onDelete: (id: number) => void
  onResize?: (id: number, width: number, height: number) => void
}

function FloatingHorizonsNodeInner({ data }: NodeProps & { data: FloatingHorizonsNodeData }) {
  const { horizons, onDelete, onResize } = data
  return (
    <SimpleFloatingWidget
      kind="horizons"
      title="Horizons"
      minW={320}
      minH={240}
      id={horizons.id}
      rect={{ x: horizons.x, y: horizons.y, width: horizons.width, height: horizons.height }}
      onDelete={onDelete}
      onResize={onResize}
      body={<HorizonsSlotContent />}
    />
  )
}

export const FloatingHorizonsNode = memo(FloatingHorizonsNodeInner)
