import type { TooNewDBInfo } from '../../services/migration-check'
import { tooNewDatabaseMessage, tooOldDatabaseMessage } from '../../data/database'
import { Dialog, DialogActions, DialogBody } from '../shared/Dialog'
import styles from './DatabaseVersionDialog.module.css'

/**
 * The browser's database was saved by a newer version of TODO2: this one
 * reads and writes none of it — the only way on is the newer version
 * (Reload). Nothing to close.
 */
export function DatabaseTooNewDialog({ info }: { info: TooNewDBInfo }) {
  return (
    <Dialog open onClose={() => {}} blockBackdropClose size="md" title="Data from a newer version of TODO2">
      <DialogBody>
        {tooNewDatabaseMessage(info.storedVersion, info.buildVersion)} If the newer version is open in another tab, use that one.
      </DialogBody>
      <DialogActions>
        <button className={styles.primaryButton} onClick={() => window.location.reload()}>
          Reload
        </button>
      </DialogActions>
    </Dialog>
  )
}

/**
 * The browser's database is below the floor (`storedVersion` `null` when
 * only its open told): this version reads and writes none of it, and there
 * is no going on anyway — the message names the build that still upgrades
 * it. Reload only, nothing to close.
 */
export function DatabaseTooOldDialog({ info }: { info: { storedVersion: number | null; floorVersion?: number } }) {
  return (
    <Dialog open onClose={() => {}} blockBackdropClose size="md" title="Data from an older version of TODO2">
      <DialogBody>{tooOldDatabaseMessage(info.storedVersion, info.floorVersion)}</DialogBody>
      <DialogActions>
        <button className={styles.primaryButton} onClick={() => window.location.reload()}>
          Reload
        </button>
      </DialogActions>
    </Dialog>
  )
}
