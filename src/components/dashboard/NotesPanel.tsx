import { useSettingsStore } from '../../stores/settings-store'
import { NotesBody } from '../shared/notes/NotesBody'
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

  return (
    <div className={`${styles.panel} ${styles[`panel_${dock}`]}`} role="complementary" aria-label="Notes">
      <div className={styles.header}>
        <span className={styles.title}>Inbox</span>
        <span className={styles.badge}>default project</span>
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
