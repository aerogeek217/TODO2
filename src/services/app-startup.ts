import { useSettingsStore } from '../stores/settings-store'
import { usePersonStore } from '../stores/person-store'
import { useStatusStore } from '../stores/status-store'
import { useTagStore } from '../stores/tag-store'
import { backupScheduler } from '../data/backup-scheduler'
import { useFileStorageStore } from './file-storage-store'
import { expiredCompletedUids } from './purge-completed'

export interface AppStartupResult {
  /** uids of the completed tasks past retention once the data is settled (the purge prompt's list), or null. */
  expiredUids: ReadonlySet<string> | null
}

export interface AppStartupOptions {
  /** Called just before the completed-task check reads the database. */
  onPurgeCheck?: () => void
}

/**
 * The launch sequence, in order:
 *
 * 1. settings (the theme, so every prompt has it);
 * 2. the sync file — its load decision, and when its handle needs
 *    permission the launch question: this waits for the user's answer, so
 *    nothing below reads, purges or backs up this browser's data before the
 *    user chose between the file and this browser;
 * 3. persistent storage, then people / statuses / tags;
 * 4. the completed tasks past retention (asked about, never purged
 *    silently — the caller shows the prompt);
 * 5. automatic backups.
 *
 * Rejects when a step fails (the database can't be opened).
 */
export async function runAppStartup({ onPurgeCheck }: AppStartupOptions = {}): Promise<AppStartupResult> {
  await useSettingsStore.getState().load()
  await useFileStorageStore.getState().initialize()
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
