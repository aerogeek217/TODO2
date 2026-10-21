import { Fragment } from 'react'
import styles from './EntityEditor.module.css'
import { EditorModal } from './EditorModal'
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
    label: 'People & tags',
    rows: [
      { syntax: '@name', description: 'Assign a person: the highlighted match (pick Create to add someone new; created with the task if nobody matches)' },
      { syntax: '@"First Last"', description: 'Quoted form when the name has a space' },
      { syntax: '#tag', description: 'Add a tag: the highlighted match (pick Create to add a new one; created with the task if none matches)' },
      { syntax: '#"R&D"', description: 'Quoted form for a tag name with a space or other characters' },
    ],
  },
  {
    label: 'Commands — type / for the menu',
    rows: [
      { syntax: '/focus', description: 'Priority: add to Focus' },
      { syntax: '/urgent', description: 'Priority: mark urgent' },
      { syntax: '/important', description: 'Priority: mark important' },
      { syntax: '/due <date>', description: 'Set the due date' },
      { syntax: '/followup <date | interval | none>', description: 'Set the next follow-up (instead of the default); none = no follow-up' },
      { syntax: '/repeat <frequency>', description: 'Repeat from the due date: daily, weekly, biweekly, monthly, quarterly, yearly' },
      { syntax: '/status <name>', description: 'Set the status; quote a name with a space: /status "In progress"' },
    ],
  },
  {
    label: 'Dates (after /due or /followup)',
    rows: [
      { syntax: 'today / tomorrow / tmr', description: 'That day' },
      { syntax: 'mon … sun, next fri', description: 'The next one of that day (never today)' },
      { syntax: 'in 3 days', description: 'N days from today' },
      { syntax: '3d / 2w / 1m / 1y', description: 'Days, weeks, months or years from today' },
      { syntax: '5/4, 5/4/27', description: 'MM/DD — the year rolls forward when the date has passed' },
      { syntax: '24 Oct, 2026-10-24', description: 'Day and month, or ISO' },
    ],
  },
  {
    label: 'Everything else is the title',
    rows: [
      { syntax: 'tomorrow, by fri, every week', description: 'Plain words are never read as dates or repeats — use /due, /repeat' },
      { syntax: 'a/b, 1/2, /etc/hosts', description: 'A / inside a word or path is not a command' },
    ],
  },
]

interface NlpSyntaxModalProps {
  onClose: () => void
}

export function NlpSyntaxModal({ onClose }: NlpSyntaxModalProps) {
  return (
    <EditorModal title="Quick-Add Syntax" onClose={onClose}>
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
    </EditorModal>
  )
}
