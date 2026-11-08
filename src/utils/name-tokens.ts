/**
 * How a typed token names a person, tag or status (Quick Add, the search
 * box, filter expressions): bare when the name allows it, else quoted.
 * Inside the quotes a `"` is written `\"`, and a `\` that would read as an
 * escape (before a `"`, another `\` or the closing quote) `\\`, so every name
 * reads back as itself (`readQuoted`); a name without either is written as
 * it is (`@"Ann Lee"`, `#"C:\docs"`).
 */

/** A name `@` (and `!`) takes bare, without quotes (`@José`): letters with their accents, digits and `_`. */
export const BARE_MENTION_NAME = /^[\p{L}\p{M}\p{N}_]+$/u

/** A tag name `#` takes bare, without quotes (`#q4`): the ASCII slug characters. */
export const BARE_TAG_NAME = /^[A-Za-z0-9_-]+$/

/** `text` in double quotes, escaped as the module comment says: `"Ann \"AJ\" Lee"`. */
export function quoteText(text: string): string {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i)
    if (ch === '"') out += '\\"'
    else if (ch === '\\') {
      const next = text.charAt(i + 1)
      out += next === '"' || next === '\\' || next === '' ? '\\\\' : '\\'
    } else out += ch
  }
  return `"${out}"`
}

/**
 * The quoted text that starts at `open` (a `"`) in `text`: its value with
 * the escapes read (`\"` a quote, `\\` a backslash, any other `\` itself)
 * and the index of its closing quote, or -1 when it never closes (the value
 * then runs to the end).
 */
export function readQuoted(text: string, open: number): { value: string; close: number } {
  let value = ''
  for (let i = open + 1; i < text.length; i++) {
    const ch = text.charAt(i)
    if (ch === '"') return { value, close: i }
    const next = text.charAt(i + 1)
    if (ch === '\\' && (next === '"' || next === '\\')) {
      value += next
      i++
    } else value += ch
  }
  return { value, close: -1 }
}

/** The token that names a person: `@Name`, or `@"First Last"` for a name that isn't bare. */
export function mentionToken(name: string): string {
  return BARE_MENTION_NAME.test(name) ? `@${name}` : `@${quoteText(name)}`
}

/** The token that names a status: `!Name`, or `!"On Hold"` for a name that isn't bare. */
export function statusToken(name: string): string {
  return BARE_MENTION_NAME.test(name) ? `!${name}` : `!${quoteText(name)}`
}

/** The token that names a tag: `#name`, or `#"name"` for a name that isn't a bare slug (`#"R&D"`). */
export function tagToken(name: string): string {
  return BARE_TAG_NAME.test(name) ? `#${name}` : `#${quoteText(name)}`
}
