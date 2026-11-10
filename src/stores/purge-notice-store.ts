import { create } from 'zustand'

/**
 * The storage pill's notice about completed tasks past the retention
 * setting (`services/purge-completed` fills it; `PurgeNoticeHost` reads how
 * many are still expired; the pill and the phone's sync sheet show it).
 * Nothing here deletes anything: the notice only opens the purge dialog,
 * whose own buttons do (with the backup they take first).
 *
 * Session state only — never stored. A notice the user didn't answer is
 * found again at the next launch (the interval stamp is written only when
 * the dialog opens or Not now is pressed).
 */
interface PurgeNoticeState {
  /** The completed tasks past retention the check found (launch, a later sync-file load), not yet answered this session — null: no notice. uids survive a sync-file restore; ids don't. */
  uids: ReadonlySet<string> | null
  /** How many of `uids` are still expired, as `PurgeNoticeHost` last read them from the database — 0 while unread, while a sync-file prompt waits, or once none are left (the notice hides). */
  count: number
  /** The purge dialog is open (Review…). */
  reviewing: boolean
  /** uids answered this session (the dialog opened, or Not now): a later sync-file load doesn't offer them again. */
  answered: ReadonlySet<string>

  /** Adds the given uids to the notice, but not those already answered this session. */
  offer: (uids: Iterable<string>) => void
  /** The host's read of how many are still expired. None left also closes a review that has nothing to show. */
  setCount: (count: number) => void
  /** Review…: the dialog opens. */
  openReview: () => void
  /** The notice was answered (Not now, or the dialog closed in any way): its uids count as answered and the notice goes. */
  settle: () => void
}

export const usePurgeNoticeStore = create<PurgeNoticeState>((set, get) => ({
  uids: null,
  count: 0,
  reviewing: false,
  answered: new Set<string>(),

  offer: (uids) => {
    const { answered, uids: prev } = get()
    const fresh = [...uids].filter((uid) => !answered.has(uid) && !prev?.has(uid))
    if (fresh.length === 0) return
    set({ uids: new Set([...(prev ?? []), ...fresh]) })
  },

  setCount: (count) => {
    if (count === get().count && (count > 0 || !get().reviewing)) return
    set(count > 0 ? { count } : { count: 0, reviewing: false })
  },

  openReview: () => {
    if (get().uids && get().count > 0) set({ reviewing: true })
  },

  settle: () => {
    const { uids, answered } = get()
    set({
      uids: null,
      count: 0,
      reviewing: false,
      answered: uids ? new Set([...answered, ...uids]) : answered,
    })
  },
}))
