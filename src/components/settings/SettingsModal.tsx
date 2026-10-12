import { useCallback, useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useUIStore } from '../../stores/ui-store'
import { SETTINGS_SECTIONS, settingsSection } from './sections/settings-sections'
import { SettingsLayerContext } from './sections/settings-layer'
import styles from './SettingsModal.module.css'

const FOCUSABLE =
  'button:not([disabled]),[href],input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

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
    || ui.quickAddOpen
    || ui.editPopupMode != null
}

function SettingsModalFrame() {
  const sectionId = useUIStore((s) => s.settingsSection)
  const setSection = useUIStore((s) => s.setSettingsSection)
  const close = useUIStore((s) => s.closeSettings)
  const titleId = useId()
  const sectionTitleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const layers = useRef(0)
  const registerLayer = useCallback((delta: 1 | -1) => { layers.current += delta }, [])
  const section = settingsSection(sectionId)
  const Body = section.Body

  // Focus the frame on open (Tab then walks the section list); give focus
  // back to the opener on close.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    dialogRef.current?.focus()
    return () => {
      if (previouslyFocused && document.body.contains(previouslyFocused)) previouslyFocused.focus()
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (layers.current > 0 || anotherLayerIsOpen()) return
      if (e.key === 'Escape') {
        if (e.defaultPrevented) return
        e.preventDefault()
        close()
        return
      }
      if (e.key !== 'Tab') return
      const dialog = dialogRef.current
      if (!dialog) return
      const focusables = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE))
      const first = focusables.at(0)
      const last = focusables.at(-1)
      if (!first || !last) return
      const active = document.activeElement as HTMLElement | null
      if (e.shiftKey && (active === first || !dialog.contains(active))) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (active === last || !dialog.contains(active))) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [close])

  return createPortal(
    <div
      className={styles.overlay}
      onClick={(e) => { if (e.target === e.currentTarget) close() }}
      data-testid="settings-backdrop"
    >
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-shortcut-scope="none"
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
      </div>
    </div>,
    document.body,
  )
}
