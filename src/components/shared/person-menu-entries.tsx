import { useIsMobile } from '../../hooks/use-is-mobile'
import type { Person, Tag } from '../../models'
import { sendPersonCheckin } from '../../services/checkin-email/person-checkin'
import { openReview, peopleReview, personReview, tagReview, type ReviewPayload } from '../../services/review'
import { personTaskDialog, tagTaskDialog } from '../../services/task-dialog'
import { useReviewStore } from '../../stores/review-store'
import { useUIStore } from '../../stores/ui-store'
import { useDialogLayer } from './dialog-layer'
import { AtIcon, EnvelopeIcon, HashIcon, PencilIcon, ReplyIcon, ReviewIcon, TrashIcon } from './icons'
import type { MenuEntry, MenuItemEntry } from './MenuPopover'

/**
 * The one source of a person's (and a tag's) Review and check-in items
 * (D26): the person menu (`EntityMenu` — a row's avatar, a picker's
 * person, a People group header), the envelope (`PersonCheckinMenu`) and
 * the top bar's People filter footer build them here, so they read alike
 * everywhere: **Review with X…** · **Email check-in to X** · **Paste reply
 * from X…**; a tag's **Review #tag tasks…**; several people's **Review N
 * people’s tasks…** · **Email check-in to N people…**. `entityMenuEntries`
 * is the whole person / tag menu built on them.
 */

type Named = Pick<Person, 'id' | 'name'>

/** What a menu in this place may offer. */
export interface EntityMenuOffers {
  /**
   * Show tasks and the check-ins: outside dialogs, or on the workspace's
   * overlay tier (the task dialog, the review deck) — where the dialogs
   * they open can show above.
   */
  showTasks: boolean
  checkins: boolean
  /** Review: where Show tasks is, but not on a phone (the deck is desktop only) nor while the deck is open. */
  review: boolean
}

/** What a person / tag menu rendered here may offer (its dialog tier, the phone, the open deck). */
export function useEntityMenuOffers(): EntityMenuOffers {
  const layer = useDialogLayer()
  const isMobile = useIsMobile()
  const deckOpen = useReviewStore((s) => s.open)
  const outside = layer == null || layer === 'overlay'
  return { showTasks: outside, checkins: outside, review: outside && !isMobile && !deckOpen }
}

export interface PersonMenuOptions {
  /** Offer the Review item. */
  review: boolean
  /** Offer the two check-in items (default true). */
  checkins?: boolean
  /** Runs first in each item's select (e.g. the focus back to the envelope, a picker closing). */
  before?: () => void
  /** Runs last in each item's select (e.g. the filter popovers closing). */
  after?: () => void
}

/** A select handler: `before`, the action, `after` — all inside the click, so a clipboard write keeps the gesture. */
function handler(opts: PersonMenuOptions, act: () => void): () => void {
  return () => {
    opts.before?.()
    act()
    opts.after?.()
  }
}

/** The Review item of `payload`: disabled (with why) when it has no open task. */
function reviewItem(label: string, payload: () => ReviewPayload, opts: PersonMenuOptions): MenuItemEntry {
  const empty = payload().ids.length === 0
  return {
    kind: 'item',
    label,
    icon: <ReviewIcon />,
    ...(empty ? { disabled: true, title: 'No open tasks' } : {}),
    onSelect: handler(opts, () => { openReview(payload()) }),
  }
}

/** `Review with X…`: the person's open tasks in the review deck, as their task dialog lists them. */
export function personReviewLabel(name: string): string {
  return `Review with ${name}…`
}

/** `Email check-in to X`: the one-click send. */
export function personCheckinLabel(name: string): string {
  return `Email check-in to ${name}`
}

/** `Paste reply from X…`: the check-in reply import, for this person. */
export function personReplyLabel(name: string): string {
  return `Paste reply from ${name}…`
}

/**
 * A person's items: Review with X… (when `review`), Email check-in to X
 * (`sendPersonCheckin`, run inside the select — the clipboard needs the
 * gesture), Paste reply from X… (the reply import; it reads the person
 * from the reply's footer, else takes this one).
 */
export function personMenuEntries(person: Named, opts: PersonMenuOptions): MenuItemEntry[] {
  const id = person.id
  if (id == null) return []
  const entries: MenuItemEntry[] = []
  if (opts.review) entries.push(reviewItem(personReviewLabel(person.name), () => personReview(person), opts))
  if (opts.checkins !== false) {
    entries.push(
      { kind: 'item', label: personCheckinLabel(person.name), icon: <EnvelopeIcon />, onSelect: handler(opts, () => { void sendPersonCheckin(id) }) },
      {
        kind: 'item',
        label: personReplyLabel(person.name),
        icon: <ReplyIcon />,
        onSelect: handler(opts, () => useUIStore.getState().openCheckinImport({ personId: id })),
      },
    )
  }
  return entries
}

/** A tag's item: Review #tag tasks… (when `review`). */
export function tagMenuEntries(tag: Pick<Tag, 'id' | 'name'>, opts: PersonMenuOptions): MenuItemEntry[] {
  if (tag.id == null || !opts.review) return []
  return [reviewItem(`Review #${tag.name} tasks…`, () => tagReview(tag), opts)]
}

/**
 * Several people's items (the People filter footer): one person's are
 * `personMenuEntries`; more get Review N people’s tasks… (their open tasks
 * together, each once) and Email check-in to N people… (the check-in
 * dialog with exactly them ticked; it has its own Paste a reply…).
 */
export function peopleMenuEntries(people: readonly Named[], opts: PersonMenuOptions): MenuItemEntry[] {
  const [only] = people
  if (!only) return []
  if (people.length === 1) return personMenuEntries(only, opts)
  const ids = people.flatMap((p) => (p.id != null ? [p.id] : []))
  const entries: MenuItemEntry[] = []
  if (opts.review) entries.push(reviewItem(`Review ${people.length} people’s tasks…`, () => peopleReview(people), opts))
  if (opts.checkins !== false) {
    entries.push({
      kind: 'item',
      label: `Email check-in to ${people.length} people…`,
      icon: <EnvelopeIcon />,
      onSelect: handler(opts, () => useUIStore.getState().openCheckinDialog(ids)),
    })
  }
  return entries
}

/** A person or a tag the menu is for (`id` and `name` are all it reads). */
export type MenuEntity =
  | { kind: 'person'; entity: Pick<Person, 'id' | 'name'> }
  | { kind: 'tag'; entity: Pick<Tag, 'id' | 'name'> }

/** `@Alice` / `#work`. */
export function entityName(e: MenuEntity): string {
  return e.kind === 'person' ? `@${e.entity.name}` : `#${e.entity.name}`
}

/** What the person / tag menu offers here (`useEntityMenuOffers`), and who hears before an item opens a dialog. */
export interface EntityMenuOptions extends EntityMenuOffers {
  /** Runs before Show tasks, Review or a check-in item acts (a picker closes itself). */
  onShowTasks?: () => void
}

/**
 * One person's or tag's menu: a person's Review with X… · Email check-in
 * to X · Paste reply from X… (`personMenuEntries`) — a tag's Review #tag
 * tasks… (`tagMenuEntries`) —, then Show tasks (the task dialog of their
 * open tasks) · Edit… (its editor, opened on it) · Delete… (the confirm
 * with its task count; undoable). Each of the first group, and Show tasks,
 * only where `options` offers it. The editor and the confirm open above
 * everything (`EntityActionHost`).
 */
export function entityMenuEntries(e: MenuEntity, options: EntityMenuOptions): MenuEntry[] {
  const ui = useUIStore.getState()
  const id = e.entity.id
  if (id == null) return []
  const { onShowTasks } = options
  const own = e.kind === 'person'
    ? personMenuEntries(e.entity, { review: options.review, checkins: options.checkins, before: onShowTasks })
    : tagMenuEntries(e.entity, { review: options.review, before: onShowTasks })
  const show: MenuEntry[] = options.showTasks
    ? [{
        kind: 'item',
        label: 'Show tasks',
        icon: e.kind === 'person' ? <AtIcon /> : <HashIcon />,
        onSelect: () => {
          onShowTasks?.()
          ui.showTaskDialog(e.kind === 'person' ? personTaskDialog(e.entity) : tagTaskDialog(e.entity))
        },
      }]
    : []
  return [
    ...own,
    ...(own.length > 0 ? [{ kind: 'separator' } as const] : []),
    ...show,
    { kind: 'item', label: 'Edit…', icon: <PencilIcon />, onSelect: () => ui.openEntityAction({ kind: e.kind, id, action: 'edit' }) },
    { kind: 'separator' },
    { kind: 'item', label: 'Delete…', icon: <TrashIcon />, danger: true, onSelect: () => ui.openEntityAction({ kind: e.kind, id, action: 'delete' }) },
  ]
}
