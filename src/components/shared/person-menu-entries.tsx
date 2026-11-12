import type { Person, Tag } from '../../models'
import { peopleReviewFilter, personReviewFilter, tagReviewFilter } from '../../services/review'
import { jumpToReview } from '../../services/review-jump'
import { personTaskDialog, tagTaskDialog } from '../../services/task-dialog'
import type { ReviewFilter } from '../../stores/list-widget-store'
import { useUIStore } from '../../stores/ui-store'
import { useDialogLayer } from './dialog-layer'
import { AtIcon, HashIcon, PencilIcon, ReviewIcon, TrashIcon } from './icons'
import type { MenuEntry, MenuItemEntry } from './MenuPopover'

/**
 * The one source of a person's (and a tag's) Review item (D26; widget
 * feedback 2B): the person menu (`EntityMenu` — a row's avatar, a picker's
 * person, a People group header) and the top bar's People filter footer
 * build it here, so it reads alike everywhere: **Review with X**; a tag's
 * **Review #tag tasks**; several people's **Review N people’s tasks** —
 * each a jump to a Review widget (`services/review-jump`). The check-ins
 * live only on the Review widget's field (decision 7). `entityMenuEntries`
 * is the whole person / tag menu built on them.
 */

type Named = Pick<Person, 'id' | 'name'>

/** What a menu in this place may offer. */
export interface EntityMenuOffers {
  /**
   * Show tasks: outside dialogs, or on the workspace's overlay tier (the
   * task dialog) — where the task dialog it opens can show above.
   */
  showTasks: boolean
  /** Review (a jump to a Review widget, `services/review-jump`): where Show tasks is. */
  review: boolean
}

/** What a person / tag menu rendered here may offer (by its dialog tier). */
export function useEntityMenuOffers(): EntityMenuOffers {
  const layer = useDialogLayer()
  const outside = layer == null || layer === 'overlay'
  return { showTasks: outside, review: outside }
}

export interface PersonMenuOptions {
  /** Offer the Review item. */
  review: boolean
  /** Runs first in the item's select (e.g. a picker closing). */
  before?: () => void
  /** Runs last in the item's select (e.g. the filter popovers closing). */
  after?: () => void
}

/** The Review item: a jump to a Review widget with `filter` (`jumpToReview`). */
function reviewItem(label: string, filter: () => ReviewFilter | null, opts: PersonMenuOptions): MenuItemEntry {
  return {
    kind: 'item',
    label,
    icon: <ReviewIcon />,
    onSelect: () => {
      opts.before?.()
      void jumpToReview(filter())
      opts.after?.()
    },
  }
}

/** `Review with X`: a jump to a Review widget, its filter `@X`. */
export function personReviewLabel(name: string): string {
  return `Review with ${name}`
}

/** A person's item: Review with X (when `review`). */
export function personMenuEntries(person: Named, opts: PersonMenuOptions): MenuItemEntry[] {
  const id = person.id
  if (id == null || !opts.review) return []
  return [reviewItem(personReviewLabel(person.name), () => personReviewFilter({ id }), opts)]
}

/** A tag's item: Review #tag tasks (when `review`). */
export function tagMenuEntries(tag: Pick<Tag, 'id' | 'name'>, opts: PersonMenuOptions): MenuItemEntry[] {
  const id = tag.id
  if (id == null || !opts.review) return []
  return [reviewItem(`Review #${tag.name} tasks`, () => tagReviewFilter({ id }), opts)]
}

/**
 * Several people's item (the People filter footer): one person's is
 * `personMenuEntries`; more get Review N people’s tasks (`@A or @B`).
 */
export function peopleMenuEntries(people: readonly Named[], opts: PersonMenuOptions): MenuItemEntry[] {
  const [only] = people
  if (!only || !opts.review) return []
  if (people.length === 1) return personMenuEntries(only, opts)
  return [reviewItem(`Review ${people.length} people’s tasks`, () => peopleReviewFilter(people), opts)]
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
  /** Runs before Show tasks or Review acts (a picker closes itself). */
  onShowTasks?: () => void
}

/**
 * One person's or tag's menu: a person's Review with X
 * (`personMenuEntries`) — a tag's Review #tag tasks (`tagMenuEntries`) —,
 * then Show tasks (the task dialog of their open tasks) · Edit… (its
 * editor, opened on it) · Delete… (the confirm with its task count;
 * undoable). Review and Show tasks only where `options` offers them. The
 * editor and the confirm open above everything (`EntityActionHost`).
 */
export function entityMenuEntries(e: MenuEntity, options: EntityMenuOptions): MenuEntry[] {
  const ui = useUIStore.getState()
  const id = e.entity.id
  if (id == null) return []
  const { onShowTasks } = options
  const own = e.kind === 'person'
    ? personMenuEntries(e.entity, { review: options.review, before: onShowTasks })
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
