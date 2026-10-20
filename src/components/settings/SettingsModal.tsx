import { useCallback, useId, useLayoutEffect, useRef } from 'react'
import { useUIStore } from '../../stores/ui-store'
import { SETTINGS_SECTIONS, scrollToSettingsPart, settingsSection } from './sections/settings-sections'
import { SettingsLayerContext } from './sections/settings-layer'
import { SettingsSectionBody } from './sections/SettingsSectionBody'
import { DialogFrame } from '../shared/Dialog'
import styles from './SettingsModal.module.css'

/**
 * Desktop Settings: a large modal over the workspace, one section at a time
 * with the section list on the left; a merged section shows its parts under
 * headings, and a deep link to a part opens the section scrolled to it. Opening or closing it never changes
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
  return ui.bulkConfirmation != null
    || ui.confirmPrompts.length > 0
    || ui.quickAddOpen
    || ui.editPopupMode != null
}

function SettingsModalFrame() {
  const sectionId = useUIStore((s) => s.settingsSection)
  const part = useUIStore((s) => s.settingsPart)
  const focus = useUIStore((s) => s.settingsFocus)
  const setSection = useUIStore((s) => s.setSettingsSection)
  const contentRef = useRef<HTMLElement | null>(null)
  const close = useUIStore((s) => s.closeSettings)
  const titleId = useId()
  const sectionTitleId = useId()
  const layers = useRef(0)
  const registerLayer = useCallback((delta: 1 | -1) => { layers.current += delta }, [])
  const section = settingsSection(sectionId)

  // A deep link to a part: show the section scrolled to it (and focus the
  // control it names, before the frame takes the focus), then forget it.
  useLayoutEffect(() => {
    if (!part) return
    const content = contentRef.current
    if (content) {
      scrollToSettingsPart(content, part)
      if (focus) content.querySelector<HTMLElement>(`[data-settings-focus="${focus}"]`)?.focus()
    }
    useUIStore.getState().clearSettingsPart()
  }, [part, focus, sectionId])

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
        <section ref={contentRef} className={styles.content} aria-labelledby={sectionTitleId}>
          <h2 id={sectionTitleId} className={styles.sectionTitle}>{section.label}</h2>
          <div className={styles.rule} />
          <SettingsLayerContext.Provider value={registerLayer}>
            <SettingsSectionBody key={section.id} section={section} mobile={false} />
          </SettingsLayerContext.Provider>
        </section>
      </div>
    </DialogFrame>
  )
}
