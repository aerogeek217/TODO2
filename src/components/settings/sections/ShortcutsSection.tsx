import { useState } from 'react'
import { NlpSyntaxModal } from '../NlpSyntaxModal'
import { ShortcutEditor } from '../ShortcutEditor'
import { ConfirmDialog } from '../../shared/Dialog'
import { useSettingsStore } from '../../../stores/settings-store'
import { SettingRow } from './SettingRow'
import { useStackedLayer } from './settings-layer'
import styles from './sections.module.css'

/** Every keyboard shortcut, editable (`?` still lists them in a modal), plus the quick-add syntax. */
export function ShortcutsSection() {
  const [showNlpSyntax, setShowNlpSyntax] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const anyChanged = useSettingsStore((s) => Object.keys(s.shortcutOverrides).length > 0)
  const resetAll = useSettingsStore((s) => s.resetAllShortcuts)
  useStackedLayer(showNlpSyntax || confirmReset)

  return (
    <div className={styles.section}>
      <SettingRow label="Quick-add syntax" help="People, tags and slash commands you can type into a new task.">
        <button type="button" className={`${styles.button} ${styles.buttonSecondary}`} onClick={() => setShowNlpSyntax(true)}>
          Show syntax…
        </button>
      </SettingRow>
      <SettingRow
        label="Shortcut keys"
        help="Change a shortcut's keys: press a key combination, or two keys one after the other (like G then S). Keys in use elsewhere are refused."
      >
        <button
          type="button"
          className={`${styles.button} ${styles.buttonSecondary}`}
          disabled={!anyChanged}
          onClick={() => setConfirmReset(true)}
        >
          Reset all…
        </button>
      </SettingRow>
      <div className={styles.shortcuts}>
        <ShortcutEditor />
      </div>
      {showNlpSyntax && <NlpSyntaxModal onClose={() => setShowNlpSyntax(false)} />}
      <ConfirmDialog
        open={confirmReset}
        title="Reset all shortcuts?"
        message="Every keyboard shortcut goes back to its default keys."
        confirmLabel="Reset all"
        onConfirm={() => {
          setConfirmReset(false)
          void resetAll()
        }}
        onCancel={() => setConfirmReset(false)}
      />
    </div>
  )
}
