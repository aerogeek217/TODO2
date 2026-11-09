import type { NumberConfig } from '../../../models/glance-widgets'
import {
  DEFAULT_NUMBER_GOAL,
  DEFAULT_NUMBER_OLDEST_BY,
  NUMBER_SHAPE_FIELD,
  NUMBER_SHAPE_FIELDS,
  type NumberShapeField,
  type NumberShow,
} from '../../../models/number-shapes'

/**
 * The editor's shape switch (D26 P6): a config holds its active shape's
 * field only, so a switch takes the old shape's field out — kept aside in
 * `stash` while the editor is open, so switching back brings it back — and
 * puts the new one's in: the stashed one, else its default.
 */

/** Each shape's field as last set in this editor session. */
export type ShapeStash = Partial<Pick<NumberConfig, NumberShapeField>>

/**
 * The patch that switches `config` to `show` (`undefined` takes a field
 * out, as `patchTabConfig` drops it), and the stash after it. A new field's
 * default: a share of every open task (no `of`), aged by the last
 * follow-up, at least 10 a week, one count of the Number's own filter,
 * name and colour, the layout's first list (`firstListId`; none without one).
 */
export function switchShape(
  config: NumberConfig,
  show: NumberShow,
  stash: ShapeStash,
  firstListId: number | undefined,
): { patch: Partial<NumberConfig>; stash: ShapeStash } {
  if (show === config.show) return { patch: {}, stash }
  const nextStash: ShapeStash = { ...stash }
  const patch: Partial<NumberConfig> = { show }
  for (const key of NUMBER_SHAPE_FIELDS) {
    if (config[key] !== undefined) {
      (nextStash as Record<string, unknown>)[key] = config[key]
      patch[key] = undefined
    }
  }
  const field = NUMBER_SHAPE_FIELD[show]
  if (field) {
    const value = nextStash[field] ?? defaultField(field, config, firstListId)
    if (value !== undefined) (patch as Record<string, unknown>)[field] = value
  }
  return { patch, stash: nextStash }
}

function defaultField(field: NumberShapeField, config: NumberConfig, firstListId: number | undefined): NumberConfig[NumberShapeField] {
  switch (field) {
    case 'of': return undefined
    case 'oldestBy': return DEFAULT_NUMBER_OLDEST_BY
    case 'goal': return DEFAULT_NUMBER_GOAL
    case 'items': return [{ name: config.name, filter: config.filter, ...(config.color ? { color: config.color } : {}) }]
    case 'list': return firstListId != null ? { listDefinitionId: firstListId } : undefined
  }
}
