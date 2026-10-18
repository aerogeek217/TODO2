import { describe, it, expect } from 'vitest'
import { escapeHtml, unescapeHtml } from '../../utils/html'

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe('&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;')
  })

  it('escapes an existing entity again (text is text)', () => {
    expect(escapeHtml('&amp;')).toBe('&amp;amp;')
  })
})

describe('unescapeHtml', () => {
  it('reverses escapeHtml', () => {
    const s = `<b class="c">Dana's Q&A</b> &amp; &#39;`
    expect(unescapeHtml(escapeHtml(s))).toBe(s)
  })

  it('decodes one level only', () => {
    expect(unescapeHtml('&amp;lt;')).toBe('&lt;')
  })
})
