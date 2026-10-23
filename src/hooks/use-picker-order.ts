import { useState } from 'react'

/** Which rows were selected (and which existed) when the order was last fixed. */
interface Snapshot {
  text: string
  selected: ReadonlySet<number>
  known: ReadonlySet<number>
}

/** A pick made together with a search-text change: the entry's state after it. */
interface PendingPick {
  id: number
  selected: boolean
}

function takeSnapshot(
  text: string,
  ids: readonly number[],
  isSelected: (id: number) => boolean,
  pick: PendingPick | null,
): Snapshot {
  const selected = new Set<number>()
  for (const id of ids) {
    const on = pick?.id === id ? pick.selected : isSelected(id)
    if (on) selected.add(id)
  }
  return { text, selected, known: new Set(ids) }
}

export interface PickerOrder {
  /** Whether row `id` sits in the selected block at the top. */
  onTop: (id: number) => boolean
  /**
   * A pick that also changes the search text (the search clears after a
   * pick): the order taken for the new text has `id` as `selected`, whatever
   * the stores say on that render (a row's assignment may land later).
   */
  notePick: (id: number, selected: boolean) => void
}

/**
 * Selected-on-top order for a checklist picker (the people / tag pickers and
 * the filter checklists): the rows selected **when the order was fixed** come
 * first, the rest after. The order is fixed when the picker opens and again
 * whenever its search text changes — a tick with unchanged text never moves a
 * row under the pointer. `ids` are every row the picker can show (filtered or
 * not); a row that wasn't there when the order was fixed (one just created)
 * goes by its current state.
 */
export function usePickerOrder(
  searchText: string,
  ids: readonly number[],
  isSelected: (id: number) => boolean,
): PickerOrder {
  const [snapshot, setSnapshot] = useState(() => takeSnapshot(searchText, ids, isSelected, null))
  const [pick, setPick] = useState<PendingPick | null>(null)
  let current = snapshot
  if (snapshot.text !== searchText) {
    // The text changed: fix the order again (state adjusted while rendering,
    // so the new order shows on the same render as the new text).
    current = takeSnapshot(searchText, ids, isSelected, pick)
    setSnapshot(current)
    if (pick) setPick(null)
  }
  return {
    onTop: (id) => (current.known.has(id) ? current.selected.has(id) : isSelected(id)),
    notePick: (id, selected) => setPick({ id, selected }),
  }
}

/** `items` split into the selected block and the rest, each keeping its order. */
export function splitOnTop<T>(items: readonly T[], onTop: (item: T) => boolean): { top: T[]; rest: T[] } {
  const top: T[] = []
  const rest: T[] = []
  for (const item of items) (onTop(item) ? top : rest).push(item)
  return { top, rest }
}
