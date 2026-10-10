import { useMemo, useState } from 'react'
import type { AppendCandidate, AppendChoice } from '../../services/append-import'
import { defaultAppendChoices } from '../../services/append-import'
import { Dialog, DialogActions, DialogBody } from '../shared/Dialog'
import buttons from './FileSyncDialogs.module.css'
import styles from './TaskArchiveDialogs.module.css'

interface AppendImportDialogProps {
  fileName: string
  candidates: AppendCandidate[]
  busy: boolean
  error: string | null
  onConfirm: (choices: Map<string, AppendChoice>) => void
  onCancel: () => void
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

function matchLabel(c: AppendCandidate): string {
  const d = c.duplicate
  if (!d) return 'No match in your tasks'
  const state = d.existing.isCompleted ? 'completed' : 'active'
  return d.reason === 'uid'
    ? `Already here (${state}): “${d.existing.title}”`
    : `Same title as an active task: “${d.existing.title}”`
}

/**
 * Append-import confirmation + duplicate picker. Every incoming task
 * is listed; a duplicate (same `uid`, or same title as an active task) shows
 * its matched task and a per-row **Skip** / **Import as new** choice (default
 * Skip), with apply-to-all. Non-duplicates are always imported.
 */
export function AppendImportDialog({ fileName, candidates, busy, error, onConfirm, onCancel }: AppendImportDialogProps) {
  const [choices, setChoices] = useState(() => defaultAppendChoices(candidates))
  // Duplicates first (they need a decision), file order otherwise.
  const ordered = useMemo(
    () => [...candidates.filter((c) => c.duplicate), ...candidates.filter((c) => !c.duplicate)],
    [candidates],
  )
  const duplicateCount = candidates.length - ordered.filter((c) => !c.duplicate).length
  const importCount = candidates.filter((c) => (choices.get(c.incoming.uid) ?? 'import') === 'import').length

  const setChoice = (uid: string, choice: AppendChoice) => {
    setChoices((prev) => new Map(prev).set(uid, choice))
  }
  const setAllDuplicates = (choice: AppendChoice) => {
    setChoices((prev) => {
      const next = new Map(prev)
      for (const c of candidates) if (c.duplicate) next.set(c.incoming.uid, choice)
      return next
    })
  }

  return (
    <Dialog
      open
      onClose={() => { if (!busy) onCancel() }}
      blockBackdropClose
      size="lg"
      title={`Import tasks from ${fileName}`}
    >
      <DialogBody>
        {plural(candidates.length, 'task')} in the file
        {duplicateCount > 0 ? `; ${plural(duplicateCount, 'possible duplicate')} — choose what to do with each.` : '.'}
        {' '}Imported tasks are added next to your current ones; nothing is replaced.
        {duplicateCount > 0 && (
          <div className={styles.applyAll}>
            <span>All duplicates:</span>
            <button type="button" className={styles.linkButton} onClick={() => setAllDuplicates('skip')} disabled={busy}>
              Skip
            </button>
            <button type="button" className={styles.linkButton} onClick={() => setAllDuplicates('import')} disabled={busy}>
              Import as new
            </button>
          </div>
        )}
        <ul className={styles.list} data-testid="append-import-list">
          {ordered.map((c) => {
            const uid = c.incoming.uid
            const choice = choices.get(uid) ?? 'import'
            return (
              <li key={uid} className={styles.row} data-testid="append-import-row" data-duplicate={c.duplicate ? c.duplicate.reason : 'none'}>
                <div className={styles.rowMain}>
                  <span className={styles.rowTitle} title={c.incoming.title}>
                    {c.incoming.isCompleted ? '✓ ' : ''}{c.incoming.title}
                  </span>
                  <span className={styles.rowMeta} title={matchLabel(c)}>{matchLabel(c)}</span>
                </div>
                {c.duplicate ? (
                  <div className={styles.choice} role="group" aria-label={`What to do with “${c.incoming.title}”`}>
                    {(['skip', 'import'] as const).map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        aria-pressed={choice === opt}
                        className={`${styles.choiceButton} ${choice === opt ? styles.choiceButtonActive : ''}`}
                        onClick={() => setChoice(uid, opt)}
                        disabled={busy}
                      >
                        {opt === 'skip' ? 'Skip' : 'Import as new'}
                      </button>
                    ))}
                  </div>
                ) : (
                  <span className={styles.newBadge}>Will import</span>
                )}
              </li>
            )
          })}
        </ul>
        <div className={styles.note}>A backup snapshot is taken before importing (Settings → Backups).</div>
        {error && <div className={styles.error} role="alert">{error}</div>}
      </DialogBody>
      <DialogActions>
        <button className={buttons.cancelButton} onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button
          className={buttons.primaryButton}
          onClick={() => onConfirm(choices)}
          disabled={busy || importCount === 0}
        >
          {importCount === 0 ? 'Nothing to import' : `Import ${plural(importCount, 'task')}`}
        </button>
      </DialogActions>
    </Dialog>
  )
}
