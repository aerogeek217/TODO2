import { useState } from 'react'
import type { SettingsSectionId } from '../stores/ui-store'
import { MOBILE_SETTINGS_SECTIONS, settingsSection } from '../components/settings/sections/settings-sections'
import { SettingsSectionBody } from '../components/settings/sections/SettingsSectionBody'
import { ChevronLeftIcon, ChevronRightIcon } from '../components/shared/icons'
import styles from './SettingsPage.module.css'

/**
 * Mobile Settings (the bottom tab bar's Settings tab): the section list
 * first (sections with a part the phone shows); tapping a section slides to
 * it — only its phone parts — with a back arrow. Desktop opens
 * the same sections in the Settings modal instead (`SettingsModal`).
 */
export function SettingsPage() {
  const [openId, setOpenId] = useState<SettingsSectionId | null>(null)

  if (openId) {
    const section = settingsSection(openId)
    return (
      <div className={styles.page}>
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
