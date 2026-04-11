import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

// Fix the built HTML for file:// compatibility:
// 1. Remove type="module" (blocked on file://)
// 2. Move script to end of body (so #root exists when it runs)
// 3. Make paths relative
function fileProtocolCompat(): Plugin {
  return {
    name: 'file-protocol-compat',
    enforce: 'post',
    generateBundle(_, bundle) {
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
  plugins: [react(), viteSingleFile(), fileProtocolCompat(), renameToTodo2()],
  base: './',
  build: {
    emptyOutDir: false,
    cssCodeSplit: false,
    modulePreload: false,
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
