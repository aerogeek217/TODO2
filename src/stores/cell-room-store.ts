import { create } from 'zustand'

/**
 * The least heights (px) widgets measure for their own cell, by cell id: a
 * lone List board's wrapped lines of tiles (`ShortcutsWidget`). The table
 * holds a row at least that tall (`workspace-table.trackTemplate`'s
 * `measured`) and a divider's drag stops there (`divider-drag.minPxIn`).
 * Never stored: measured again on every mount.
 */
interface CellRoomState {
  minHeights: Readonly<Record<string, number>>
  /** Sets a cell's measured least height; `null` lets it go (the widget unmounted or no longer measures). */
  setCellMinHeight: (cellId: string, px: number | null) => void
}

export const useCellRoomStore = create<CellRoomState>((set) => ({
  minHeights: {},
  setCellMinHeight: (cellId, px) => set((s) => {
    if (px == null) {
      if (!(cellId in s.minHeights)) return s
      const next = { ...s.minHeights }
      delete next[cellId]
      return { minHeights: next }
    }
    return s.minHeights[cellId] === px ? s : { minHeights: { ...s.minHeights, [cellId]: px } }
  }),
}))
