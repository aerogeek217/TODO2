import { useEffect, useState } from 'react'
import { usePersonStore } from '../../../stores/person-store'
import { useStatusStore } from '../../../stores/status-store'
import { useTagStore } from '../../../stores/tag-store'
import { useListDefinitionStore } from '../../../stores/list-definition-store'
import { useUIStore } from '../../../stores/ui-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { CHECKIN_OPEN_METHOD_OPTIONS } from '../../../utils/checkin-settings'
import { PeopleEditor } from '../PeopleEditor'
import { StatusEditor } from '../StatusEditor'
import { TagEditor } from '../TagEditor'
import { SettingRow } from './SettingRow'
import { useStackedLayer } from './settings-layer'
import styles from './sections.module.css'

/** How a check-in email is handed to the mail app (also set from the check-in dialog). */
function CheckinOpenMethodSetting() {
  const method = useSettingsStore((s) => s.checkinOpenMethod)
  const setMethod = useSettingsStore((s) => s.setCheckinOpenMethod)
  return (
    <SettingRow label="Email check-ins open as" help="How each check-in email reaches your mail app." column>
      <div className={styles.radioGroup} role="radiogroup" aria-label="Email check-ins open as">
        {CHECKIN_OPEN_METHOD_OPTIONS.map((o) => (
          <label key={o.method} className={styles.radioOption}>
            <input
              type="radio"
              name="checkin-open-method"
              value={o.method}
              checked={method === o.method}
              onChange={() => void setMethod(o.method)}
            />
            <span className={styles.radioText}>
              {o.label}
              <span className={styles.help}>{o.help}</span>
            </span>
          </label>
        ))}
      </div>
    </SettingRow>
  )
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/**
 * People (+ how email check-ins open), statuses, tags and saved lists: each
 * opens its existing editor over the modal. The lists editor is owned by the workspace page
 * (`ui-store.listsEditorOpen`), which the modal sits over.
 */
export function EntitiesSection() {
  const peopleCount = usePersonStore((s) => s.people.length)
  const statusCount = useStatusStore((s) => s.statuses.length)
  const tagCount = useTagStore((s) => s.tags.length)
  const listCount = useListDefinitionStore((s) => s.listDefinitions.length)
  const loadLists = useListDefinitionStore((s) => s.load)
  const openListsEditor = useUIStore((s) => s.openListsEditor)
  const [editor, setEditor] = useState<'people' | 'statuses' | 'tags' | null>(null)
  useStackedLayer(editor !== null)

  useEffect(() => {
    void loadLists()
  }, [loadLists])

  const close = () => setEditor(null)
  const button = `${styles.button} ${styles.buttonSecondary}`

  return (
    <div className={styles.section}>
      <SettingRow label="People" help={count(peopleCount, 'person', 'people')}>
        <button type="button" className={button} onClick={() => setEditor('people')}>Manage people…</button>
      </SettingRow>
      <CheckinOpenMethodSetting />
      <SettingRow label="Statuses" help={count(statusCount, 'status', 'statuses')}>
        <button type="button" className={button} onClick={() => setEditor('statuses')}>Manage statuses…</button>
      </SettingRow>
      <SettingRow label="Tags" help={count(tagCount, 'tag', 'tags')}>
        <button type="button" className={button} onClick={() => setEditor('tags')}>Manage tags…</button>
      </SettingRow>
      <SettingRow label="Lists" help={count(listCount, 'saved list', 'saved lists')}>
        <button type="button" className={button} onClick={() => openListsEditor()}>Manage lists…</button>
      </SettingRow>

      {editor === 'people' && <PeopleEditor onClose={close} />}
      {editor === 'statuses' && <StatusEditor onClose={close} />}
      {editor === 'tags' && <TagEditor onClose={close} />}
    </div>
  )
}
