import { Fragment, useCallback, useId, useLayoutEffect, useRef, useState } from 'react'
import { useUIStore, type SettingsPartId } from '../../stores/ui-store'
import { SETTINGS_SECTIONS, partInView, scrollToSettingsPart, settingsSection } from './sections/settings-sections'
import { SettingsLayerContext } from './sections/settings-layer'
import { SettingsSectionBody } from './sections/SettingsSectionBody'
import { DialogFrame } from '../shared/Dialog'
import styles from './SettingsModal.module.css'

/**
 * Desktop Settings: a large modal over the workspace, one section at a time
 * with the section list on the left; a merged section shows its parts under
 * headings, listed under it in the nav as jump links (the part in view
 * marked as the content scrolls), and a deep link to a part opens the
 * section scrolled to it. Opening or closing it never changes
 * the route, so it never triggers the unsaved-layout prompt. Esc, × or a
 * backdrop click closes it — unless an editor or dialog a section opened is
 * on top (that layer owns Esc). With a lens's unsaved filter edits, closing
 * or another section asks Save / Discard / Keep editing first (`ui-store`'s
 * `closeSettings` / `setSettingsSection`; the prompt owns Esc while up).
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
  // The merged section's part in view (marked in the nav); kept per section.
  // The part last jumped to stays marked while its heading is in view.
  const [inView, setInView] = useState<{ section: string; part: string | null }>({ section: sectionId, part: null })
  const jumpedRef = useRef<SettingsPartId | null>(null)
  const updateInView = useCallback(() => {
    const content = contentRef.current
    if (!content) return
    const part = partInView(content, jumpedRef.current)
    if (part !== jumpedRef.current) jumpedRef.current = null
    setInView((prev) => (prev.section === sectionId && prev.part === part ? prev : { section: sectionId, part }))
  }, [sectionId])
  useLayoutEffect(updateInView, [updateInView])

  // A deep link to a part: show the section scrolled to it (and focus the
  // control it names, before the frame takes the focus), then forget it.
  useLayoutEffect(() => {
    if (!part) return
    const content = contentRef.current
    if (content) {
      jumpedRef.current = part
      scrollToSettingsPart(content, part)
      if (focus) content.querySelector<HTMLElement>(`[data-settings-focus="${focus}"]`)?.focus()
    }
    useUIStore.getState().clearSettingsPart()
    updateInView()
  }, [part, focus, sectionId, updateInView])

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
          {SETTINGS_SECTIONS.map(({ id, label, Icon, parts }) => (
            <Fragment key={id}>
              <button
                type="button"
                className={`${styles.navItem} ${id === section.id ? styles.navItemActive : ''}`}
                aria-current={id === section.id ? 'true' : undefined}
                onClick={() => setSection(id)}
              >
                <span className={styles.navIcon}><Icon /></span>
                {label}
              </button>
              {parts.length > 1 && parts.map((p) => {
                const marked = id === section.id && inView.section === section.id && inView.part === p.id
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={`${styles.navPart} ${marked ? styles.navPartInView : ''}`}
                    aria-current={marked ? 'location' : undefined}
                    data-settings-nav-part={p.id}
                    onClick={() => setSection(p.id)}
                  >
                    {p.label}
                  </button>
                )
              })}
            </Fragment>
          ))}
        </nav>
        <section ref={contentRef} className={styles.content} aria-labelledby={sectionTitleId} onScroll={updateInView}>
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
