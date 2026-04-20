import type { Org } from '../models'

/**
 * Resolve a display color for a person from their org membership. Returns the
 * first assigned org's color (insertion order in `personOrgs`). When the
 * person has no org, no org with a color, or `personId` is missing, returns
 * `undefined` — callers decide the fallback (typically
 * `DEFAULT_ENTITY_COLOR`).
 *
 * `Person.color` was removed in Dexie v31; this helper replaces every
 * previously direct `person.color` read.
 */
export function resolvePersonColor(
  personId: number | undefined,
  personOrgMap: Map<number, number[]>,
  orgs: Org[],
): string | undefined {
  if (personId == null) return undefined
  const orgIds = personOrgMap.get(personId)
  if (!orgIds || orgIds.length === 0) return undefined
  for (const orgId of orgIds) {
    const org = orgs.find((o) => o.id === orgId)
    if (org?.color) return org.color
  }
  return undefined
}
