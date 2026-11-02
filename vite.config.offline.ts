import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { viteSingleFile } from 'vite-plugin-singlefile'

if (existsSync(resolve(import.meta.dirname, 'public/node_modules'))) {
  throw new Error(
    'public/node_modules/ exists — Vite would copy 230MB of node_modules into\n' +
    'dist/. Delete public/node_modules/ and retry. (See vite.config.ts.)'
  )
}

// Fix the built HTML for file:// compatibility:
// 1. Remove type="module" (blocked on file://)
// 2. Move script to end of body (so #root exists when it runs)
// 3. Make paths relative
// Runs after `viteSingleFile`'s own `order: 'post'` bundle step (listed
// after it), so a script it already inlined — an inline module, which
// file:// allows — is left as it is; only an external one is rewritten.
function fileProtocolCompat(): Plugin {
  return {
    name: 'file-protocol-compat',
    enforce: 'post',
    generateBundle: { order: 'post', handler(_, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type === 'asset' && file.fileName.endsWith('.html')) {
          let html = file.source as string

          // Extract the module script tag
          const scriptMatch = html.match(/<script type="module" crossorigin src="([^"]+)"><\/script>/)
          if (scriptMatch) {
            // Remove from head
            html = html.replace(scriptMatch[0], '')
            // Add as regular script before </body>
            html = html.replace('</body>', `  <script src="${scriptMatch[1]}"></script>\n  </body>`)
          }

          // Fix crossorigin on stylesheet
          html = html.replace(/<link rel="stylesheet" crossorigin href="/g, '<link rel="stylesheet" href="')

          file.source = html
        }
      }
    } },
  }
}

// The offline file's Content-Security-Policy: deny by default. The file is
// opened from disk, where 'self' would admit every file: URL — a UNC path
// (`file://host/share/…`, an SMB request) among them — so no directive names
// 'self' and each allows only what the file itself carries. The sync file,
// imports and exports go through the File System Access API, file inputs and
// downloads, which no fetch directive governs.
const OFFLINE_CSP = [
  "default-src 'none'",
  // The one inline script (the whole app).
  "script-src 'unsafe-inline'",
  // The built CSS is one inline <style>; React and CodeMirror set styles at run time.
  "style-src 'unsafe-inline'",
  // The embedded icons and the data: images in styles (the notes text cursor, CodeMirror's tab arrow).
  'img-src data:',
  // The embedded fonts.
  'font-src data:',
  "connect-src 'none'",
  // The check-in preview is a sandboxed srcdoc frame, which fetches nothing.
  "frame-src 'none'",
  "object-src 'none'",
  "worker-src 'none'",
  "media-src 'none'",
  "manifest-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

const CSP_META = /<meta http-equiv="Content-Security-Policy" content="[^"]*" \/>/g

// Puts the offline policy in place of index.html's (which dev and the online
// build use), and adds the file's other request guards beside it: no
// Referer on anything (a link the user follows, the mail app's mailto:), no
// DNS prefetch of link hosts (the CSP doesn't cover it).
function offlineCsp(): Plugin {
  return {
    name: 'offline-csp',
    transformIndexHtml(html) {
      const metas = html.match(CSP_META) ?? []
      if (metas.length !== 1) throw new Error(`offline build: index.html should hold one CSP <meta>, found ${metas.length}`)
      return html.replace(CSP_META, [
        `<meta http-equiv="Content-Security-Policy" content="${OFFLINE_CSP}" />`,
        '<meta name="referrer" content="no-referrer" />',
        '<meta http-equiv="x-dns-prefetch-control" content="off" />',
      ].join('\n    '))
    },
  }
}

// The single file is opened from disk (often as an app window from a
// desktop shortcut), where `./favicon.svg` and the other files next to
// index.html aren't there: its icons go in as data: URLs (the CSP's
// `img-src` allows data:) — the SVG, the .ico's 16–64 px bitmaps and the
// 192 px PNG, so the window and the taskbar each find a size to use. The
// manifest link goes: a file:// manifest can't load.
const ICON_LINKS = [
  '<link rel="icon" type="image/svg+xml" href="./favicon.svg" />',
  '<link rel="icon" type="image/png" sizes="192x192" href="./favicon-192.png" />',
  '<link rel="manifest" href="./manifest.json" />',
]

function dataUrl(file: string, type: string): string {
  return `data:${type};base64,${readFileSync(resolve(import.meta.dirname, 'public', file)).toString('base64')}`
}

function offlineIcons(): Plugin {
  return {
    name: 'offline-icons',
    transformIndexHtml(html) {
      for (const link of ICON_LINKS) {
        if (!html.includes(link)) throw new Error(`offline build: index.html no longer contains ${JSON.stringify(link)}`)
      }
      const [svg, png, manifest] = ICON_LINKS as [string, string, string]
      return html
        .replace(svg, [
          `<link rel="icon" type="image/svg+xml" href="${dataUrl('favicon.svg', 'image/svg+xml')}" />`,
          `<link rel="icon" type="image/x-icon" sizes="16x16 32x32 48x48 64x64" href="${dataUrl('favicon.ico', 'image/x-icon')}" />`,
        ].join('\n    '))
        .replace(png, `<link rel="icon" type="image/png" sizes="192x192" href="${dataUrl('favicon-192.png', 'image/png')}" />`)
        .replace(manifest, '')
    },
  }
}

// Rename output from index.html to todo2.html
function renameToTodo2(): Plugin {
  return {
    name: 'rename-to-todo2',
    enforce: 'post',
    generateBundle(_, bundle) {
      const indexHtml = bundle['index.html']
      if (indexHtml) {
        indexHtml.fileName = 'todo2.html'
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), viteSingleFile(), offlineCsp(), offlineIcons(), fileProtocolCompat(), renameToTodo2()],
  base: './',
  build: {
    emptyOutDir: false,
    cssCodeSplit: false,
    modulePreload: false,
    rolldownOptions: {
      // viteSingleFile checks every CSP <meta> in the finished HTML, and
      // the inlined script holds one as text (the check-in preview frame's
      // `default-src 'none'`), so it warns that inline scripts are blocked.
      // They aren't: `offlineCsp` keeps 'unsafe-inline' in the page's CSP,
      // and `e2e/built-csp.spec.ts` runs this build with no CSP violation.
      onLog(level, log, handler) {
        if (log.plugin === 'vite:singlefile' && log.message.includes('does not allow inline <script> code')) return
        handler(level, log)
      },
    },
  },
  // Override import.meta properties for single-file build compatibility.
  // import.meta.url: Must be empty string because the built file runs from file:// protocol
  //   where import.meta.url would be an absolute file path, breaking relative asset resolution.
  // import.meta.env: Must be statically replaced so it works without Vite's dev server runtime.
  define: {
    'import.meta.url': JSON.stringify(''),
    'import.meta.env': JSON.stringify({ MODE: 'production', PROD: true, DEV: false }),
  },
})
