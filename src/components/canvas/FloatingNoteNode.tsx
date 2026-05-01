import { memo } from 'react'
import { type NodeProps } from '@xyflow/react'
import type { FloatingNote } from '../../models'
import { NotesBody } from '../shared/notes/NotesBody'
import { WidgetHeader } from '../shared/WidgetHeader'
import { WidgetKindMenu } from '../shared/WidgetKindMenu'
import { ResizeHandle } from '../shared/ResizeHandle'
import { useFloatingWidget } from '../../hooks/use-floating-widget'
import styles from './FloatingNoteNode.module.css'

export interface FloatingNoteNodeData {
  // React Flow's `Node['data']` requires `Record<string, unknown>`. The index
  // signature lets canvas builders register typed nodes without casting.
  [key: string]: unknown
  note: FloatingNote
  onDelete: (id: number) => void
  onResize?: (id: number, width: number, height: number) => void
}

function FloatingNoteNodeInner({ data }: NodeProps & { data: FloatingNoteNodeData }) {
  const { note, onDelete, onResize } = data
  const width = note.width
  const height = note.height

  const { headerProps, handleChangeKind, kindAnchor, setKindAnchor } = useFloatingWidget({
    kind: 'notes',
    id: note.id,
    rect: { x: note.x, y: note.y, width, height },
    onDelete,
  })

  return (
    <div className={styles.note} style={{ width, height }}>
      <WidgetHeader kind="notes" title="Notes · Inbox" {...headerProps} floating />

      <div className={`${styles.body} nopan nodrag nowheel`}>
        <NotesBody dock="floating" showToolbar />
      </div>

      <ResizeHandle
        axis="xy"
        width={width}
        height={height}
        minW={160}
        minH={120}
        className={`${styles.resizeHandle} nopan nodrag`}
        bodySelector={`.${styles.note}`}
        onResize={(w, h) => { if (note.id != null) onResize?.(note.id, w, h) }}
      />
      {kindAnchor && (
        <WidgetKindMenu
          anchor={kindAnchor}
          currentKind="notes"
          onChangeKind={(k) => { void handleChangeKind(k) }}
          onClose={() => setKindAnchor(null)}
        />
      )}
    </div>
  )
}

export const FloatingNoteNode = memo(FloatingNoteNodeInner)
