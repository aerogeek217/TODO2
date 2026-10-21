import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { NEUTRAL_PERSON_COLOR } from '../../../constants'
import { useUnusedEntities } from '../../../hooks/use-unused-entities'
import type { Person, Tag } from '../../../models'
import { removePeopleAndTags } from '../../../services/remove-entities'
import { removeConfirmLines, unusedEntryNote, type UnusedEntry } from '../../../utils/unused-entities'
import { ConfirmDialog } from '../../shared/Dialog'
import { useStackedLayer } from './settings-layer'
import sectionStyles from './sections.module.css'
import styles from './UnusedEntitiesSection.module.css'

type Ticks = ReadonlySet<number>
const NONE: Ticks = new Set()

function toggled(set: Ticks, id: number): Ticks {
  const next = new Set(set)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

/**
 * Settings › People, statuses & tags › Unused people & tags: the people and
 * tags no task carries (Ignore completed tasks — not stored, off each time —
 * also lists those only completed tasks carry), each with a note when
 * completed tasks or filters still have it. Every row starts unticked;
 * Select all ticks a group; Remove N… asks first (Cancel focused), then
 * removes the ticked ones with their assignments as one undo step. Desktop
 * and the phone.
 */
export function UnusedEntitiesSection() {
  const ignoreId = useId()
  const [ignoreCompleted, setIgnoreCompleted] = useState(false)
  const { ready, people, tags } = useUnusedEntities(ignoreCompleted)
  const [tickedPeople, setTickedPeople] = useState<Ticks>(NONE)
  const [tickedTags, setTickedTags] = useState<Ticks>(NONE)
  const [confirming, setConfirming] = useState(false)
  useStackedLayer(confirming)

  // Only rows still listed count (Ignore completed turned off, a removal, a task assigned meanwhile).
  const peopleToRemove = people.filter((e) => tickedPeople.has(e.id))
  const tagsToRemove = tags.filter((e) => tickedTags.has(e.id))
  const total = peopleToRemove.length + tagsToRemove.length
  const lines = removeConfirmLines(peopleToRemove, tagsToRemove)

  const remove = async () => {
    setConfirming(false)
    const removed = await removePeopleAndTags(peopleToRemove.map((e) => e.id), tagsToRemove.map((e) => e.id))
    if (removed) {
      setTickedPeople(NONE)
      setTickedTags(NONE)
    }
  }

  return (
    <div className={sectionStyles.section} data-testid="unused-entities">
      <p className={sectionStyles.help}>
        People and tags no task has. Tick the ones to remove.
      </p>
      <div className={styles.checkLine}>
        <input
          id={ignoreId}
          type="checkbox"
          checked={ignoreCompleted}
          aria-describedby={`${ignoreId}-help`}
          onChange={(e) => setIgnoreCompleted(e.target.checked)}
        />
        <span className={styles.checkText}>
          <label htmlFor={ignoreId}>Ignore completed tasks</label>
          <span id={`${ignoreId}-help`} className={sectionStyles.help}>Also list people and tags that only completed tasks have.</span>
        </span>
      </div>
      {!ready ? (
        <p className={sectionStyles.muted}>Looking for unused people and tags…</p>
      ) : (
        <>
          <UnusedGroup<Person>
            title="People"
            noun="people"
            empty="No unused people"
            entries={people}
            ticked={tickedPeople}
            onTicked={setTickedPeople}
            swatch={(p) => (
              <span className={styles.avatar} style={{ background: p.color || NEUTRAL_PERSON_COLOR }} aria-hidden="true">
                {p.initials || p.name.slice(0, 2).toUpperCase()}
              </span>
            )}
          />
          <UnusedGroup<Tag>
            title="Tags"
            noun="tags"
            empty="No unused tags"
            entries={tags}
            ticked={tickedTags}
            onTicked={setTickedTags}
            swatch={(t) => <span className={styles.tagSwatch} style={{ background: t.color }} aria-hidden="true" />}
          />
        </>
      )}
      <div>
        <button
          type="button"
          className={`${sectionStyles.button} ${sectionStyles.buttonDanger}`}
          disabled={total === 0}
          onClick={() => setConfirming(true)}
        >
          {`Remove ${total}…`}
        </button>
      </div>
      <ConfirmDialog
        open={confirming && total > 0}
        title={lines.question}
        message={
          <>
            {lines.completed && <p className={styles.confirmLine}>{lines.completed}</p>}
            {lines.filters && <p className={styles.confirmLine}>{lines.filters}</p>}
            <p className={styles.confirmLine}>{lines.undo}</p>
          </>
        }
        confirmLabel="Remove"
        danger
        initialFocus="cancel"
        onConfirm={() => void remove()}
        onCancel={() => setConfirming(false)}
      />
    </div>
  )
}

interface UnusedGroupProps<E> {
  title: string
  /** `people` / `tags`: Select all's accessible name. */
  noun: string
  empty: string
  entries: readonly UnusedEntry<E>[]
  ticked: Ticks
  onTicked: (next: Ticks) => void
  swatch: (entity: E) => ReactNode
}

function UnusedGroup<E extends { name: string }>({ title, noun, empty, entries, ticked, onTicked, swatch }: UnusedGroupProps<E>) {
  const tickedCount = entries.filter((e) => ticked.has(e.id)).length
  const all = entries.length > 0 && tickedCount === entries.length
  const some = tickedCount > 0 && !all
  const selectAllRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = some
  }, [some])

  return (
    <div className={styles.group} role="group" aria-label={title}>
      <div className={styles.groupHeader}>
        <span className={styles.groupTitle}>{title}</span>
        {entries.length > 0 && (
          <label className={styles.selectAll}>
            <input
              ref={selectAllRef}
              type="checkbox"
              aria-label={`Select all ${noun}`}
              checked={all}
              onChange={() => onTicked(all ? NONE : new Set(entries.map((e) => e.id)))}
            />
            Select all
          </label>
        )}
      </div>
      {entries.length === 0 ? (
        <p className={sectionStyles.muted}>{empty}</p>
      ) : (
        <ul className={styles.rows}>
          {entries.map((entry) => {
            const note = unusedEntryNote(entry)
            return (
              <li key={entry.id}>
                <label className={styles.row}>
                  <input type="checkbox" checked={ticked.has(entry.id)} onChange={() => onTicked(toggled(ticked, entry.id))} />
                  {swatch(entry.entity)}
                  <span className={styles.name}>{entry.entity.name}</span>
                  {note && <span className={styles.note}>{note}</span>}
                </label>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
