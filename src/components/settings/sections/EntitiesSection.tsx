import { useState } from 'react'
import { usePersonStore } from '../../../stores/person-store'
import { useStatusStore } from '../../../stores/status-store'
import { useTagStore } from '../../../stores/tag-store'
import { PeopleEditor } from '../PeopleEditor'
import { StatusEditor } from '../StatusEditor'
import { TagEditor } from '../TagEditor'
import { UnusedEntitiesDialog } from '../UnusedEntitiesDialog'
import { SettingRow } from './SettingRow'
import { useStackedLayer } from './settings-layer'
import type { SettingsBodyProps } from './settings-sections'
import styles from './sections.module.css'

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/**
 * People, statuses, tags and Unused people &
 * tags: each opens its editor / dialog over the modal. The phone's Settings
 * page shows only the Unused people & tags row.
 */
export function EntitiesSection({ mobile }: SettingsBodyProps) {
  const peopleCount = usePersonStore((s) => s.people.length)
  const statusCount = useStatusStore((s) => s.statuses.length)
  const tagCount = useTagStore((s) => s.tags.length)
  const [editor, setEditor] = useState<'people' | 'statuses' | 'tags' | 'unused' | null>(null)
  useStackedLayer(editor !== null)

  const close = () => setEditor(null)
  const button = `${styles.button} ${styles.buttonSecondary}`

  return (
    <div className={styles.section}>
      {!mobile && (
        <>
          <SettingRow label="People" status={count(peopleCount, 'person', 'people')}>
            <button type="button" className={button} onClick={() => setEditor('people')}>Manage people…</button>
          </SettingRow>
          <SettingRow label="Statuses" status={count(statusCount, 'status', 'statuses')}>
            <button type="button" className={button} onClick={() => setEditor('statuses')}>Manage statuses…</button>
          </SettingRow>
          <SettingRow label="Tags" status={count(tagCount, 'tag', 'tags')}>
            <button type="button" className={button} onClick={() => setEditor('tags')}>Manage tags…</button>
          </SettingRow>
        </>
      )}
      <SettingRow label="Unused people & tags" help="People and tags no task has.">
        <button type="button" className={button} onClick={() => setEditor('unused')}>Find unused…</button>
      </SettingRow>

      {editor === 'people' && <PeopleEditor onClose={close} />}
      {editor === 'statuses' && <StatusEditor onClose={close} />}
      {editor === 'tags' && <TagEditor onClose={close} />}
      {editor === 'unused' && <UnusedEntitiesDialog onClose={close} />}
    </div>
  )
}
