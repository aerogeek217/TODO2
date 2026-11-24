import { useSettingsStore } from '../stores/settings-store'
import { usePersonStore } from '../stores/person-store'
import { useStatusStore } from '../stores/status-store'
import { useTagStore } from '../stores/tag-store'
import { backupScheduler } from '../data/backup-scheduler'
import { db, findDatabaseTooNew, findDatabaseTooOld } from '../data/database'
import { useFileStorageStore } from './file-storage-store'
import { expiredCompletedUids } from './purge-completed'

interface AppStartupResult {
  /** uids of the completed tasks past retention once the data is settled (the purge prompt's list), or null (none, or not asked again yet). */
  expiredUids: ReadonlySet<string> | null
}

/**
 * The parts of launch the start screen names when one takes long
 * (`StartScreen`): the database opening (the version check before launch is
 * part of it), the sync file's step, then everything read after it.
 */
export type LaunchStep = 'database' | 'sync-file' | 'tasks'

interface AppStartupOptions {
  /** Called just before the completed-task check reads the database. */
  onPurgeCheck?: () => void
  /** Called as each part of launch begins (`database` first). */
  onStep?: (step: LaunchStep) => void
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
 *    user chose between the file and this browser; then, on the data that
 *    won, the history log's start is stamped once (`historyLogSince`),
 *    and the plan log's (`planLogSince`);
 * 3. persistent storage, then people / statuses / tags;
 * 4. the completed tasks past retention (asked about, never purged
 *    silently — the caller shows the prompt; none while it showed within
 *    its interval);
 * 5. automatic backups.
 *
 * Nothing here limits how long a step may take but the sync file's two
 * checks before its question (`fileStorageService.initialize`); `onStep`
 * tells the start screen which part is under way, so it can say so and
 * offer that part's ways out.
 *
 * Rejects when a step fails (the database can't be opened).
 */
export async function runAppStartup({ onPurgeCheck, onStep }: AppStartupOptions = {}): Promise<AppStartupResult> {
  onStep?.('database')
  await db.open().catch((err: unknown) => {
    if (findDatabaseTooNew(err) || findDatabaseTooOld(err)) throw err
  })
  await useSettingsStore.getState().load()
  onStep?.('sync-file')
  await useFileStorageStore.getState().initialize()
  onStep?.('tasks')
  await useSettingsStore.getState().stampHistoryLogSince()
  await useSettingsStore.getState().stampPlanLogSince()
  await navigator.storage?.persist?.().catch(() => false)
  await Promise.all([
    usePersonStore.getState().ensureLoaded(),
    useStatusStore.getState().ensureLoaded(),
    useTagStore.getState().ensureLoaded(),
  ])
  onPurgeCheck?.()
  const expiredUids = await expiredCompletedUids()
  backupScheduler.start()
  return { expiredUids }
}
