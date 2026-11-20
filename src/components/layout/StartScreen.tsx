import { useEffect, useId, useState } from 'react'
import { useFileStorageStore } from '../../services/file-storage-store'
import { useUIStore } from '../../stores/ui-store'
import type { LaunchStep } from '../../services/app-startup'
import { ConfirmDialog } from '../shared/Dialog'
import { START_SCREEN_EXPLAIN_MS, startScreenCopy } from './start-screen'
import styles from './StartScreen.module.css'

/**
 * Whether the part of launch under way has taken long
 * (`START_SCREEN_EXPLAIN_MS`). Each stretch of waiting — a step, or what is
 * left of one after a question was answered — is timed from its start; while
 * a question is up (`held`) nothing is slow: launch waits for the user.
 */
function useSlowStep(step: LaunchStep, held: boolean): boolean {
  const waitingOn = held ? null : step
  const [stretch, setStretch] = useState({ of: waitingOn, n: 0 })
  if (stretch.of !== waitingOn) setStretch({ of: waitingOn, n: stretch.n + 1 })
  const [slowStretch, setSlowStretch] = useState(-1)
  const n = stretch.n
  useEffect(() => {
    if (waitingOn == null) return
    const timer = setTimeout(() => setSlowStretch(n), START_SCREEN_EXPLAIN_MS)
    return () => clearTimeout(timer)
  }, [waitingOn, n])
  return waitingOn != null && stretch.of === waitingOn && slowStretch === n
}

/**
 * The start screen: what shows until launch is done (`App`'s version check
 * and `runAppStartup`, whose part under way is `step`). A spinner and
 * `Loading…` at first. Once one part has taken long
 * (`START_SCREEN_EXPLAIN_MS`) it says which — opening the database, checking
 * the sync file, loading tasks — and offers the ways out that are safe
 * there (`startScreenCopy`): **Reload** always; at the sync file's step,
 * while launch waits for the browser to hand the file over
 * (`launchWait`), also **Continue without the file** (this browser's data,
 * sync paused, nothing written to the file, the stored link kept) and
 * **Forget the sync file…** (after a confirm: the stored link is cleared,
 * the tasks and the file itself untouched). Nothing here deletes or changes
 * a task. Blank while the launch question is up (it shows over this); the
 * spinner alone while another question waits (a sync conflict, an older
 * file's upgrade, a confirm prompt).
 */
export function StartScreen({ step }: { step: LaunchStep }) {
  const launchQuestion = useFileStorageStore((s) => s.pendingLaunchPermission != null)
  const fileQuestion = useFileStorageStore((s) => s.pendingConflict != null || s.pendingFileUpgrade != null)
  const confirmQuestion = useUIStore((s) => s.confirmPrompts.length > 0)
  const waitingOnBrowser = useFileStorageStore((s) => s.launchWait != null)
  const skip = useFileStorageStore((s) => s.skipLaunchFile)
  const forget = useFileStorageStore((s) => s.forgetLaunchFile)
  const [confirmingForget, setConfirmingForget] = useState(false)
  const titleId = useId()
  const slow = useSlowStep(step, launchQuestion || fileQuestion || confirmQuestion)

  if (launchQuestion) return <div className={styles.screen} data-testid="start-screen" />
  if (!slow) {
    return (
      <div className={styles.screen} data-testid="start-screen">
        <div className={styles.spinner} />
        Loading…
      </div>
    )
  }

  const copy = startScreenCopy(step, step === 'sync-file' && waitingOnBrowser)
  const offers = (action: (typeof copy.actions)[number]) => copy.actions.includes(action)
  return (
    <div className={styles.screen} data-testid="start-screen" data-slow-step={step}>
      <section className={styles.card} aria-labelledby={titleId}>
        <div role="status">
          <h2 id={titleId} className={styles.title}>
            <span className={styles.spinner} aria-hidden="true" />
            {copy.title}
          </h2>
          <p className={styles.body}>{copy.body}</p>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.secondary} onClick={() => window.location.reload()}>
            Reload
          </button>
          {offers('forget-file') && (
            <button type="button" className={styles.secondary} onClick={() => setConfirmingForget(true)}>
              Forget the sync file…
            </button>
          )}
          {offers('continue-without-file') && (
            <button type="button" className={styles.primary} onClick={skip}>
              Continue without the file
            </button>
          )}
        </div>
      </section>
      <ConfirmDialog
        // Only while it can still be done: once the browser answered, the file is being loaded.
        open={confirmingForget && offers('forget-file')}
        title="Forget the sync file?"
        message="TODO2 stops syncing with the file and opens the data in this browser. Your tasks and the file itself stay as they are. You can attach the file again in Settings › Database › File storage."
        confirmLabel="Forget the sync file"
        initialFocus="cancel"
        onConfirm={() => { setConfirmingForget(false); forget() }}
        onCancel={() => setConfirmingForget(false)}
      />
    </div>
  )
}
