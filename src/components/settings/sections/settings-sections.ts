import type { ComponentType } from 'react'
import type { SettingsPartId, SettingsSectionId } from '../../../stores/ui-store'
import { AppearanceSection } from './AppearanceSection'
import { TaskDefaultsSection } from './TaskDefaultsSection'
import { EntitiesSection } from './EntitiesSection'
import { UnusedEntitiesSection } from './UnusedEntitiesSection'
import { CompletedTasksSection } from './CompletedTasksSection'
import { EisenhowerSection } from './EisenhowerSection'
import { FileStorageSection } from './FileStorageSection'
import { BackupsSection } from './BackupsSection'
import { ImportExportSection } from './ImportExportSection'
import { DataIntegritySection } from './DataIntegritySection'
import { ShortcutsSection } from './ShortcutsSection'
import { AboutSection } from './AboutSection'
import {
  AboutIcon,
  AppearanceIcon,
  DatabaseIcon,
  EntitiesIcon,
  KeyboardIcon,
  TasksIcon,
} from './section-icons'

/** One part of a section: a headed block in a merged section, else the section's whole body. */
export interface SettingsPartDef {
  /** A merged section's part id; a one-part section's own id. */
  id: SettingsPartId | SettingsSectionId
  label: string
  Body: ComponentType
  /** Shown on the mobile Settings page too (the rest are desktop only). */
  mobile: boolean
}

export interface SettingsSectionDef {
  id: SettingsSectionId
  label: string
  Icon: ComponentType
  /** One part = the section's body; several = headed parts, in order. */
  parts: readonly SettingsPartDef[]
}

/** A section with one body (no part headings). */
function single(id: SettingsSectionId, label: string, Icon: ComponentType, Body: ComponentType, mobile: boolean): SettingsSectionDef {
  return { id, label, Icon, parts: [{ id, label, Body, mobile }] }
}

const APPEARANCE = single('appearance', 'Appearance', AppearanceIcon, AppearanceSection, true)

/** The Settings sections, in list order. The modal and the mobile page both render from this. */
export const SETTINGS_SECTIONS: readonly SettingsSectionDef[] = [
  APPEARANCE,
  {
    id: 'tasks',
    label: 'Tasks',
    Icon: TasksIcon,
    parts: [
      { id: 'task-defaults', label: 'Task defaults', Body: TaskDefaultsSection, mobile: false },
      { id: 'eisenhower', label: 'Eisenhower', Body: EisenhowerSection, mobile: false },
      { id: 'completed', label: 'Completed tasks', Body: CompletedTasksSection, mobile: false },
    ],
  },
  {
    id: 'entities',
    label: 'People, statuses & tags',
    Icon: EntitiesIcon,
    parts: [
      { id: 'entities-manage', label: 'Manage', Body: EntitiesSection, mobile: false },
      { id: 'unused-entities', label: 'Unused people & tags', Body: UnusedEntitiesSection, mobile: true },
    ],
  },
  {
    id: 'database',
    label: 'Database',
    Icon: DatabaseIcon,
    parts: [
      { id: 'import-export', label: 'Import / Export', Body: ImportExportSection, mobile: true },
      { id: 'data-integrity', label: 'Data integrity', Body: DataIntegritySection, mobile: false },
      { id: 'file-storage', label: 'File storage', Body: FileStorageSection, mobile: true },
      { id: 'backups', label: 'Backups', Body: BackupsSection, mobile: false },
    ],
  },
  single('shortcuts', 'Keyboard shortcuts', KeyboardIcon, ShortcutsSection, false),
  single('about', 'About', AboutIcon, AboutSection, true),
]

/** The section for `id` (Appearance if the id is unknown). */
export function settingsSection(id: SettingsSectionId): SettingsSectionDef {
  return SETTINGS_SECTIONS.find((s) => s.id === id) ?? APPEARANCE
}

/** The parts a surface shows: every part on desktop, the mobile ones on a phone. */
export function visibleParts(section: SettingsSectionDef, mobile: boolean): readonly SettingsPartDef[] {
  return mobile ? section.parts.filter((p) => p.mobile) : section.parts
}

/** The sections the mobile Settings page lists: those with a part it shows. */
export const MOBILE_SETTINGS_SECTIONS: readonly SettingsSectionDef[] = SETTINGS_SECTIONS.filter((s) => s.parts.some((p) => p.mobile))

/** Scrolls `container` so a merged section's part (its `data-settings-part`) sits at the top, 8px down. */
export function scrollToSettingsPart(container: HTMLElement, part: SettingsPartId): void {
  const el = container.querySelector<HTMLElement>(`[data-settings-part="${part}"]`)
  if (el) container.scrollTop += el.getBoundingClientRect().top - container.getBoundingClientRect().top - 8
}
