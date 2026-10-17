import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { KeyCombo, ShortcutChord, ShortcutId } from '../../models/keyboard-shortcut'
import { shortcutSpec } from '../../models/keyboard-shortcut'
import { useSettingsStore } from '../../stores/settings-store'
import { shortcutListSections, type ShortcutListRow } from '../../utils/shortcut-bindings'
import { chordLabel, comboFromEvent, comboLabel, isModifierOnly, isSequenceKey } from '../../utils/shortcut-chord'
import styles from './ShortcutEditor.module.css'

interface Recording {
  id: ShortcutId
  /** A plain first key waiting for a second (a sequence) or Enter (the key alone). */
  pending: KeyCombo | null
  error: string | null
}

/**
 * Settings › Keyboard shortcuts: every shortcut with its live keys. An
 * editable one has **Change** (record a key combo, or two plain keys for a
 * sequence like `G` then `S`) and, once changed, **Reset**. Keys the rules
 * refuse (`utils/shortcut-bindings`) — reserved, the browser's, or another
 * shortcut's — are refused with the reason, and nothing is taken from another
 * shortcut. Recording happens inside the Settings dialog, so no app shortcut
 * fires; Esc cancels it (Settings stays open).
 */
export function ShortcutEditor() {
  const overrides = useSettingsStore((s) => s.shortcutOverrides)
  const [recording, setRecording] = useState<Recording | null>(null)
  const sections = shortcutListSections(overrides)

  return (
    <div className={styles.editor}>
      {sections.map((section) => (
        <div key={section.category} className={styles.category}>
          <div className={styles.categoryLabel}>{section.label}</div>
          <div className={styles.rows}>
            {section.rows.map((row, idx) => (
              <ShortcutRow
                key={row.id ?? `${section.category}-${idx}`}
                row={row}
                recording={recording && recording.id === row.id ? recording : null}
                onRecord={(next) => setRecording(next)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

interface ShortcutRowProps {
  row: ShortcutListRow
  recording: Recording | null
  onRecord: (next: Recording | null) => void
}

function ShortcutRow({ row, recording, onRecord }: ShortcutRowProps) {
  const setShortcut = useSettingsStore((s) => s.setShortcut)
  const resetShortcut = useSettingsStore((s) => s.resetShortcut)
  const captureRef = useRef<HTMLDivElement>(null)
  const changeRef = useRef<HTMLButtonElement>(null)
  /** Focus goes back to Change once the recording ends by a save or Esc (not by a click elsewhere). */
  const refocusRef = useRef(false)
  const isRecording = recording !== null
  const id = row.id

  useEffect(() => {
    if (isRecording) {
      captureRef.current?.focus()
    } else if (refocusRef.current) {
      refocusRef.current = false
      changeRef.current?.focus()
    }
  }, [isRecording])

  if (id === null || !row.editable) {
    return (
      <div className={styles.row}>
        <span className={styles.description}>{row.description}</span>
        <span className={styles.keys}><kbd className={styles.kbd}>{row.label}</kbd></span>
        <span className={styles.actions} />
      </div>
    )
  }

  const finish = () => {
    refocusRef.current = true
    onRecord(null)
  }

  const save = async (chord: ShortcutChord) => {
    const refusal = await setShortcut(id, chord)
    if (refusal) onRecord({ id, pending: null, error: refusal })
    else finish()
  }

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!recording) return
    // Tab leaves (and the blur cancels); everything else is the recording's.
    if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) return
    e.preventDefault()
    e.stopPropagation()
    if (e.key === 'Escape' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      finish()
      return
    }
    if (isModifierOnly(e.nativeEvent)) return
    const combo = comboFromEvent(e.nativeEvent)
    const { pending } = recording
    if (pending) {
      if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        void save([pending])
      } else if (combo && isSequenceKey(combo)) {
        void save([pending, combo])
      } else {
        onRecord({ ...recording, error: `Press a plain key to finish the sequence, or Enter for ${comboLabel(pending)} alone.` })
      }
      return
    }
    if (!combo) {
      onRecord({ ...recording, error: "That key can't be used for a shortcut." })
      return
    }
    // A plain key may start a sequence — unless the shortcut works while
    // typing, which needs a modifier (the save explains).
    if (isSequenceKey(combo) && !shortcutSpec(id).allowInInput) {
      onRecord({ id, pending: combo, error: null })
      return
    }
    void save([combo])
  }

  const prompt = recording?.pending
    ? `${comboLabel(recording.pending)} … then a second key, or Enter for ${comboLabel(recording.pending)} alone`
    : 'Press the new keys'

  return (
    <div className={`${styles.row} ${isRecording ? styles.rowRecording : ''}`} data-shortcut-id={id}>
      <span className={styles.description}>{row.description}</span>
      <span className={styles.keys}>
        {isRecording ? (
          <div
            ref={captureRef}
            className={styles.capture}
            tabIndex={0}
            role="textbox"
            aria-label={`New keys for ${row.description}`}
            aria-describedby={recording.error ? `shortcut-error-${id}` : undefined}
            onKeyDown={onKeyDown}
            onBlur={() => onRecord(null)}
          >
            {prompt}
          </div>
        ) : (
          <kbd className={`${styles.kbd} ${row.changed ? styles.kbdChanged : ''}`}>{row.label}</kbd>
        )}
      </span>
      <span className={styles.actions}>
        {isRecording ? (
          <span className={styles.hint}>Esc cancels</span>
        ) : (
          <>
            {row.changed && (
              <button
                type="button"
                className={styles.action}
                aria-label={`Reset ${row.description} to ${chordLabel(shortcutSpec(id).chord)}`}
                title={`Back to ${chordLabel(shortcutSpec(id).chord)}`}
                onClick={() => void resetShortcut(id)}
              >
                Reset
              </button>
            )}
            <button
              ref={changeRef}
              type="button"
              className={styles.action}
              aria-label={`Change keys for ${row.description}`}
              onClick={() => onRecord({ id, pending: null, error: null })}
            >
              Change
            </button>
          </>
        )}
      </span>
      {recording?.error && (
        <span id={`shortcut-error-${id}`} className={styles.error} role="alert">{recording.error}</span>
      )}
    </div>
  )
}
