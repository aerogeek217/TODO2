import { MARKER_KEYS, type MarkerKey } from '../models/filter-predicate'
import { dropDescription } from './eisenhower'
import { DEFAULT_HOT_RULE, hasMarker, isHot, type HotRule, type MarkerFields } from './hot'
import { HOT_COLOR, HOT_LABEL, MARKER_COLOR, MARKER_LABELS } from './markers'
import { URGENT_BY_DATE_HINT, urgentByDateSentence, type UrgentDueWithinDays } from './urgency'

/**
 * A list grouped by Priority: the groups Hot, Focus, Urgent and Important,
 * then the tasks with none of them under No priority. A task shows in every
 * group it belongs to (like tags or people). Hot follows the Hot rule (open
 * tasks only); Urgent is effective Urgent — flagged, or due within the
 * urgent range.
 */

/** A Priority group (No priority is the list's trailing ungrouped section). */
export type PriorityGroup = 'hot' | MarkerKey

/** The groups in list order. */
export const PRIORITY_GROUPS: readonly PriorityGroup[] = ['hot', ...MARKER_KEYS]

const KEY_PREFIX = 'priority-'

/** A group's section key (`priority-hot`, `priority-urgent`, …). */
export function priorityGroupKey(group: PriorityGroup): string {
  return `${KEY_PREFIX}${group}`
}

/** The group of a section key, or `null` for any other key. */
export function priorityGroupOfKey(key: string): PriorityGroup | null {
  if (!key.startsWith(KEY_PREFIX)) return null
  const group = key.slice(KEY_PREFIX.length)
  return (PRIORITY_GROUPS as readonly string[]).includes(group) ? group as PriorityGroup : null
}

/** The No priority section: its key and name. */
export const NO_PRIORITY_KEY = 'no-priority'
export const NO_PRIORITY_LABEL = 'No priority'

export const PRIORITY_GROUP_LABEL: Record<PriorityGroup, string> = {
  hot: HOT_LABEL,
  ...MARKER_LABELS,
}

/** Each group's colour: the flame for Hot, the marker's colour otherwise. */
export const PRIORITY_GROUP_COLOR: Record<PriorityGroup, string> = {
  hot: HOT_COLOR,
  ...MARKER_COLOR,
}

/** What the groups are worked out with. */
export interface PriorityGroupContext {
  today: Date
  /** The "due date makes a task urgent" range; `null` = flags only. */
  urgentRange: UrgentDueWithinDays
  /** The Hot rule; absent = the default rule. */
  hotRule?: HotRule
}

/** The groups `todo` belongs to, in list order (none = No priority). */
export function priorityGroupsOf(todo: MarkerFields, ctx: PriorityGroupContext): PriorityGroup[] {
  const out: PriorityGroup[] = []
  if (isHot(todo, ctx.hotRule ?? DEFAULT_HOT_RULE, ctx.today, ctx.urgentRange)) out.push('hot')
  for (const k of MARKER_KEYS) if (hasMarker(todo, k, ctx.today, ctx.urgentRange)) out.push(k)
  return out
}

/** The flags a Priority drop writes (only the ones that change). */
export interface PriorityFlags {
  urgent?: boolean
  important?: boolean
  focus?: boolean
}

/** A task as a Priority drop reads it. */
export type PriorityDropTask = MarkerFields & { id: number; title: string }

/**
 * What a row dragged from one Priority group to another does:
 * `write` — the flags to write (one undo step, `description` its words);
 * `refused` — nothing is written, and the refusal's lines say why (`Can’t
 * move to …` / why / what to change).
 */
export type PriorityDrop =
  | { kind: 'write'; flags: PriorityFlags; description: string }
  | { kind: 'refused'; lines: [string, string, string] }

/** `sourceKey` / `targetKey` → the group, `'none'` for No priority, `null` for an unknown key. */
function groupOf(key: string): PriorityGroup | 'none' | null {
  return key === NO_PRIORITY_KEY ? 'none' : priorityGroupOfKey(key)
}

/**
 * A Priority cross-group drop of `todo` from section `sourceKey` to
 * `targetKey` (the sections' keys; `NO_PRIORITY_KEY` = No priority):
 *
 * - into Focus / Urgent / Important: sets that flag, and clears the flag of
 *   the group it came from (a row dragged out of Hot or No priority clears
 *   nothing);
 * - into No priority: clears all three flags;
 * - into Hot: refused — Hot comes from the markers;
 * - refused, too, when the task would stay in the group it came from, or
 *   not land in No priority, because its due date keeps it urgent.
 *
 * `null` when nothing would change (same group, unknown keys, the flags
 * already as the drop would set them).
 */
export function resolvePriorityDrop(
  todo: PriorityDropTask,
  sourceKey: string,
  targetKey: string,
  ctx: PriorityGroupContext,
): PriorityDrop | null {
  const source = groupOf(sourceKey)
  const target = groupOf(targetKey)
  if (source == null || target == null || source === target) return null
  const targetName = target === 'none' ? NO_PRIORITY_LABEL : PRIORITY_GROUP_LABEL[target]
  const title = `Can’t move to ${targetName}`
  if (target === 'hot') {
    return {
      kind: 'refused',
      lines: [title, 'Hot comes from a task’s markers, by the Hot rule in Settings.', 'Drop it on Focus, Urgent or Important instead.'],
    }
  }

  const wanted: PriorityFlags = {}
  if (target === 'none') {
    for (const k of MARKER_KEYS) wanted[k] = false
  } else {
    wanted[target] = true
    if (source !== 'hot' && source !== 'none') wanted[source] = false
  }
  const after = { ...todo, ...wanted }
  const groups = priorityGroupsOf(after, ctx)
  const staysInSource = source !== 'hot' && source !== 'none' && groups.includes(source)
  const missesTarget = target === 'none' && groups.length > 0
  // With its flags as the drop sets them, only a due date can keep the task
  // urgent (and so in Urgent, or Hot by a rule line of Urgent alone).
  if (staysInSource || missesTarget) {
    const why = urgentByDateSentence(after, ctx.today, ctx.urgentRange) || `${todo.title} counts as urgent.`
    return { kind: 'refused', lines: [title, why, URGENT_BY_DATE_HINT] }
  }

  // Only the flags that change are written.
  const flags: PriorityFlags = {}
  for (const k of MARKER_KEYS) {
    const v = wanted[k]
    if (v !== undefined && (todo[k] === true) !== v) flags[k] = v
  }
  if (Object.keys(flags).length === 0) return null
  return { kind: 'write', flags, description: dropDescription([{ todoId: todo.id, ...flags }], () => todo.title) }
}
