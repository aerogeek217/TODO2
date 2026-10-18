import { useLayoutEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router'
import type { SettingsSectionId } from '../stores/ui-store'
import { MOBILE_SETTINGS_SECTIONS, scrollToSettingsPart, settingsSection } from '../components/settings/sections/settings-sections'
import { SettingsSectionBody } from '../components/settings/sections/SettingsSectionBody'
import { ChevronLeftIcon, ChevronRightIcon } from '../components/shared/icons'
import type { SettingsRouteState } from '../routes'
import styles from './SettingsPage.module.css'

/**
 * Mobile Settings (the bottom tab bar's Settings tab): the section list
 * first (sections with a part the phone shows); tapping a section slides to
 * it — only its phone parts — with a back arrow. Desktop opens
 * the same sections in the Settings modal instead (`SettingsModal`).
 * Navigated to with a section as route state (the status sheet's File
 * storage settings), it opens on that section, scrolled to the route
 * state's part.
 */
export function SettingsPage() {
  const location = useLocation()
  const routeState = location.state as SettingsRouteState | null
  const [openId, setOpenId] = useState<SettingsSectionId | null>(() => routeState?.section ?? null)
  const pageRef = useRef<HTMLDivElement>(null)
  // The route state's part: scroll to it once, on arrival.
  const [initialPart] = useState(() => routeState?.part ?? null)
  useLayoutEffect(() => {
    if (initialPart && pageRef.current) scrollToSettingsPart(pageRef.current, initialPart)
  }, [initialPart])

  if (openId) {
    const section = settingsSection(openId)
    return (
      <div ref={pageRef} className={styles.page} data-settings-page="">
        <div className={`${styles.panel} ${styles.slideIn}`} key={section.id}>
          <div className={styles.header}>
            <button type="button" className={styles.back} aria-label="Back to Settings" onClick={() => setOpenId(null)}>
              <ChevronLeftIcon size={18} />
            </button>
            <h1 className={styles.title}>{section.label}</h1>
          </div>
          <div className={styles.content}>
            <SettingsSectionBody section={section} mobile />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <div className={styles.panel}>
        <div className={styles.header}>
          <h1 className={`${styles.title} ${styles.titleRoot}`}>Settings</h1>
        </div>
        <nav className={styles.list} aria-label="Settings sections">
          {MOBILE_SETTINGS_SECTIONS.map(({ id, label, Icon }) => (
            <button key={id} type="button" className={styles.item} onClick={() => setOpenId(id)}>
              <span className={styles.itemIcon}><Icon /></span>
              <span className={styles.itemLabel}>{label}</span>
              <span className={styles.itemChevron}><ChevronRightIcon size={14} /></span>
            </button>
          ))}
        </nav>
      </div>
    </div>
  )
}
