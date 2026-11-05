import { describe, it, expect } from 'vitest'
import { collapseWhitespace, plainLine, splitEdgeSpace } from '../../utils/text'
import { expectWithin } from '../timing'

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

describe('splitEdgeSpace', () => {
  it('splits leading and trailing whitespace off the rest; all-space text is all lead', () => {
    expect(splitEdgeSpace('  a b \n')).toEqual({ lead: '  ', core: 'a b', trail: ' \n' })
    expect(splitEdgeSpace('word')).toEqual({ lead: '', core: 'word', trail: '' })
    expect(splitEdgeSpace(' \t ')).toEqual({ lead: ' \t ', core: '', trail: '' })
    expect(splitEdgeSpace('')).toEqual({ lead: '', core: '', trail: '' })
    expect(splitEdgeSpace(' x ')).toEqual({ lead: ' ', core: 'x', trail: ' ' })
  })

  it('stays fast on a long space run inside the text (a regex split was quadratic, cr31 L2)', () => {
    const text = `X${' '.repeat(400_000)}Y`
    expectWithin(200, () => expect(splitEdgeSpace(` ${text} `)).toEqual({ lead: ' ', core: text, trail: ' ' }))
  })
})
