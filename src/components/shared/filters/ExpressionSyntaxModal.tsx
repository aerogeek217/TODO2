import { Fragment, useId } from 'react'
import { DialogFrame } from '../Dialog'
import styles from './ExpressionSyntaxModal.module.css'

interface SyntaxRow {
  syntax: string
  meaning: string
}

interface SyntaxSection {
  label: string
  rows: SyntaxRow[]
}

/** The cheat sheet: text contains first, then what joins terms, then each kind of term. */
const SECTIONS: SyntaxSection[] = [
  {
    label: 'Text contains',
    rows: [
      { syntax: '"budget review"', meaning: 'Title, notes, status updates or subtasks contain it (any case)' },
      { syntax: 'budget review', meaning: 'Bare words side by side are one phrase; they are quoted for you' },
      { syntax: '"due friday"', meaning: 'Inside quotes nothing is a keyword' },
    ],
  },
  {
    label: 'Combine',
    rows: [
      { syntax: 'a and b', meaning: 'Both' },
      { syntax: 'a or b', meaning: 'Either' },
      { syntax: 'not a', meaning: 'The opposite' },
      { syntax: '( a or b ) and c', meaning: 'Parentheses group; not comes first, then and, then or' },
      { syntax: '… and done', meaning: 'Completed tasks too (at the top level only)' },
    ],
  },
  {
    label: 'Who, status, priority',
    rows: [
      { syntax: '@Aisha  @"Aisha Rahman"', meaning: 'Person — type @ to pick' },
      { syntax: '#q4  #"R&D"', meaning: 'Tag — type # to pick' },
      { syntax: '!Waiting  !"On Hold"', meaning: 'Status — type ! to pick' },
      { syntax: '/urgent  /important  /focus', meaning: 'Priority; /urgent includes tasks urgent by their due date' },
      { syntax: '@Aisha or @Ben', meaning: 'Either person (several of a kind: write them out)' },
    ],
  },
  {
    label: 'Is not, none, any',
    rows: [
      { syntax: 'not !Waiting', meaning: 'Status is not Waiting (no status passes)' },
      { syntax: 'not (@Aisha or @Ben)', meaning: 'Neither' },
      { syntax: 'no person  no tag  no status  no priority', meaning: 'Unassigned · No tags · No status · no marker' },
      { syntax: 'any person  any tag  any status  any priority', meaning: 'Has one' },
    ],
  },
  {
    label: 'Which date',
    rows: [
      { syntax: 'due  ·  due any  ·  no due', meaning: 'Due date' },
      { syntax: 'followup  ·  followup any  ·  no followup', meaning: 'Next follow-up' },
      { syntax: 'followed  ·  followed any  ·  never followed', meaning: 'Last follow-up' },
      { syntax: 'created  ·  modified  ·  completed', meaning: 'Every task has the first two; completed ranges bring completed tasks in' },
      { syntax: 'overdue  ·  followup late', meaning: 'Due / next follow-up before today' },
    ],
  },
  {
    label: 'When — after any date word',
    rows: [
      { syntax: 'due fri', meaning: 'One day: today, tomorrow, yesterday, fri, next fri, 11/30, 11/30/27' },
      { syntax: 'due +3d  ·  created -30d', meaning: 'Days from today: +3d in 3 days, -30d 30 days ago (+0d is today)' },
      { syntax: 'due this week', meaning: 'A period: this / next / last week or month' },
      { syntax: 'due <= fri  ·  due < fri', meaning: 'On or before the day; < stops the day before' },
      { syntax: 'followup >= +7d  ·  followup > +7d', meaning: 'On or after the day; > starts the day after' },
      { syntax: 'created <= -30d', meaning: 'Created 30 or more days ago' },
      { syntax: 'due < start of week', meaning: 'Compare with a week or month by its start or end (= this week is the period)' },
      { syntax: 'due -3d..+7d  ·  due 11/1..11/30', meaning: 'A range, both ends included' },
      { syntax: 'due within 3 days  ·  created within last 7 days', meaning: 'Counted from today, so the filter moves with it' },
      { syntax: 'not due this week', meaning: 'Outside it (no due date passes)' },
      { syntax: '(due this week or no due)', meaning: 'Also tasks without the date' },
      { syntax: 'due by fri  ·  due from mon', meaning: 'The older words still read: before <, by <=, after >, from >=; in 3 days, 3 days ago' },
    ],
  },
]

/** The filter expression cheat sheet (Edit list › Filter › Expression › Syntax…), over the dialog it opened from. */
export function ExpressionSyntaxModal({ onClose }: { onClose: () => void }) {
  const titleId = useId()
  return (
    <DialogFrame onClose={onClose} layer="nested" aria-labelledby={titleId} className={styles.modal}>
      <div className={styles.header}>
        <div id={titleId} className={styles.title}>Filter expressions</div>
        <button type="button" className={styles.close} aria-label="Close" onClick={onClose}>&times;</button>
      </div>
      <div className={styles.body}>
        <p className={styles.lead}><b>( )</b> group · <b>"quotes"</b> are text</p>
        {SECTIONS.map((section) => (
          <section key={section.label} aria-label={section.label}>
            <h3 className={styles.section}>{section.label}</h3>
            <div className={styles.grid}>
              {section.rows.map((row) => (
                <Fragment key={row.syntax}>
                  <code className={styles.syntax}>{row.syntax}</code>
                  <span className={styles.meaning}>{row.meaning}</span>
                </Fragment>
              ))}
            </div>
          </section>
        ))}
      </div>
    </DialogFrame>
  )
}
