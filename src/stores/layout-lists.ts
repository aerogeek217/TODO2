import { layoutRepository, type ListCopy, type OwnedListsRemoved } from '../data/layout-repository'
import { ownerLayoutId } from '../models/list-definition'
import type { LayoutBody } from '../models/workspace-layout'
import { layoutListRefs } from '../utils/workspace-layout-lists'
import { useListDefinitionStore } from './list-definition-store'
import { useListOrderStore } from './list-order-store'
import { trackWrite } from './store-helpers'
import { UndoGone } from './undo-store'

/**
 * The lists that follow a layout edit (`workspace-store`): every list
 * belongs to one layout, so an edit that shows another layout's list is
 * refused, the lists an edit stops showing are deleted with it (and come
 * back with its undo), and Duplicate layout copies the ones it shows.
 */

/**
 * The lists `next` names that `before` didn't and that belong elsewhere —
 * another layout, or no layout. A layout shows only its own
 * lists, so an edit that would show one of these is refused. A list that
 * doesn't exist (any more) isn't anyone's: a tab on it shows it as deleted.
 */
export function foreignListRefs(before: LayoutBody, next: LayoutBody, layoutId: number): number[] {
  const had = layoutListRefs(before)
  const added = [...layoutListRefs(next)].filter((id) => !had.has(id))
  if (added.length === 0) return []
  const defs = useListDefinitionStore.getState().listDefinitions
  return added.filter((id) => {
    const def = defs.find((d) => d.id === id)
    return def != null && ownerLayoutId(def) !== layoutId
  })
}

/**
 * Takes a removal of a layout's lists into the stores: the deleted ones
 * forgotten (an Edit list open on one closes, dropping its draft), the ones
 * handed to another layout read again (their owner changed).
 */
export async function applyRemoved({ deleted, handedOver }: OwnedListsRemoved): Promise<void> {
  useListDefinitionStore.getState().forgetLists(deleted)
  if (handedOver.length > 0) await useListDefinitionStore.getState().load()
}

/**
 * Deletes the lists layout `layoutId` owns that none of `bodies` shows,
 * nor its stored row (`layoutRepository.pruneOwnedLists`) — at launch, the
 * lists an interrupted edit left behind. A failed delete only leaves them
 * in place (hidden, unshown) until the layout's next edit.
 */
export async function pruneOwnedLists(layoutId: number, ...bodies: LayoutBody[]): Promise<void> {
  const shown = new Set(bodies.flatMap((b) => [...layoutListRefs(b)]))
  try {
    await applyRemoved(await trackWrite(() => layoutRepository.pruneOwnedLists(layoutId, shown)))
  } catch (err) {
    console.warn('[workspace] removing the layout\'s unshown lists failed', err)
  }
}

/**
 * Brings back lists a committed edit removed (with their manual order) and
 * reads the list stores again. Rejects when the write fails (the undo store
 * keeps the step); `UndoGone` when their layout is gone.
 */
export async function restoreLists(removed: OwnedListsRemoved | null): Promise<void> {
  if (!removed || removed.rows.defs.length === 0) return
  const back = await trackWrite(() => layoutRepository.restoreLists(removed.rows))
  if (!back) throw new UndoGone('The lists can’t come back: their layout is gone.')
  await Promise.all([useListDefinitionStore.getState().load(), useListOrderStore.getState().load()])
}

/** The lists of layout `layoutId` that `body` shows, as copies for a new layout (each as saved). */
export function ownedListCopies(layoutId: number, body: LayoutBody): ListCopy[] {
  const shown = layoutListRefs(body)
  const copies: ListCopy[] = []
  for (const saved of useListDefinitionStore.getState().listDefinitions) {
    if (!shown.has(saved.id) || ownerLayoutId(saved) !== layoutId) continue
    const { id: _id, sortOrder: _order, owner: _owner, ...def } = saved
    void _id
    void _order
    void _owner
    copies.push({ from: saved.id, def })
  }
  return copies
}
