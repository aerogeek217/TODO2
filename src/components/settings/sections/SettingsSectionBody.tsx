import { useId } from 'react'
import { visibleParts, type SettingsPartDef, type SettingsSectionDef } from './settings-sections'
import styles from './sections.module.css'

/**
 * A Settings section's body: a one-part section's body as it is; a merged
 * section's parts (Tasks, Database) each under its own heading, in order —
 * on a phone only the parts the phone shows.
 */
export function SettingsSectionBody({ section, mobile }: { section: SettingsSectionDef; mobile: boolean }) {
  const parts = visibleParts(section, mobile)
  const only = section.parts.length === 1 ? parts[0] : undefined
  if (only) {
    const Body = only.Body
    return <Body />
  }
  return <>{parts.map((part) => <SettingsPart key={part.id} part={part} />)}</>
}

function SettingsPart({ part }: { part: SettingsPartDef }) {
  const headingId = useId()
  const Body = part.Body
  return (
    <section className={styles.part} aria-labelledby={headingId} data-settings-part={part.id}>
      <h3 id={headingId} className={styles.partTitle}>{part.label}</h3>
      <Body />
    </section>
  )
}
