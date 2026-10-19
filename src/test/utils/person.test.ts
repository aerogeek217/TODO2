import { describe, it, expect } from 'vitest'
import { checkinAddress, generateInitials, isValidEmail, normalizeEmail, PERSON_EMAIL_MAX, withEmail } from '../../utils/person'

describe('generateInitials', () => {
  it('"John Doe" → "JD"', () => {
    expect(generateInitials('John Doe')).toBe('JD')
  })

  it('single word "Alice" → "A"', () => {
    expect(generateInitials('Alice')).toBe('A')
  })

  it('three words → 3 chars', () => {
    expect(generateInitials('John Michael Doe')).toBe('JMD')
  })

  it('four+ words truncates to 3 chars', () => {
    expect(generateInitials('John Michael David Doe')).toBe('JMD')
  })

  it('extra whitespace handled', () => {
    expect(generateInitials('  John   Doe  ')).toBe('JD')
  })

  it('empty string → ""', () => {
    expect(generateInitials('')).toBe('')
  })
})

describe('person email helpers', () => {
  it('normalizeEmail trims and turns empty into absent', () => {
    expect(normalizeEmail('  ann@example.com ')).toBe('ann@example.com')
    expect(normalizeEmail('   ')).toBeUndefined()
    expect(normalizeEmail('')).toBeUndefined()
    expect(normalizeEmail(undefined)).toBeUndefined()
    expect(normalizeEmail(null)).toBeUndefined()
  })

  it('isValidEmail accepts one plain address (trimmed)', () => {
    for (const ok of [
      'a@b.co', 'ann.lee+work@mail.example.com', '  ann@example.org  ', "o'neil@example.ie",
      'first_last-1@sub-domain.example.co.uk', 'josé@exemple.fr', 'x@1.2', 'a!#$%&*/=?^`{|}~@b.co',
    ]) {
      expect(isValidEmail(ok), ok).toBe(true)
    }
  })

  it('isValidEmail refuses anything that could add a recipient or is not an address', () => {
    for (const bad of [
      '', 'ann', 'ann@', 'ann@example', '@example.com', 'ann lee@example.com', 'ann@@example.com', 'ann@example.',
      'a@b.com,evil@x.com', 'a@b.com;evil@x.com', 'a,b@c.com', '"ann"@b.com', '<a@b.com>', 'Ann <a@b.com>',
      'a@b.com\r\nBcc: z@z.com', 'a\tb@c.com', 'a(b)@c.com', 'a@[1.2.3.4]', 'a\b@c.com', 'a:b@c.com',
      '.a@b.com', 'a.@b.com', 'a..b@c.com', 'a@-b.com', 'a@b-.com', 'a@b..com', 'a@b.com\u0000',
      `${'a'.repeat(PERSON_EMAIL_MAX - 4)}@b.co`,
    ]) {
      expect(isValidEmail(bad), JSON.stringify(bad)).toBe(false)
    }
    expect(isValidEmail(`${'a'.repeat(PERSON_EMAIL_MAX - 5)}@b.co`)).toBe(true)
  })

  it('withEmail sets the trimmed email or drops the key', () => {
    expect(withEmail({ name: 'Ann', email: 'old@x.io' }, ' new@x.io ')).toEqual({ name: 'Ann', email: 'new@x.io' })
    const cleared = withEmail({ name: 'Ann', email: 'old@x.io' }, '  ')
    expect(cleared).toEqual({ name: 'Ann' })
    expect('email' in cleared).toBe(false)
  })
})

describe('checkinAddress', () => {
  it('is the trimmed address when it is one valid address, else empty — never the name or the bad value', () => {
    expect(checkinAddress(' ada@example.com ')).toBe('ada@example.com')
    for (const bad of [undefined, '', '   ', 'Ada Lovelace', 'a@b.com,evil@x.com', '"Ada" <a@b.com>', 'a@b.com\r\nBcc: z@z.com']) {
      expect(checkinAddress(bad), JSON.stringify(bad)).toBe('')
    }
  })
})
