import { useId } from 'react'
import { HelpTip } from '../../shared/HelpTip'
import { SettingsMobileContext } from './settings-layer'
import { visibleParts, type SettingsPartDef, type SettingsSectionDef } from './settings-sections'
import styles from './sections.module.css'

/**
 * A Settings section's body: a one-part section's body as it is; a merged
 * section's parts (Tasks, Database) each under its own heading (with an ⓘ
 * for a part's `help`), in order — on a phone only the parts the phone
 * shows. Every body is told `mobile`, and its rows learn it from
 * `SettingsMobileContext` (a phone shows descriptions inline).
 */
export function SettingsSectionBody({ section, mobile }: { section: SettingsSectionDef; mobile: boolean }) {
  const parts = visibleParts(section, mobile)
  const only = section.parts.length === 1 ? parts[0] : undefined
  let body
  if (only) {
    const Body = only.Body
    body = <Body mobile={mobile} />
  } else {
    body = parts.map((part) => <SettingsPart key={part.id} part={part} mobile={mobile} />)
  }
  return <SettingsMobileContext.Provider value={mobile}>{body}</SettingsMobileContext.Provider>
}

function SettingsPart({ part, mobile }: { part: SettingsPartDef; mobile: boolean }) {
  const headingId = useId()
  const Body = part.Body
  return (
    <section className={styles.part} aria-labelledby={headingId} data-settings-part={part.id}>
      <div className={styles.partHead}>
        <h3 id={headingId} className={styles.partTitle}>{part.label}</h3>
        {part.help && !mobile && <HelpTip label={part.label} text={part.help} />}
      </div>
      {part.help && mobile && <p className={styles.partHelp}>{part.help}</p>}
      <Body mobile={mobile} />
    </section>
  )
}
