import { describe, expect, it } from 'vitest'
import { checkOfflineFile, scriptHash, splitHtml, unusedInertTexts } from '../../../scripts/offline-file'

/**
 * The offline build's reading of its own file (`scripts/offline-file.ts`):
 * script elements found as the HTML parser finds them, the CSP hash of an
 * inline script's text as the browser computes it, and the egress check.
 */

const ICON = '<link rel="icon" type="image/png" sizes="192x192" href="data:image/png;base64,iVBORw0KGgo//XMLHttpRequest+WebSocket//AAAANSUhEUg==" />'

/**
 * The app's script in the fixtures: inert library texts, a `<script>` string,
 * Dexie's `open()`, React Router's `fetch` and `"//"`, `window.opener`, React
 * DOM's unused resource-hint code, a word that starts like a rel value.
 */
const APP = [
  'var e=document.createElementNS(`http://www.w3.org/2000/svg`,`svg`);',
  'var t=`https://react.dev/errors/`+n;',
  'var u=new URL(`http://localhost`);',
  'var k=`idb://${db}/${table}`;',
  'var s=`<script>`;',
  'console.warn(`Dexie: Workaround for Chrome UnknownError on open()`);t.open().then(r);',
  'var f={navigate:De,fetch:Le};r=e.fetch;',
  'throw Error(`must be used within a data router.  See https://reactrouter.com/en/main/routers/picking-a-router.`)',
  ';if(e.startsWith(`//`))return!0;var w=window.opener;',
  'function Lm(e){Nm.D(e),Im(`dns-prefetch`,e,null)}function Rm(e,t){Nm.C(e,t),Im(`preconnect`,e,t)}',
  'var q=`prefetching`;',
].join('')

/** A file shaped like the built one: `parts` override its pieces. */
function offlineFile(parts: { csp?: string; head?: string; beforeCsp?: string; script?: string; body?: string; referrer?: boolean } = {}): string {
  const script = parts.script ?? APP
  const csp = parts.csp ?? `default-src 'none'; script-src ${scriptHash(script)}; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'`
  return [
    '<!doctype html>',
    '<html lang="en">',
    '  <head>',
    '    <meta charset="UTF-8" />',
    '    <!-- The policy applies only to what loads after it: keep it first. -->',
    parts.beforeCsp ?? '',
    `    <meta http-equiv="Content-Security-Policy" content="${csp}" />`,
    parts.referrer === false ? '' : '    <meta name="referrer" content="no-referrer" />',
    `    ${ICON}`,
    '    <title>TODO2</title>',
    `    <script type="module" crossorigin>${script}</script>`,
    `    <style rel="stylesheet" crossorigin>.cm-tab{background-image:url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"></svg>')}</style>`,
    parts.head ?? '',
    '  </head>',
    `  <body><div id="root"></div>${parts.body ?? ''}</body>`,
    '</html>',
  ].join('\n')
}

describe('checkOfflineFile', () => {
  it('passes a file shaped like the built one: inert URLs and texts, base64 noise, a <script> in a string', () => {
    expect(checkOfflineFile(offlineFile())).toEqual([])
  })

  it('fails a second script, or one loaded from a file', () => {
    expect(checkOfflineFile(offlineFile({ body: '<script>x()</script>' }))).toContain('holds 2 <script> elements, not one')
    expect(checkOfflineFile(offlineFile({ head: '<script src="./extra.js"></script>' }))).toEqual(expect.arrayContaining([
      'loads a script: <script src="./extra.js">',
    ]))
  })

  it("fails a CSP that isn't deny by default, names 'self' / a host / a scheme, or allows script inline", () => {
    const base = `script-src ${scriptHash(APP)}; base-uri 'none'; form-action 'none'`
    expect(checkOfflineFile(offlineFile({ csp: `default-src 'self'; ${base}` }))).toEqual(["CSP: default-src isn't 'none'", "CSP: default-src allows 'self'"])
    expect(checkOfflineFile(offlineFile({ csp: `default-src 'none'; ${base}; img-src 'self' data:` }))).toEqual(["CSP: img-src allows 'self'"])
    expect(checkOfflineFile(offlineFile({ csp: `default-src 'none'; ${base}; font-src https://fonts.gstatic.com` }))).toEqual([
      'CSP: font-src allows https://fonts.gstatic.com',
      expect.stringMatching(/^holds a URL not in INERT_URLS: https:\/\/fonts\.gstatic\.com /),
    ])
    expect(checkOfflineFile(offlineFile({ csp: `default-src 'none'; ${base}; connect-src file:` }))).toEqual(['CSP: connect-src allows file:'])
    expect(checkOfflineFile(offlineFile({ csp: `default-src 'none'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'` }))).toEqual([
      "CSP: script-src allows 'unsafe-inline'",
      "CSP: script-src isn't the hash of the inline script alone",
    ])
    expect(checkOfflineFile(offlineFile({ csp: `default-src 'none'; script-src ${scriptHash(APP)}` }))).toEqual([
      "CSP: base-uri isn't 'none'",
      "CSP: form-action isn't 'none'",
    ])
  })

  it("fails a script-src hash that isn't the script's", () => {
    const csp = `default-src 'none'; script-src ${scriptHash(`${APP};`)}; base-uri 'none'; form-action 'none'`
    expect(checkOfflineFile(offlineFile({ csp }))).toEqual(["CSP: script-src isn't the hash of the inline script alone"])
  })

  it('fails anything before the CSP, a second CSP, and a missing referrer policy', () => {
    expect(checkOfflineFile(offlineFile({ beforeCsp: ICON }))).toEqual([`has markup before its CSP <meta>: ${ICON.slice(0, 120)}…`])
    expect(checkOfflineFile(offlineFile({ head: `<meta http-equiv="Content-Security-Policy" content="default-src *" />` }))).toEqual([
      'holds 2 CSP <meta> elements, not one',
    ])
    expect(checkOfflineFile(offlineFile({ referrer: false }))).toEqual(['has no <meta name="referrer" content="no-referrer">'])
  })

  it('fails markup that loads: a link that is not a data: icon, an element that fetches, a refresh', () => {
    expect(checkOfflineFile(offlineFile({ head: '<link rel="preconnect" href="https://fonts.googleapis.com">' }))).toEqual(expect.arrayContaining([
      'has a <link> that isn\'t a data: icon: <link rel="preconnect" href="https://fonts.googleapis.com">',
    ]))
    expect(checkOfflineFile(offlineFile({ head: '<link rel="icon" href="./favicon.svg" />' }))).toEqual([
      'has a <link> that isn\'t a data: icon: <link rel="icon" href="./favicon.svg" />',
    ])
    expect(checkOfflineFile(offlineFile({ body: '<img src="data:image/gif;base64,R0lG">' }))).toEqual(['has a <img> element: <img src="data:image/gif;base64,R0lG">'])
    expect(checkOfflineFile(offlineFile({ head: '<base href="./">' }))).toEqual(['has a <base> element: <base href="./">'])
    expect(checkOfflineFile(offlineFile({ head: '<meta http-equiv="refresh" content="0">' }))).toEqual(['has a <meta http-equiv="refresh">'])
  })

  it.each([
    ['fetch()', 'fetch(`./x`)'],
    ['fetch()', 'window.fetch (u)'],
    ['XMLHttpRequest', 'new XMLHttpRequest'],
    ['WebSocket', 'new WebSocket(u)'],
    ['EventSource', 'new EventSource(u)'],
    ['navigator.sendBeacon', 'navigator.sendBeacon(u,d)'],
    ['WebRTC', 'new RTCPeerConnection(c)'],
    ['WebTransport', 'new WebTransport(u)'],
    ['a worker', 'new Worker(u)'],
    ['a worker', 'new SharedWorker(u)'],
    ['a service worker', 'navigator.serviceWorker.register(u)'],
    ['importScripts', 'importScripts(u)'],
    ['window.open', 'window.open(u)'],
    ['window.open', 'open(u,`_blank`)'],
    ['window.open', 'const o=window.open'],
    ['window.open', 'globalThis.open.call(globalThis,u)'],
    ['window.open', 'self["open"](u)'],
    ['a resource hint', 'e.innerHTML=`<link rel="dns-prefetch" href="${h}">`'],
    ['a resource hint', 'l.setAttribute(`rel`,`preconnect`)'],
    ['a resource hint', 'h("dns-prefetch",u)'],
    ['a resource hint', "x={rel:'modulepreload',href:u}"],
    ['a resource hint', 'l.relList.add(`preload`)'],
    ['a resource hint', 'Im(`prefetch`,u,null)'],
    ['a resource hint', 'Im(`prerender`,u)'],
    ["React DOM's resource hints", 'Mr.preconnect(h)'],
    ['speculation rules', 's.type=`speculationrules`'],
  ])('fails %s in the code: %s', (name, code) => {
    const script = `${APP}${code};`
    const csp = `default-src 'none'; script-src ${scriptHash(script)}; base-uri 'none'; form-action 'none'`
    const problems = checkOfflineFile(offlineFile({ script, csp }))
    // A rel value in markup in a string is both a `rel=` and a quoted value: one hint, said twice.
    expect(problems).toHaveLength(code.includes('rel="') ? 2 : 1)
    for (const p of problems) expect(p).toMatch(new RegExp(`^uses ${name.replace(/[.()]/g, '\\$&')}: …`))
  })

  it.each([
    ['https://example.com/beacon', 'img.src=`https://example.com/beacon`'],
    ['http://localhost:8080/x', 'u=`http://localhost:8080/x`'],
    ['ws://host/socket', 'u=`ws://host/socket`'],
    ['file://server/share/x.json', 'u=`file://server/share/x.json`'],
    ['//cdn.example.com/lib.js', 'u="//cdn.example.com/lib.js"'],
    ['//fileserver/share/x.json', 'u="//fileserver/share/x.json"'],
    ['//fileserver', 'u=`//fileserver`'],
    ['//[::1]/x', "u='//[::1]/x'"],
  ])('fails a URL not on the inert list: %s', (url, code) => {
    const script = `${APP}${code};`
    const csp = `default-src 'none'; script-src ${scriptHash(script)}; base-uri 'none'; form-action 'none'`
    const problems = checkOfflineFile(offlineFile({ script, csp }))
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(new RegExp(`^holds a URL not in INERT_URLS: ${url.replace(/[.()/[\]]/g, '\\$&')} \\(…`))
  })

  it('reads a regex with escaped slashes as no URL', () => {
    const script = `${APP}if(/^(https?:\\/\\/|mailto:)/.test(r)||/\\/\\/x/.test(r))r=r.replace(/\\//g,"%2F");`
    const csp = `default-src 'none'; script-src ${scriptHash(script)}; base-uri 'none'; form-action 'none'`
    expect(checkOfflineFile(offlineFile({ script, csp }))).toEqual([])
  })
})

describe('unusedInertTexts', () => {
  it('names the allowlist entries the file no longer holds', () => {
    const unused = unusedInertTexts(offlineFile())
    expect(unused).toContain('http://bit.ly/2kdckMn')
    expect(unused).not.toContain('http://www.w3.org/2000/svg')
    expect(unused).not.toContain('Workaround for Chrome UnknownError on open()')
    expect(unused).not.toContain('idb:')
  })
})

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
