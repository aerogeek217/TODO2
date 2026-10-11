import { Fragment } from 'react'
import styles from './EntityEditor.module.css'
import settingsStyles from './modal-chrome.module.css'

interface NlpSyntaxRow {
  syntax: string
  description: string
}

interface NlpSyntaxSection {
  label: string
  rows: NlpSyntaxRow[]
}

const SECTIONS: NlpSyntaxSection[] = [
  {
    label: 'People',
    rows: [
      { syntax: '@name', description: 'Assign person' },
      { syntax: '@"First Last"', description: 'Quoted form when the name has a space' },
    ],
  },
  {
    label: 'Tags & Statuses',
    rows: [
      { syntax: '#tag', description: 'Add a tag (lookup by name, or create on submit)' },
      { syntax: ':status', description: 'Set status (matched against your status registry)' },
    ],
  },
  {
    label: 'Due dates',
    rows: [
      { syntax: 'today / tomorrow / tmr', description: 'Sets the due date' },
      { syntax: 'this week / next week', description: 'Due on the last day of that week' },
      { syntax: 'this month / next month', description: 'Due on the last day of that month' },
      { syntax: 'monday … sunday', description: 'Next occurrence of that day' },
      { syntax: 'next monday', description: 'The Monday after the next one' },
      { syntax: 'in 3 days', description: 'N days from today' },
      { syntax: '5/4', description: 'MM/DD — year inferred forward (rolls to next year if past)' },
      { syntax: '5/4/27 or 5/4/2027', description: 'MM/DD/YY or MM/DD/YYYY — explicit year' },
    ],
  },
  {
    label: 'Explicit due dates',
    rows: [
      { syntax: 'due <date>', description: 'Set the due date (e.g. due friday, due 5/4); wins over a bare date' },
      { syntax: 'by <date>', description: 'Same as "due"' },
      { syntax: '!<date>', description: 'Shorthand for single-word dates and MM/DD (e.g. !tuesday, !5/4)' },
    ],
  },
  {
    label: 'Recurrence',
    rows: [
      { syntax: 'every day / week / month / quarter / year', description: 'Daily, weekly, monthly, quarterly, yearly' },
      { syntax: 'every 2 weeks', description: 'Biweekly' },
      { syntax: 'repeat daily / weekly / biweekly / monthly / quarterly / yearly', description: 'Same as "every" with explicit cadence words' },
    ],
  },
]

interface NlpSyntaxModalProps {
  onClose: () => void
}

export function NlpSyntaxModal({ onClose }: NlpSyntaxModalProps) {
  return (
    <>
      <div className={styles.backdrop} onClick={onClose} />
      <div className={styles.modal}>
        <div className={styles.header}>
          <div className={styles.title}>Quick-Add Syntax</div>
          <button className={styles.closeBtn} onClick={onClose}>&times;</button>
        </div>

        <div className={styles.list}>
          {SECTIONS.map((section) => (
            <div key={section.label}>
              <div className={settingsStyles.shortcutCategory}>{section.label}</div>
              <div className={settingsStyles.shortcutGrid}>
                {section.rows.map((row, idx) => (
                  <Fragment key={`${section.label}-${idx}`}>
                    <span className={settingsStyles.syntaxKey}>{row.syntax}</span>
                    <span className={settingsStyles.syntaxDesc}>{row.description}</span>
                  </Fragment>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
