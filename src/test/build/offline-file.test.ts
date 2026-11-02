import { describe, expect, it } from 'vitest'
import { scriptHash, splitHtml } from '../../../scripts/offline-file'

/**
 * The offline build's reading of its own file (`scripts/offline-file.ts`):
 * script elements found as the HTML parser finds them, and the CSP hash of
 * an inline script's text as the browser computes it.
 */

describe('splitHtml', () => {
  it('finds the script elements, not a <script> written inside a script', () => {
    const html = [
      '<!doctype html><html><head><meta charset="UTF-8" />',
      '<script type="module" crossorigin>const a = `<script>`; const b = "<script src=x>"</script>',
      '<style>p::after { content: "<script>" }</style>',
      '</head><body><div id="root"></div></body></html>',
    ].join('\n')
    const { scripts, markup } = splitHtml(html)
    expect(scripts).toEqual([{ tag: '<script type="module" crossorigin>', text: 'const a = `<script>`; const b = "<script src=x>"' }])
    expect(markup).not.toContain('const a')
    expect(markup).not.toContain('content:')
    expect(markup).toContain('<script type="module" crossorigin></script>')
    expect(markup).toContain('<div id="root"></div>')
  })

  it('reads a commented-out script as markup taken out, and a <scripts> tag as another element', () => {
    const { scripts, markup } = splitHtml('<head><!-- <script src="x.js"></script> --><scripts></scripts><SCRIPT SRC="y.js"></SCRIPT></head>')
    expect(scripts).toEqual([{ tag: '<SCRIPT SRC="y.js">', text: '' }])
    expect(markup).toBe('<head><scripts></scripts><SCRIPT SRC="y.js"></SCRIPT></head>')
  })

  it('takes a script left open to the end of the file', () => {
    expect(splitHtml('<body><script>let x = 1').scripts).toEqual([{ tag: '<script>', text: 'let x = 1' }])
  })
})

describe('scriptHash', () => {
  it("is the CSP source of the text's sha256", () => {
    expect(scriptHash('console.log(1)')).toBe("'sha256-CihokcEcBW4atb/CW/XWsvWwbTjqwQlE9nj9ii5ww5M='")
  })

  it('hashes the text as parsed: CR LF and a lone CR read as LF, a NUL as U+FFFD', () => {
    const lf = "'sha256-fhj3NzEbLcOy8mndeDlrA1HxT7Zu+oefdoyyMYGIPHg='"
    expect(scriptHash('a\nb')).toBe(lf)
    expect(scriptHash('a\r\nb')).toBe(lf)
    expect(scriptHash('a\rb')).toBe(lf)
    expect(scriptHash('\0')).toBe("'sha256-g9VEzMIjwFfSv4DT8qMpgsMsPA244mdIINpQZHg/sJc='")
  })
})
