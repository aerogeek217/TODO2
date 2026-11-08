import { emptyPredicate, type Person, type Tag } from '../models'
import { useListWidgetStore, type ShownListSection } from '../stores/list-widget-store'
import { useReviewStore, type ReviewDivider, type ReviewSourceKind } from '../stores/review-store'
import { useUIStore } from '../stores/ui-store'
import type { TaskDialogPayload } from '../stores/task-dialog-payload'
import { zoomTargetTab } from './list-zoom'
import { currentTaskDialogEnv, personTaskDialog, resolveTaskDialog, tagTaskDialog } from './task-dialog'

/**
 * The review deck's entry point (D26): `openReview` with what to review,
 * built from a list tab as it shows its tasks (`listReview`), a person's
 * or a tag's open tasks as their task dialog lists them (`personReview`,
 * `tagReview`), or several people's together (`peopleReview`).
 */

/** What a review opens on: its source in words, the tasks in queue order and the list's group headers. */
export interface ReviewPayload {
  kind: ReviewSourceKind
  /** The source's name: the list's, the person's, `#tag`. */
  title: string
  description: string
  ids: readonly number[]
  dividers?: readonly ReviewDivider[]
}

/**
 * Opens the deck on `payload` (none, or no tasks: nothing happens — false).
 * Clears the selection, as the task dialog does: the deck acts on one task
 * at a time, never on the selection.
 */
export function openReview(payload: ReviewPayload | null): boolean {
  if (!payload || payload.ids.length === 0) return false
  const { kind, title, description, ids, dividers } = payload
  useUIStore.getState().clearSelection()
  useReviewStore.getState().start({ source: { kind, title, description }, ids, ...(dividers ? { dividers } : {}) })
  return true
}

/**
 * A list's sections as a queue: every task once, at its first place (a task
 * in several People groups), collapsed groups too; with group headers
 * (`grouped`), each group that adds a task is a divider before its first.
 */
export function queueOfSections(sections: readonly ShownListSection[], grouped: boolean): { ids: number[]; dividers: ReviewDivider[] } {
  const seen = new Set<number>()
  const ids: number[] = []
  const dividers: ReviewDivider[] = []
  for (const section of sections) {
    const start = ids.length
    for (const t of section.todos) {
      if (seen.has(t.id)) continue
      seen.add(t.id)
      ids.push(t.id)
    }
    if (grouped && ids.length > start) dividers.push({ index: start, label: section.label })
  }
  return { ids, dividers }
}

/** How many tasks a list tab's review would take (its shown tasks, each once); 0 while it isn't on screen. */
export function listReviewCount(tabId: string): number {
  const shown = useListWidgetStore.getState().shown[tabId]
  return shown ? queueOfSections(shown.sections, false).ids.length : 0
}

/** A list tab's tasks as it shows them (`list-widget-store.shown`); null while it isn't on screen. */
export function listReview(tabId: string): ReviewPayload | null {
  const shown = useListWidgetStore.getState().shown[tabId]
  if (!shown) return null
  return { kind: 'list', title: shown.label, description: shown.description, ...queueOfSections(shown.sections, shown.grouped) }
}

/**
 * The list tab Review List acts on (the shortcut, the palette): the one on
 * screen the user was last in, as the zoom commands pick it
 * (`zoomTargetTab`), while it shows a task to review; else null.
 */
export function reviewTargetTabId(): string | null {
  const tab = zoomTargetTab()
  return tab && listReviewCount(tab.id) > 0 ? tab.id : null
}

/** Reviews list tab `tabId`'s tasks as shown (false: nothing to review). */
export function reviewListTab(tabId: string): boolean {
  return openReview(listReview(tabId))
}

/** A task dialog payload's tasks, as the dialog would list them now (each once). */
function dialogIds(payload: TaskDialogPayload): number[] {
  const groups = resolveTaskDialog(payload.source, currentTaskDialogEnv())
  return queueOfSections(groups.map((g) => ({ key: g.key, label: g.label ?? '', todos: g.todoIds.map((id) => ({ id })) })), false).ids
}

/** A person's open tasks, as their task dialog lists them (Review with X…). */
export function personReview(person: Pick<Person, 'id' | 'name'>): ReviewPayload {
  const dialog = personTaskDialog(person)
  return { kind: 'person', title: dialog.title, description: dialog.description, ids: dialogIds(dialog) }
}

/** A tag's open tasks, as its task dialog lists them (Review #tag tasks…). */
export function tagReview(tag: Pick<Tag, 'id' | 'name'>): ReviewPayload {
  const dialog = tagTaskDialog(tag)
  return { kind: 'tag', title: dialog.title, description: dialog.description, ids: dialogIds(dialog) }
}

/** Names as a phrase: `Aisha`, `Aisha and Ben`, `Aisha, Ben and Chen`. */
function namesPhrase(names: readonly string[], last: 'and' | 'or'): string {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} ${last} ${names.at(-1) ?? ''}`
}

/**
 * Several people's open tasks together, each once (Review N people's
 * tasks…): the tasks any of them has, in the order a person's task dialog
 * lists tasks. One person is `personReview`.
 */
export function peopleReview(people: readonly Pick<Person, 'id' | 'name'>[]): ReviewPayload {
  const [only] = people
  if (people.length === 1 && only) return personReview(only)
  const personIds = people.flatMap((p) => (p.id != null ? [p.id] : []))
  const names = people.map((p) => p.name)
  const dialog: TaskDialogPayload = {
    title: namesPhrase(names, 'and'),
    glyph: 'people',
    description: `Open tasks assigned to ${namesPhrase(names, 'or')}.`,
    source: { kind: 'predicate', predicate: { ...emptyPredicate(), personIds } },
  }
  return { kind: 'people', title: `${people.length} people`, description: dialog.description, ids: personIds.length > 0 ? dialogIds(dialog) : [] }
}
