import { useCallback, useState } from 'react'
import { useSettingsStore } from '../../stores/settings-store'
import { useNoteStore } from '../../stores/note-store'
import { NotesBody } from '../shared/notes/NotesBody'
import { copyNotesRich } from '../../services/notes-export'
import styles from './NotesPanel.module.css'

type Dock = 'right' | 'bottom' | 'floating'

interface NotesPanelProps {
  onToast?: (message: string) => void
}

function DockBtn({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean
  onClick: () => void
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      className={`${styles.dockBtn} ${active ? styles.dockBtnActive : ''}`}
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
    >
      {children}
    </button>
  )
}

/**
 * Dashboard-owned chrome for the shared notes body. The body itself is
 * provider-neutral (see `NotesBody`), so canvas rail Phase 4E will wrap the
 * same body in its slot shell without duplicating editor code.
 */
export function NotesPanel({ onToast }: NotesPanelProps) {
  const dock = useSettingsStore((s) => s.notesDock) as Dock
  const setDock = useSettingsStore((s) => s.setNotesDock)
  const setVisible = useSettingsStore((s) => s.setNotesVisible)
  const activeId = useNoteStore((s) => s.activeId)
  const notes = useNoteStore((s) => s.notes)
  const [copying, setCopying] = useState(false)

  const handleCopy = useCallback(async () => {
    if (activeId == null) return
    const content = notes.get(activeId)?.content ?? ''
    setCopying(true)
    try {
      const ok = await copyNotesRich(content)
      onToast?.(ok ? 'Copied rich text — paste into OneNote/Word' : 'Copy failed')
    } finally {
      setCopying(false)
    }
  }, [activeId, notes, onToast])

  return (
    <div className={`${styles.panel} ${styles[`panel_${dock}`]}`} role="complementary" aria-label="Notes">
      <div className={styles.header}>
        <span className={styles.title}>Inbox</span>
        <span className={styles.badge}>default project</span>
        <button
          type="button"
          className={styles.copyBtn}
          onClick={handleCopy}
          title="Copy as rich text for OneNote / Word"
          disabled={copying}
        >
          ⧉ Copy rich
        </button>
        <div className={styles.dockBtns}>
          <DockBtn active={dock === 'right'} onClick={() => void setDock('right')} title="Dock right">▐</DockBtn>
          <DockBtn active={dock === 'bottom'} onClick={() => void setDock('bottom')} title="Dock bottom">▂</DockBtn>
          <DockBtn active={dock === 'floating'} onClick={() => void setDock('floating')} title="Float">◰</DockBtn>
          <DockBtn active={false} onClick={() => void setVisible(false)} title="Hide notes">✕</DockBtn>
        </div>
      </div>
      <NotesBody dock={dock} onConvertToast={onToast} />
    </div>
  )
}
