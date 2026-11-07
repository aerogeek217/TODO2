/**
 * How a typed token names a person, tag or status (Quick Add, the search
 * box, filter expressions): bare when the name allows it, else quoted.
 * A name holding `"` can't be quoted; it is written as it is.
 */

/** A name `@` (and `!`) takes bare, without quotes (`@José`): letters with their accents, digits and `_`. */
export const BARE_MENTION_NAME = /^[\p{L}\p{M}\p{N}_]+$/u

/** A tag name `#` takes bare, without quotes (`#q4`): the ASCII slug characters. */
export const BARE_TAG_NAME = /^[A-Za-z0-9_-]+$/

/** The token that names a person: `@Name`, or `@"First Last"` for a name that isn't bare. */
export function mentionToken(name: string): string {
  return BARE_MENTION_NAME.test(name) ? `@${name}` : `@"${name}"`
}

/** The token that names a status: `!Name`, or `!"On Hold"` for a name that isn't bare. */
export function statusToken(name: string): string {
  return BARE_MENTION_NAME.test(name) ? `!${name}` : `!"${name}"`
}

/** The token that names a tag: `#name`, or `#"name"` for a name that isn't a bare slug (`#"R&D"`). */
export function tagToken(name: string): string {
  return BARE_TAG_NAME.test(name) ? `#${name}` : `#"${name}"`
}
