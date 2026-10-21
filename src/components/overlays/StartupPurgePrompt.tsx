import { useEffect, useState } from 'react'
import type { PersistedTodoItem } from '../../models'
import { useTodoStore } from '../../stores/todo-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useFileStorageStore } from '../../services/file-storage-store'
import { listExpiredCompleted, recordPurgePromptShown } from '../../services/purge-completed'
import { PurgeCompletedDialog } from './PurgeCompletedDialog'

/**
 * Prompt for completed tasks past the retention setting, at launch and
 * again after a later sync-file load (Grant access, Attach / Open file) —
 * at most once every N days (`expiredCompletedUids` decides whether to ask).
 * Lists the tasks that were expired when it was checked (`launchUids` —
 * uids survive a sync-file restore, ids don't) and are still expired now.
 * Read from the database, not `useTodoStore.todos` (which may not be loaded
 * yet), and re-read whenever the store reloads. Waits while a sync-file
 * prompt is open. Showing it stamps the setting the interval counts from
 * (`recordPurgePromptShown`), whatever the answer. Closing it in any way
 * ("Not now" included) skips those tasks until the next launch.
 */
export function StartupPurgePrompt({ launchUids, onClose }: { launchUids: ReadonlySet<string>; onClose: () => void }) {
  const todosVersion = useTodoStore((s) => s.todosVersion)
  const retentionDays = useSettingsStore((s) => s.completedRetentionDays)
  const fileSyncPrompt = useFileStorageStore(
    (s) => s.pendingLegacyImport != null || s.pendingConflict != null || s.pendingFileUpgrade != null,
  )
  const [tasks, setTasks] = useState<PersistedTodoItem[]>([])
  useEffect(() => {
    if (fileSyncPrompt || retentionDays == null) return
    let cancelled = false
    listExpiredCompleted(retentionDays, launchUids)
      .then((rows) => { if (!cancelled) setTasks(rows) })
      .catch((err) => console.warn('[purge] could not read expired tasks', err))
    return () => { cancelled = true }
  }, [launchUids, retentionDays, fileSyncPrompt, todosVersion])
  const showing = !fileSyncPrompt && retentionDays != null && tasks.length > 0
  useEffect(() => {
    if (showing) void recordPurgePromptShown()
  }, [showing])
  if (!showing || retentionDays == null) return null
  return <PurgeCompletedDialog tasks={tasks} retentionDays={retentionDays} onDone={onClose} onDismiss={onClose} />
}
