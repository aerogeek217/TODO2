import { useState } from 'react'
import { NlpSyntaxModal } from '../NlpSyntaxModal'
import { ShortcutList } from '../ShortcutList'
import { SettingRow } from './SettingRow'
import { useStackedLayer } from './settings-layer'
import styles from './sections.module.css'

/** Every keyboard shortcut inline (`?` still opens them as a modal), plus the quick-add syntax. */
export function ShortcutsSection() {
  const [showNlpSyntax, setShowNlpSyntax] = useState(false)
  useStackedLayer(showNlpSyntax)

  return (
    <div className={styles.section}>
      <SettingRow label="Quick-add syntax" help="People, tags and other details you can type into a new task.">
        <button type="button" className={`${styles.button} ${styles.buttonSecondary}`} onClick={() => setShowNlpSyntax(true)}>
          Show syntax…
        </button>
      </SettingRow>
      <div className={styles.shortcuts}>
        <ShortcutList />
      </div>
      {showNlpSyntax && <NlpSyntaxModal onClose={() => setShowNlpSyntax(false)} />}
    </div>
  )
}
