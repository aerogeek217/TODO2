import { useCallback, useId, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router'
import { ROUTE_SETTINGS, type SettingsRouteState } from '../../routes'
import { DialogFrame } from '../shared/Dialog'
import { ChevronRightIcon, GearIcon } from '../shared/icons'
import { storagePillLabel, useStorageStatus, warningTone } from './sync-status'
import { SyncWarningIcon, SyncWarningSections } from './SyncWarningSections'
import { SyncWarningAnnouncer } from './SyncWarningAnnouncer'
import styles from './SyncStatusButton.module.css'

/** The frame centres its panel; a bottom sheet sits on the bottom edge, full width. */
const SHEET_PLACEMENT: CSSProperties = { margin: 'auto 0 0', width: '100%' }

/**
 * The phone's storage status, in its top bar: shown only while a sync or
 * backup warning is active — a capsule coloured as the desktop pill (amber /
 * red) with the most urgent warning's glyph and a count from two warnings.
 * Tap → a bottom sheet with the same sections as the pill's popover, then
 * File storage settings (the Settings page on Database).
 */
export function SyncStatusButton() {
  const { state, warnings } = useStorageStatus()
  const [open, setOpen] = useState(false)
  const titleId = useId()
  const navigate = useNavigate()
  const close = useCallback(() => setOpen(false), [])
  const first = warnings.at(0)
  if (!first) return <SyncWarningAnnouncer warnings={warnings} />
  const tone = warningTone(state.kind) === 'danger' ? styles.danger : styles.warning

  return (
    <>
      <button
        type="button"
        className={styles.button}
        aria-label={storagePillLabel(state)}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid="sync-status-button"
        data-state={state.kind}
        onClick={() => setOpen(true)}
      >
        <span className={`${styles.capsule} ${tone} ${open ? styles.open : ''}`}>
          <SyncWarningIcon kind={first.kind} size={16} />
          {state.warningCount > 1 && <span className={styles.count} aria-hidden="true">{state.warningCount}</span>}
        </span>
      </button>
      <SyncWarningAnnouncer warnings={warnings} />
      {open && (
        <DialogFrame
          onClose={close}
          layer="overlay"
          className={styles.sheet}
          backdropClassName={styles.backdrop}
          style={SHEET_PLACEMENT}
          aria-labelledby={titleId}
          data={{ testid: 'sync-status-sheet' }}
        >
          <span className={styles.handle} aria-hidden="true" />
          <SyncWarningSections warnings={warnings} variant="sheet" titleId={titleId} onClose={close} />
          <button
            type="button"
            className={styles.settingsRow}
            onClick={() => {
              close()
              const routeState: SettingsRouteState = { section: 'database' }
              void navigate(ROUTE_SETTINGS, { state: routeState })
            }}
          >
            <GearIcon size={16} />
            <span className={styles.settingsLabel}>File storage settings</span>
            <ChevronRightIcon size={14} />
          </button>
        </DialogFrame>
      )}
    </>
  )
}
