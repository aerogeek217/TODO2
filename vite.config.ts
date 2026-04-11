import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { dirname, resolve } from 'node:path'

// Inject Google Fonts CDN link and update CSP for online build
function cdnFonts(): Plugin {
  return {
    name: 'cdn-fonts',
    transformIndexHtml(html) {
      // Add Google Fonts preconnect + stylesheet link
      html = html.replace(
        '</head>',
        '    <link rel="preconnect" href="https://fonts.googleapis.com">\n' +
        '    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' +
        '    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400..700&display=swap" rel="stylesheet">\n' +
        '  </head>'
      )
      // Update CSP to allow Google Fonts
      html = html.replace(
        "font-src 'self'",
        "font-src 'self' https://fonts.gstatic.com"
      )
      html = html.replace(
        "style-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com"
      )
      return html
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
    ...(command === 'build' ? [cdnFonts(), swapFontsForCdn()] : []),
  ],
  base: './',
  server: {
    port: 5180,
  },
}))
