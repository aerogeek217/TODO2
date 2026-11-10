import { emptyPredicate, type PersistedTodoItem, type Person, type Tag, type TodoPredicate } from '../models'
import { useFilterStore } from '../stores/filter-store'
import { useListDefinitionStore } from '../stores/list-definition-store'
import { listAsShownNow } from '../stores/list-draft-store'
import { useListOrderStore } from '../stores/list-order-store'
import { useListWidgetStore, type ShownListSection } from '../stores/list-widget-store'
import { useReviewStore, type ReviewDivider, type ReviewQueue, type ReviewSourceKind } from '../stores/review-store'
import { currentAppliedLens } from '../stores/screen-filter'
import { useUIStore } from '../stores/ui-store'
import type { TaskDialogPayload } from '../stores/task-dialog-payload'
import { todoNameLookups } from '../utils/filter'
import { predicateToCriteria } from '../utils/filter-criteria'
import { createPredicateEvaluator, createScreenComposedEvaluator, type FilterSettings } from '../utils/filter-match'
import { withLens } from '../utils/lens'
import { bySortOrder } from '../utils/sort-order'
import { buildList } from './build-list'
import { zoomTargetTab } from './list-zoom'
import { setReviewQueue } from './review-queue'
import { currentTaskDialogEnv, personTaskDialog, tagTaskDialog, type TaskDialogEnv } from './task-dialog'

/**
 * The review deck's entry point (D26): `openReview` with what to review,
 * built from a list tab as it shows its tasks (`listReview`), a person's
 * or a tag's open tasks as their task dialog lists them (`personReview`,
 * `tagReview`), or several people's together (`peopleReview`). Each source
 * can be taken again with or without the top bar's lens (item 10: the
 * deck's lens switch, `toggleReviewLens`).
 */

/**
 * How a source takes its queue again (item 10): whether the queue it gives
 * was taken without the top bar's lens (`ignored` — a list or a widget that
 * ignores it, a person's or a tag's tasks, which the screen filter never
 * narrowed), and the queue with or without it (`requery`).
 */
export interface ReviewPayloadLens {
  ignored: boolean
  requery: (ignoreLens: boolean) => ReviewQueue
}

/** What a review opens on: its source in words, the tasks in queue order and the list's group headers. */
export interface ReviewPayload {
  kind: ReviewSourceKind
  /** The source's name: the list's, the person's, `#tag`. */
  title: string
  description: string
  ids: readonly number[]
  dividers?: readonly ReviewDivider[]
  /** How to take it again with / without the lens; absent: no lens switch in the deck. */
  lens?: ReviewPayloadLens
}

/** How many tasks of `unlensed` the lens leaves out of `lensed` (the switch's `−N`). */
function hiddenCount(unlensed: ReviewQueue, lensed: ReviewQueue): number {
  const kept = new Set(lensed.ids)
  return unlensed.ids.filter((id) => !kept.has(id)).length
}

/**
 * Opens the deck on `payload` (none, or no tasks: nothing happens — false).
 * Clears the selection, as the task dialog does: the deck acts on one task
 * at a time, never on the selection. The queue is the payload's, as its
 * source showed it; with a `lens`, the switch's `−N` is taken now.
 */
export function openReview(payload: ReviewPayload | null): boolean {
  if (!payload || payload.ids.length === 0) return false
  const { kind, title, description, ids, dividers, lens } = payload
  useUIStore.getState().clearSelection()
  useReviewStore.getState().start({
    source: { kind, title, description },
    ids,
    ...(dividers ? { dividers } : {}),
    ...(lens ? { lens: { ...lens, used: false, hides: hiddenCount(lens.requery(true), lens.requery(false)) } } : {}),
  })
  return true
}

/**
 * The deck's lens switch (item 10): takes the queue again from its source
 * with the lens if it was ignored, else without it — the only change a
 * frozen queue takes besides a deleted task leaving it. The current card
 * stays while its task is still there, else the next one does; the sort,
 * marks and typed text stay (`services/review-queue.setReviewQueue`).
 */
export function toggleReviewLens(): void {
  const { lens, open } = useReviewStore.getState()
  if (!open || !lens) return
  const ignored = !lens.ignored
  const queue = lens.requery(ignored)
  setReviewQueue(useReviewStore, queue)
  const hides = hiddenCount(ignored ? queue : lens.requery(true), ignored ? lens.requery(false) : queue)
  useReviewStore.getState().setLens({ ...lens, ignored, hides, used: true })
}

/** The filter settings a task dialog env reads. */
function settingsOf(env: TaskDialogEnv): FilterSettings {
  return { ...env.markerSettings, weekStartsOn: env.weekStartsOn }
}

/** The chips of no screen filter (the lens alone composed under them). */
const NO_CHIPS = predicateToCriteria(emptyPredicate())

/**
 * A predicate's tasks in `sortOrder` (as a person's or a tag's task dialog
 * lists them): its open tasks — and, unless `ignoreLens`, only those the
 * top bar's lens keeps (the lens alone: a person's review never read the
 * chips).
 */
function predicateQueue(predicate: TodoPredicate, ignoreLens: boolean): ReviewQueue {
  const env = currentTaskDialogEnv()
  const lens = ignoreLens ? undefined : currentAppliedLens()
  const lookups = todoNameLookups(env)
  const matches = lens
    ? createScreenComposedEvaluator(withLens(NO_CHIPS, lens), lookups, env.today, settingsOf(env))
    : createPredicateEvaluator(lookups, env.today, settingsOf(env))
  return { ids: env.todos.filter((t) => matches(predicate, t)).sort(bySortOrder).map((t) => t.id) }
}

/** A predicate's review lens: taken without the lens (`ignored`), either way on a toggle. */
function predicateLens(predicate: TodoPredicate): ReviewPayloadLens {
  return { ignored: true, requery: (ignoreLens) => predicateQueue(predicate, ignoreLens) }
}

/**
 * List `listId` as list tab `tabId` shows it now — its filter as edited, its
 * prompt pick, the screen filter's chips, and the lens unless `ignoreLens` —
 * as a queue (`queueOfSections`, with its group headers when `grouped`).
 */
export function listQueueNow(listId: number, tabId: string, grouped: boolean, ignoreLens: boolean): ReviewQueue {
  const definition = listAsShownNow(listId)
  if (!definition) return { ids: [] }
  const env = currentTaskDialogEnv()
  const { filters: chips, isActive } = useFilterStore.getState()
  const lens = ignoreLens ? undefined : currentAppliedLens()
  const screen = isActive || lens ? withLens(chips, lens) : undefined
  const lookups = todoNameLookups(env)
  const settings = settingsOf(env)
  const list = buildList(definition, env.todos as PersistedTodoItem[], {
    today: env.today,
    weekStartsOn: env.weekStartsOn,
    evalPredicate: screen ? createScreenComposedEvaluator(screen, lookups, env.today, settings) : createPredicateEvaluator(lookups, env.today, settings),
    screenFilter: screen,
    assignedTagsMap: env.assignedTagsMap,
    assignedPeopleMap: env.assignedPeopleMap,
    people: env.people,
    statuses: env.statuses,
    runtimeFilterValue: useListWidgetStore.getState().picks[tabId],
    ranks: useListOrderStore.getState().ranks.get(listId),
    urgentRange: env.markerSettings.urgentRange,
  })
  if (list.runtimeFilterUnset) return { ids: [] }
  return queueOfSections(list.sections.map((s) => ({ key: s.key, label: s.label, todos: s.todos })), grouped)
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
  const { listId, grouped } = shown
  const ignored = useListDefinitionStore.getState().listDefinitions.find((d) => d.id === listId)?.ignoreLens === true
  return {
    kind: 'list',
    title: shown.label,
    description: shown.description,
    ...queueOfSections(shown.sections, grouped),
    lens: { ignored, requery: (ignoreLens) => listQueueNow(listId, tabId, grouped, ignoreLens) },
  }
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

/**
 * A predicate dialog's review: its tasks as the dialog lists them now (the
 * screen filter never narrowed them), with the lens switch off — a toggle
 * takes the tasks the lens keeps.
 */
function predicateReview(kind: ReviewSourceKind, title: string, dialog: TaskDialogPayload): ReviewPayload {
  const { description, source } = dialog
  if (source.kind !== 'predicate') return { kind, title, description, ids: [] }
  return { kind, title, description, ids: predicateQueue(source.predicate, true).ids, lens: predicateLens(source.predicate) }
}

/** A person's open tasks, as their task dialog lists them (Review with X…). */
export function personReview(person: Pick<Person, 'id' | 'name'>): ReviewPayload {
  const dialog = personTaskDialog(person)
  return predicateReview('person', dialog.title, dialog)
}

/** A tag's open tasks, as its task dialog lists them (Review #tag tasks…). */
export function tagReview(tag: Pick<Tag, 'id' | 'name'>): ReviewPayload {
  const dialog = tagTaskDialog(tag)
  return predicateReview('tag', dialog.title, dialog)
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
  if (personIds.length === 0) return { kind: 'people', title: `${people.length} people`, description: dialog.description, ids: [] }
  return predicateReview('people', `${people.length} people`, dialog)
}

/** `“A”`, `“A” and “B”`, `“A”, “B” and “C”`. */
function quotedTitles(titles: readonly string[]): string {
  const quoted = titles.map((t) => `“${t}”`)
  return quoted.length <= 1 ? quoted.join('') : `${quoted.slice(0, -1).join(', ')} and ${quoted.at(-1) ?? ''}`
}

/**
 * What closing the deck asks while tasks hold text not recorded yet:
 * `updates` — the titles of the tasks whose Status update line has text;
 * `nextDates` — those whose Next follow-up field has a date typed and not
 * set. The title counts both: `Discard the unrecorded update?` /
 * `Discard N unrecorded updates?`.
 */
export function unrecordedReviewPrompt(
  { updates, nextDates }: { updates: readonly string[]; nextDates: readonly string[] },
): { title: string; message: string } {
  const n = updates.length + nextDates.length
  const parts: string[] = []
  if (updates.length > 0) {
    const one = updates.length === 1
    parts.push(`${one ? 'the update typed for' : 'the updates typed for'} ${quotedTitles(updates)} ${one ? 'hasn’t' : 'haven’t'} been recorded`)
  }
  if (nextDates.length > 0) {
    const one = nextDates.length === 1
    parts.push(`${one ? 'a next follow-up date typed for' : 'the next follow-up dates typed for'} ${quotedTitles(nextDates)} ${one ? 'hasn’t' : 'haven’t'} been set`)
  }
  const sentence = parts.join(', and ')
  return {
    title: n === 1 ? 'Discard the unrecorded update?' : `Discard ${n} unrecorded updates?`,
    message: `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}. Nothing is marked followed up.`,
  }
}
