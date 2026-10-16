import { useCallback, useId, useRef } from 'react'
import { useUIStore } from '../../stores/ui-store'
import { SETTINGS_SECTIONS, settingsSection } from './sections/settings-sections'
import { SettingsLayerContext } from './sections/settings-layer'
import { DialogFrame } from '../shared/Dialog'
import styles from './SettingsModal.module.css'

/**
 * Desktop Settings: a large modal over the workspace, one section at a time
 * with the section list on the left. Opening or closing it never changes
 * the route, so it never triggers the unsaved-layout prompt. Esc, × or a
 * backdrop click closes it — unless an editor or dialog a section opened is
 * on top (that layer owns Esc).
 */
export function SettingsModal() {
  const open = useUIStore((s) => s.settingsOpen)
  if (!open) return null
  return <SettingsModalFrame />
}

/** Overlays that sit above the modal and own Esc while open. */
function anotherLayerIsOpen(): boolean {
  const ui = useUIStore.getState()
  return ui.listsEditorOpen
    || ui.listEditorDialogId != null
    || ui.bulkConfirmation != null
    || ui.confirmPrompts.length > 0
    || ui.quickAddOpen
    || ui.editPopupMode != null
}

function SettingsModalFrame() {
  const sectionId = useUIStore((s) => s.settingsSection)
  const setSection = useUIStore((s) => s.setSettingsSection)
  const close = useUIStore((s) => s.closeSettings)
  const titleId = useId()
  const sectionTitleId = useId()
  const layers = useRef(0)
  const registerLayer = useCallback((delta: 1 | -1) => { layers.current += delta }, [])
  const section = settingsSection(sectionId)
  const Body = section.Body

  // A section's editor or dialog, or another overlay, owns Esc while open.
  const escapeBelongsElsewhere = useCallback(() => layers.current > 0 || anotherLayerIsOpen(), [])

  // Focus starts on the frame (Tab then walks the section list).
  return (
    <DialogFrame
      onClose={close}
      layer="overlay"
      initialFocus="panel"
      escapeBelongsElsewhere={escapeBelongsElsewhere}
      aria-labelledby={titleId}
      className={styles.dialog}
      backdropClassName={styles.backdrop}
    >
        <div className={styles.header}>
          <h1 id={titleId} className={styles.title}>Settings</h1>
          <kbd className={styles.kbd} aria-hidden="true">Esc</kbd>
          <button type="button" className={styles.close} aria-label="Close settings" onClick={close}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>
        <div className={styles.body}>
          <nav className={styles.nav} aria-label="Settings sections">
            {SETTINGS_SECTIONS.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                className={`${styles.navItem} ${id === section.id ? styles.navItemActive : ''}`}
                aria-current={id === section.id ? 'true' : undefined}
                onClick={() => setSection(id)}
              >
                <span className={styles.navIcon}><Icon /></span>
                {label}
              </button>
            ))}
          </nav>
          <section className={styles.content} aria-labelledby={sectionTitleId}>
            <h2 id={sectionTitleId} className={styles.sectionTitle}>{section.label}</h2>
            <div className={styles.rule} />
            <SettingsLayerContext.Provider value={registerLayer}>
              <Body key={section.id} />
            </SettingsLayerContext.Provider>
          </section>
        </div>
    </DialogFrame>
  )
}
