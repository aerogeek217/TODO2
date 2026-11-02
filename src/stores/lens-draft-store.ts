import { create } from 'zustand'
import type { TodoPredicate } from '../models/filter-predicate'
import { findLens, lensPredicate, type Lens } from '../utils/lens'
import { predicatesEqual } from '../utils/list-def-equal'
import { registerModuleReset } from '../utils/module-reset'
import { useSettingsStore } from './settings-store'
import { SETTINGS_PART_SECTION, registerSettingsLeaveGuard, useUIStore } from './ui-store'
import { UndoRefused } from './undo-store'
import { undoable } from './undoable'

/** The open lens's filter as edited, not saved yet. */
export interface LensDraft {
  lensId: string
  predicate: TodoPredicate
}

interface LensDraftState {
  /**
   * The unsaved filter edits of the lens open in Settings › Tasks › Lenses —
   * one lens at a time (only one is open). Never equal to the saved filter.
   * The top bar and every widget keep the saved lens until Save. In memory
   * only: a reload drops it, and so does a data replace (`refresh-all`).
   */
  draft: LensDraft | null
  /** Holds `predicate` as lens `lensId`'s draft; the saved filter again (or a lens no one has) is no draft. */
  edit: (lensId: string, predicate: TodoPredicate) => void
  /** Drops the draft, no undo step (Discard, a deleted lens). */
  discard: () => void
  /** Revert: drops the draft; Undo in the snackbar brings it back (refused while another lens has one). */
  revert: () => void
  /**
   * Saves the draft as the lens's filter — one undo step, `setLensPredicate`
   * — and drops it; resolves whether it saved (no draft: true). A failed
   * save keeps the draft (the snackbar says why).
   */
  save: () => Promise<boolean>
}

/** Whether `predicate` filters as lens `lens` already does (as stored: completed off, "is not" normalised). */
function sameAsSaved(lens: Lens, predicate: TodoPredicate): boolean {
  return predicatesEqual(lensPredicate(lens.predicate), lensPredicate(predicate))
}

/** `draft`'s filter when it is lens `lens`'s and filters otherwise than its saved one; else null (what the editor shows as unsaved). */
export function lensDraftPredicate(lens: Lens, draft: LensDraft | null): TodoPredicate | null {
  return draft && draft.lensId === lens.id && !sameAsSaved(lens, draft.predicate) ? draft.predicate : null
}

/**
 * The draft with its lens, while it is one: `null` when there is none, its
 * lens is gone (deleted, undone, replaced) or it equals the saved filter now
 * (an undo changed the lens under it). What every leave guard asks about.
 */
export function liveLensDraft(): { lens: Lens; predicate: TodoPredicate } | null {
  const { draft } = useLensDraftStore.getState()
  const lens = draft ? findLens(useSettingsStore.getState().lenses, draft.lensId) : undefined
  const predicate = lens ? lensDraftPredicate(lens, draft) : null
  return lens && predicate ? { lens, predicate } : null
}

export const useLensDraftStore = create<LensDraftState>((set, get) => ({
  draft: null,

  edit(lensId, predicate) {
    const lens = findLens(useSettingsStore.getState().lenses, lensId)
    set({ draft: lens && !sameAsSaved(lens, predicate) ? { lensId, predicate } : null })
  },

  discard() {
    if (get().draft) set({ draft: null })
  },

  revert() {
    const { draft } = get()
    if (!draft) return
    set({ draft: null })
    undoable(
      'Lens changes reverted',
      () => {
        if (get().draft?.lensId === draft.lensId) set({ draft: null })
      },
      () => {
        const other = liveLensDraft()
        if (other && other.lens.id !== draft.lensId) throw new UndoRefused(`Save or revert the changes to “${other.lens.name}” first.`)
        if (!findLens(useSettingsStore.getState().lenses, draft.lensId)) throw new UndoRefused('That lens is gone.')
        get().edit(draft.lensId, draft.predicate)
      },
      true,
    )
  },

  async save() {
    const live = liveLensDraft()
    const { draft } = get()
    if (!live || !draft) {
      get().discard()
      return true
    }
    const ok = await useSettingsStore.getState().setLensPredicate(live.lens.id, live.predicate)
    // Edits made while it saved stay a draft.
    if (ok && get().draft === draft) set({ draft: null })
    return ok
  },
}))

/** The question on screen about the draft, while it is (`settleLensDraft`). */
let settling: Promise<boolean> | null = null
registerModuleReset(() => { settling = null })

/**
 * Before Settings leaves the open lens's unsaved filter edits — the lens
 * collapses, another opens, New lens, Duplicate, another section, a close —
 * asks Save / Discard / Keep editing (the shared confirm prompt, over the
 * modal; its Esc is Keep editing). Resolves whether to go on: at once (true)
 * without a draft; after Save (false when the save fails: the draft stays,
 * the snackbar says why) or Discard; Keep editing, false. Asked again while
 * on screen, it is the same question.
 */
export function settleLensDraft(): Promise<boolean> {
  if (settling) return settling
  const live = liveLensDraft()
  if (!live) {
    // A stale one (its lens gone, or the saved filter again): nothing to ask.
    useLensDraftStore.getState().discard()
    return Promise.resolve(true)
  }
  const asking = useUIStore.getState().askChoice({
    title: `Save changes to lens “${live.lens.name}”?`,
    message: 'Your changes to its filters will be lost if you don’t save. Until then the top bar shows the saved lens.',
    confirmLabel: 'Save lens',
    discardLabel: 'Discard',
    cancelLabel: 'Keep editing',
  }).then(async (answer) => {
    const drafts = useLensDraftStore.getState()
    if (answer === 'confirm') return drafts.save()
    if (answer === 'discard') drafts.discard()
    return answer === 'discard'
  }).finally(() => { settling = null })
  settling = asking
  return asking
}

registerSettingsLeaveGuard({
  section: SETTINGS_PART_SECTION.lenses,
  pending: () => liveLensDraft() != null,
  settle: settleLensDraft,
})
