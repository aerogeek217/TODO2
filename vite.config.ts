import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

// Guard against a stray `public/node_modules/` shadowing real node_modules
// via Vite's static-file serving (see git log 2026-05-09 for the postmortem).
if (existsSync(resolve(import.meta.dirname, 'public/node_modules'))) {
  throw new Error(
    'public/node_modules/ exists — Vite will serve it instead of running the\n' +
    'transform pipeline, breaking dev mode (`__DEFINES__ is not defined`).\n' +
    'Delete public/node_modules/ and retry.'
  )
}

/** `html` with `from` replaced by `to`; throws when `from` isn't there, so a CSP edit can't silently stop applying. */
function replaceOnce(html: string, from: string, to: string): string {
  if (!html.includes(from)) throw new Error(`online build: index.html no longer contains ${JSON.stringify(from)}`)
  return html.replace(from, to)
}

// Online build: inject the Google Fonts CDN link and tighten the CSP. The
// built page loads its scripts from ./assets only, so `script-src` drops the
// 'unsafe-inline' that dev (React refresh preamble) and the offline single
// file (one inline script) need.
function cdnFonts(): Plugin {
  return {
    name: 'cdn-fonts',
    transformIndexHtml(html) {
      // Add Google Fonts preconnect + stylesheet link
      html = replaceOnce(
        html,
        '</head>',
        '    <link rel="preconnect" href="https://fonts.googleapis.com">\n' +
        '    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' +
        '    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400..700&display=swap" rel="stylesheet">\n' +
        '  </head>'
      )
      html = replaceOnce(html, "script-src 'self' 'unsafe-inline'", "script-src 'self'")
      // Allow Google Fonts
      html = replaceOnce(html, "font-src 'self'", "font-src 'self' https://fonts.gstatic.com")
      html = replaceOnce(html, "style-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com")
      return html
    },
  }
}

// Without 'unsafe-inline' an inline script would be blocked: fail the online
// build instead of shipping a page that doesn't start. `post`, so the built
// HTML is in the bundle by now.
function noInlineScripts(): Plugin {
  return {
    name: 'no-inline-scripts',
    enforce: 'post',
    generateBundle(_, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type !== 'asset' || !file.fileName.endsWith('.html')) continue
        const html = String(file.source)
        const inline = html.match(/<script(?![^>]*\ssrc=)[^>]*>/)
        if (inline) throw new Error(`online build: ${file.fileName} has an inline script (${inline[0]}), which its CSP blocks`)
      }
    },
  }
}

// Replace local font CSS with CDN stub — fonts come from Google Fonts in online build
function swapFontsForCdn(): Plugin {
  return {
    name: 'swap-fonts-cdn',
    enforce: 'pre',
    resolveId(source, importer) {
      if (/styles\/fonts\.css$/.test(source) && importer) {
        // Resolve fonts-cdn.css relative to the importer, normalized to forward slashes
        const dir = dirname(importer)
        return resolve(dir, source.replace('fonts.css', 'fonts-cdn.css')).replace(/\\/g, '/')
      }
    },
  }
}

export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    ...(command === 'build' ? [cdnFonts(), swapFontsForCdn(), noInlineScripts()] : []),
  ],
  base: './',
  server: {
    port: 5180,
  },
}))
