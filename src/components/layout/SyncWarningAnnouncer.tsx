import { useEffect, useRef } from 'react'
import { syncWarningCopy, type SyncWarning } from './sync-status'
import styles from './StoragePill.module.css'

/**
 * A visually hidden polite live region beside the pill (or the phone's
 * status button) that announces a newly appearing warning once —
 * `<Title>: <why>`. Warnings already showing when it mounts aren't announced.
 */
export function SyncWarningAnnouncer({ warnings }: { warnings: readonly SyncWarning[] }) {
  const regionRef = useRef<HTMLSpanElement>(null)
  const shownRef = useRef<ReadonlySet<string> | null>(null)

  useEffect(() => {
    const kinds = new Set(warnings.map((w) => w.kind))
    const shown = shownRef.current
    shownRef.current = kinds
    if (!shown || !regionRef.current) return
    const fresh = warnings.find((w) => !shown.has(w.kind))
    if (!fresh) return
    const copy = syncWarningCopy(fresh)
    regionRef.current.textContent = `${copy.title}: ${copy.why}`
  }, [warnings])

  return <span ref={regionRef} className={styles.visuallyHidden} aria-live="polite" data-testid="sync-announcer" />
}
