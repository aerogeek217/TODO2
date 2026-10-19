import { describe, it, expect } from 'vitest'
import { collapseWhitespace, plainLine } from '../../utils/text'

describe('collapseWhitespace', () => {
  it('puts the text on one line: whitespace runs become one space, ends trimmed', () => {
    expect(collapseWhitespace('  a \n\t b  c  ')).toBe('a b c')
  })

  it('whitespace only → empty', () => {
    expect(collapseWhitespace(' \n\t ')).toBe('')
  })
})

describe('plainLine', () => {
  it('line breaks and control characters become spaces, bidi controls go, ends trimmed; other spacing kept', () => {
    expect(plainLine(' a\nb\u0000c  d e ')).toBe('a b c  d e')
    expect(plainLine('‮abc‬⁧d⁩‎؜')).toBe('abcd')
  })

  it('keeps emoji joiners and no-break spaces', () => {
    expect(plainLine('\u{1F469}‍\u{1F4BB} x')).toBe('\u{1F469}‍\u{1F4BB} x')
  })
})

