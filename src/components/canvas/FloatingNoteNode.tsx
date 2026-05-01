import { memo } from 'react'
import { type NodeProps } from '@xyflow/react'
import type { FloatingNote } from '../../models'
import { NotesBody } from '../shared/notes/NotesBody'
import { SimpleFloatingWidget } from './SimpleFloatingWidget'

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
  return (
    <SimpleFloatingWidget
      kind="notes"
      title="Notes · Inbox"
      minW={160}
      minH={120}
      id={note.id}
      rect={{ x: note.x, y: note.y, width: note.width, height: note.height }}
      onDelete={onDelete}
      onResize={onResize}
      body={<NotesBody dock="floating" showToolbar />}
    />
  )
}

export const FloatingNoteNode = memo(FloatingNoteNodeInner)
