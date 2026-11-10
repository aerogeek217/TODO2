import { useEffect, useState } from 'react'
import type { PersistedTodoItem } from '../../models'
import { useTodoStore } from '../../stores/todo-store'
import { useSettingsStore } from '../../stores/settings-store'
import { usePurgeNoticeStore } from '../../stores/purge-notice-store'
import { useFileStorageStore } from '../../services/file-storage-store'
import { closePurgeReview, listExpiredCompleted, recordPurgePromptShown } from '../../services/purge-completed'
import { PurgeCompletedDialog } from './PurgeCompletedDialog'

/**
 * The purge notice's reader and the purge dialog's host. The notice's tasks
 * (`usePurgeNoticeStore.uids`: those the check found past the retention
 * setting at launch, or after a later sync-file load) are read from the
 * database — not `useTodoStore.todos`, which may not be loaded (the phone's
 * Settings page) — and read again whenever the store reloads or the
 * retention changes; how many are still expired goes to the store, which the
 * storage pill and the phone's sync sheet show (none left: the notice hides).
 * Nothing is read while a sync-file prompt is open.
 *
 * Review… in the notice opens the dialog with those tasks; opening it stamps
 * the setting the interval counts from (`recordPurgePromptShown`), whatever
 * the answer. Closing it in any way (Not now included) settles the notice
 * until the next check finds tasks.
 */
export function PurgeNoticeHost() {
  const uids = usePurgeNoticeStore((s) => s.uids)
  const reviewing = usePurgeNoticeStore((s) => s.reviewing)
  const todosVersion = useTodoStore((s) => s.todosVersion)
  const retentionDays = useSettingsStore((s) => s.completedRetentionDays)
  const fileSyncPrompt = useFileStorageStore(
    (s) => s.pendingConflict != null || s.pendingFileUpgrade != null,
  )
  /** The last read, with the uids it was for: a read for an older set is not this set's count. */
  const [read, setRead] = useState<{ uids: ReadonlySet<string>; rows: PersistedTodoItem[] } | null>(null)
  const ready = uids != null && !fileSyncPrompt && retentionDays != null
  useEffect(() => {
    if (!uids || fileSyncPrompt || retentionDays == null) return
    let cancelled = false
    listExpiredCompleted(retentionDays, uids)
      .then((rows) => { if (!cancelled) setRead({ uids, rows }) })
      .catch((err) => console.warn('[purge] could not read expired tasks', err))
    return () => { cancelled = true }
  }, [uids, retentionDays, fileSyncPrompt, todosVersion])

  const tasks = ready && read?.uids === uids ? read.rows : null
  // Not ready: no notice. Ready but this set not read yet: the count stays as it was.
  const count = ready ? tasks?.length ?? null : 0
  useEffect(() => {
    if (count != null) usePurgeNoticeStore.getState().setCount(count)
  }, [count])

  const showing = reviewing && tasks != null && tasks.length > 0
  useEffect(() => {
    if (showing) void recordPurgePromptShown()
  }, [showing])
  if (!showing || tasks == null || retentionDays == null) return null
  return <PurgeCompletedDialog tasks={tasks} retentionDays={retentionDays} onDone={closePurgeReview} onDismiss={closePurgeReview} />
}
