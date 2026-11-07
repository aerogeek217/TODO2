import type { ComponentType } from 'react'
import type { SettingsPartId, SettingsSectionId } from '../../../stores/ui-store'
import { AppearanceSection } from './AppearanceSection'
import { TaskDefaultsSection } from './TaskDefaultsSection'
import { EntitiesSection } from './EntitiesSection'
import { CompletedTasksSection } from './CompletedTasksSection'
import { EisenhowerSection } from './EisenhowerSection'
import { LensesSection } from './LensesSection'
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

/** What a section's body is told: whether it is on the phone's Settings page. */
export interface SettingsBodyProps {
  mobile: boolean
}

/** One part of a section: a headed block in a merged section, else the section's whole body. */
export interface SettingsPartDef {
  /** A merged section's part id; a one-part section's own id. */
  id: SettingsPartId | SettingsSectionId
  label: string
  Body: ComponentType<SettingsBodyProps>
  /** Shown on the mobile Settings page too (the rest are desktop only). */
  mobile: boolean
  /** What the part is for: an ⓘ after its heading (a merged section's parts only). */
  help?: string
}

export interface SettingsSectionDef {
  id: SettingsSectionId
  label: string
  Icon: ComponentType
  /** One part = the section's body; several = headed parts, in order. */
  parts: readonly SettingsPartDef[]
}

/** A section with one body (no part headings). */
function single(id: SettingsSectionId, label: string, Icon: ComponentType, Body: ComponentType<SettingsBodyProps>, mobile: boolean): SettingsSectionDef {
  return { id, label, Icon, parts: [{ id, label, Body, mobile }] }
}

const LENSES_HELP = 'A lens is a saved filter with a name, picked in the top bar: every widget shows only what it keeps, on every layout. Edit it like a list’s filters — the same pickers, with their “is not” switch for what to leave out. Filters set in the top bar apply on top of it.'

const EISENHOWER_HELP = 'A task shows in the first pane whose filter it matches, checked in order: top left, top right, bottom left, bottom right. Dropping a task on a pane gives it what the filter sets. The panes are the same in every Eisenhower and on the dashboard; changes are saved at once.'

const BACKUPS_HELP = 'Taken automatically every day, before destructive operations, and before the sync file is rewritten. Restoring one backs up the data it replaces first.'

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
      { id: 'lenses', label: 'Lenses', Body: LensesSection, mobile: false, help: LENSES_HELP },
      { id: 'eisenhower', label: 'Eisenhower', Body: EisenhowerSection, mobile: false, help: EISENHOWER_HELP },
      { id: 'completed', label: 'Completed tasks', Body: CompletedTasksSection, mobile: false },
    ],
  },
  // The phone shows only its Unused people & tags row (`EntitiesSection`).
  single('entities', 'People, statuses & tags', EntitiesIcon, EntitiesSection, true),
  {
    id: 'database',
    label: 'Database',
    Icon: DatabaseIcon,
    parts: [
      { id: 'file-storage', label: 'File storage', Body: FileStorageSection, mobile: true },
      { id: 'backups', label: 'Backups', Body: BackupsSection, mobile: false, help: BACKUPS_HELP },
      { id: 'import-export', label: 'Import / Export', Body: ImportExportSection, mobile: true },
      { id: 'data-integrity', label: 'Data integrity', Body: DataIntegritySection, mobile: false },
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

/**
 * The merged section's part in view in `container`: `jumped` (the part last
 * jumped to) while its top is still in view — a part near the end can't
 * scroll up to the top —, else the last part whose top has reached the
 * container's (within 24px), or the last part once the container is
 * scrolled to its end (a short last part never reaches the top). Null when
 * the container shows no parts.
 */
export function partInView(container: HTMLElement, jumped: SettingsPartId | null = null): SettingsPartId | null {
  const parts = [...container.querySelectorAll<HTMLElement>('[data-settings-part]')]
  if (parts.length === 0) return null
  const box = container.getBoundingClientRect()
  const jumpedEl = jumped ? parts.find((el) => el.dataset.settingsPart === jumped) : undefined
  if (jumpedEl) {
    const top = jumpedEl.getBoundingClientRect().top
    if (top >= box.top - 4 && top < box.bottom - 24) return jumped
  }
  const atEnd = container.scrollTop > 0 && container.scrollTop + container.clientHeight >= container.scrollHeight - 2
  const top = box.top + 24
  let current = parts[0]
  for (const el of parts) {
    if (el.getBoundingClientRect().top <= top) current = el
  }
  const pick = atEnd ? parts.at(-1) : current
  return (pick?.dataset.settingsPart ?? null) as SettingsPartId | null
}

/**
 * Scrolls `container` so a merged section's part (its `data-settings-part`)
 * sits at the top, 8px down — the first part all the way up, its section's
 * title in view.
 */
export function scrollToSettingsPart(container: HTMLElement, part: SettingsPartId): void {
  const el = container.querySelector<HTMLElement>(`[data-settings-part="${part}"]`)
  if (!el) return
  if (container.querySelector('[data-settings-part]') === el) container.scrollTop = 0
  else container.scrollTop += el.getBoundingClientRect().top - container.getBoundingClientRect().top - 8
}
