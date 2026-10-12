import type { ComponentType } from 'react'
import type { SettingsSectionId } from '../../../stores/ui-store'
import { AppearanceSection } from './AppearanceSection'
import { TaskDefaultsSection } from './TaskDefaultsSection'
import { EntitiesSection } from './EntitiesSection'
import { CompletedTasksSection } from './CompletedTasksSection'
import { FileStorageSection } from './FileStorageSection'
import { BackupsSection } from './BackupsSection'
import { ImportExportSection } from './ImportExportSection'
import { DataIntegritySection } from './DataIntegritySection'
import { ShortcutsSection } from './ShortcutsSection'
import { AboutSection } from './AboutSection'
import {
  AboutIcon,
  AppearanceIcon,
  BackupsIcon,
  CompletedIcon,
  DataIntegrityIcon,
  EntitiesIcon,
  FileStorageIcon,
  ImportExportIcon,
  KeyboardIcon,
  TaskDefaultsIcon,
} from './section-icons'

export interface SettingsSectionDef {
  id: SettingsSectionId
  label: string
  Icon: ComponentType
  Body: ComponentType
  /** Shown on the mobile Settings page too (the rest are desktop only). */
  mobile: boolean
}

const APPEARANCE: SettingsSectionDef = { id: 'appearance', label: 'Appearance', Icon: AppearanceIcon, Body: AppearanceSection, mobile: true }

/** The Settings sections, in list order. The modal and the mobile page both render from this. */
export const SETTINGS_SECTIONS: readonly SettingsSectionDef[] = [
  APPEARANCE,
  { id: 'task-defaults', label: 'Task defaults', Icon: TaskDefaultsIcon, Body: TaskDefaultsSection, mobile: false },
  { id: 'entities', label: 'People, statuses & tags', Icon: EntitiesIcon, Body: EntitiesSection, mobile: false },
  { id: 'completed', label: 'Completed tasks', Icon: CompletedIcon, Body: CompletedTasksSection, mobile: false },
  { id: 'file-storage', label: 'File storage', Icon: FileStorageIcon, Body: FileStorageSection, mobile: true },
  { id: 'backups', label: 'Backups', Icon: BackupsIcon, Body: BackupsSection, mobile: false },
  { id: 'import-export', label: 'Import / Export', Icon: ImportExportIcon, Body: ImportExportSection, mobile: true },
  { id: 'data-integrity', label: 'Data integrity', Icon: DataIntegrityIcon, Body: DataIntegritySection, mobile: false },
  { id: 'shortcuts', label: 'Keyboard shortcuts', Icon: KeyboardIcon, Body: ShortcutsSection, mobile: false },
  { id: 'about', label: 'About', Icon: AboutIcon, Body: AboutSection, mobile: true },
]

/** The section for `id` (Appearance if the id is unknown). */
export function settingsSection(id: SettingsSectionId): SettingsSectionDef {
  return SETTINGS_SECTIONS.find((s) => s.id === id) ?? APPEARANCE
}
