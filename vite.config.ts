import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

// Guard against a stray `public/node_modules/` shadowing real node_modules
// via Vite's static-file serving (see git log 2026-05-09 for the postmortem).
if (existsSync(resolve(import.meta.dirname, 'public/node_modules'))) {
  throw new Error(
    'public/node_modules/ exists — Vite will serve it instead of running the\n' +
    'transform pipeline, breaking dev mode (`__DEFINES__ is not defined`).\n' +
    'Delete public/node_modules/ and retry.'
  )
}

// The online build's policy, in place of index.html's (which dev keeps for
// the React refresh preamble, an inline script). The page loads its scripts,
// styles, fonts (`src/fonts`, as the offline file does) and icons from its
// own folder, and nothing from anywhere else.
const ONLINE_CSP = [
  "default-src 'none'",
  // Scripts from ./assets only, so no 'unsafe-inline' (`noInlineScripts`).
  "script-src 'self'",
  // React and CodeMirror set styles at run time.
  "style-src 'self' 'unsafe-inline'",
  // The icons, and the data: images in styles (the notes text cursor, CodeMirror's tab arrow).
  "img-src 'self' data:",
  "font-src 'self'",
  "manifest-src 'self'",
  // The app fetches nothing, but Vite's modulepreload polyfill fetches each
  // preloaded chunk in a browser without native modulepreload.
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

const CSP_META = /<meta http-equiv="Content-Security-Policy" content="[^"]*" \/>/g

// Online build: the tighter policy in place of index.html's.
function onlineCsp(): Plugin {
  return {
    name: 'online-csp',
    transformIndexHtml(html) {
      const metas = html.match(CSP_META) ?? []
      if (metas.length !== 1) throw new Error(`online build: index.html should hold one CSP <meta>, found ${metas.length}`)
      return html.replace(CSP_META, `<meta http-equiv="Content-Security-Policy" content="${ONLINE_CSP}" />`)
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

export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    ...(command === 'build' ? [onlineCsp(), noInlineScripts()] : []),
  ],
  base: './',
  server: {
    port: 5180,
  },
}))
