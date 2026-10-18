import { describe, it, expect } from 'vitest'
import { collapseWhitespace } from '../../utils/text'

describe('collapseWhitespace', () => {
  it('puts the text on one line: whitespace runs become one space, ends trimmed', () => {
    expect(collapseWhitespace('  a \n\t b  c  ')).toBe('a b c')
  })

  it('whitespace only → empty', () => {
    expect(collapseWhitespace(' \n\t ')).toBe('')
  })
})
