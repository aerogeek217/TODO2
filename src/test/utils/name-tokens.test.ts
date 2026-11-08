import { describe, expect, it } from 'vitest'
import { mentionToken, quoteText, readQuoted, statusToken, tagToken } from '../../utils/name-tokens'

describe('name tokens (cr33 M12)', () => {
  it('writes a name without " or a telling \\ as before (Quick Add and the search box read these)', () => {
    expect(mentionToken('Aisha')).toBe('@Aisha')
    expect(mentionToken('Ann Lee')).toBe('@"Ann Lee"')
    expect(tagToken('R&D')).toBe('#"R&D"')
    expect(tagToken('C:\\docs')).toBe('#"C:\\docs"')
    expect(statusToken('On Hold')).toBe('!"On Hold"')
  })

  it('escapes a " (and a \\ before one, another \\ or the end), and reads each back as itself', () => {
    for (const name of ['Ann "AJ" Lee', '"', 'a\\', 'a\\"b', 'a\\\\b', '\\\\', 'x\\y', '""', 'end\\\\']) {
      const quoted = quoteText(name)
      expect(readQuoted(quoted, 0)).toEqual({ value: name, close: quoted.length - 1 })
    }
    expect(mentionToken('Ann "AJ" Lee')).toBe('@"Ann \\"AJ\\" Lee"')
  })

  it('reads a quote that never closes to the end', () => {
    expect(readQuoted('"Ann \\"AJ', 0)).toEqual({ value: 'Ann "AJ', close: -1 })
  })
})
