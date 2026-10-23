import { useSettingsStore } from '../stores/settings-store'
import { usePersonStore } from '../stores/person-store'
import { useStatusStore } from '../stores/status-store'
import { useTagStore } from '../stores/tag-store'
import { useListDefinitionStore } from '../stores/list-definition-store'
import { backupScheduler } from '../data/backup-scheduler'
import { db, findDatabaseTooNew, findDatabaseTooOld } from '../data/database'
import { useFileStorageStore } from './file-storage-store'
import { expiredCompletedUids } from './purge-completed'

export interface AppStartupResult {
  /** uids of the completed tasks past retention once the data is settled (the purge prompt's list), or null (none, or not asked again yet). */
  expiredUids: ReadonlySet<string> | null
}

export interface AppStartupOptions {
  /** Called just before the completed-task check reads the database. */
  onPurgeCheck?: () => void
}

/**
 * The launch sequence, in order:
 *
 * 0. the database opens — one a newer build saved or one below the floor
 *    stops launch here (`DatabaseTooNewError` / `DatabaseTooOldError`; the
 *    version check before launch says so already — this is its backstop,
 *    for when the check couldn't read the version); other open
 *    failures surface in the steps below, as they always have;
 * 1. settings (the theme, so every prompt has it);
 * 2. the sync file — its load decision, and when its handle needs
 *    permission the launch question: this waits for the user's answer, so
 *    nothing below reads, purges or backs up this browser's data before the
 *    user chose between the file and this browser;
 * 3. persistent storage, then people / statuses / tags, and the
 *    Eisenhower's own list (made when the data has none);
 * 4. the completed tasks past retention (asked about, never purged
 *    silently — the caller shows the prompt; none while it showed within
 *    its interval);
 * 5. automatic backups.
 *
 * Rejects when a step fails (the database can't be opened).
 */
export async function runAppStartup({ onPurgeCheck }: AppStartupOptions = {}): Promise<AppStartupResult> {
  await db.open().catch((err: unknown) => {
    if (findDatabaseTooNew(err) || findDatabaseTooOld(err)) throw err
  })
  await useSettingsStore.getState().load()
  await useFileStorageStore.getState().initialize()
  await navigator.storage?.persist?.().catch(() => false)
  await Promise.all([
    usePersonStore.getState().ensureLoaded(),
    useStatusStore.getState().ensureLoaded(),
    useTagStore.getState().ensureLoaded(),
    // A failure leaves the Eisenhower on what the setting names now: every
    // task when it names nothing (what a new, empty list would hold).
    useListDefinitionStore.getState().ensureEisenhowerList().catch((err: unknown) => {
      console.warn('[startup] the Eisenhower list could not be made', err)
    }),
  ])
  onPurgeCheck?.()
  const expiredUids = await expiredCompletedUids()
  backupScheduler.start()
  return { expiredUids }
}
