# Builds and the content security policy

The app has two builds: the online build (`vite.config.ts` → `dist/index.html`) and the offline single file (`vite.config.offline.ts` → `dist/todo2.html`). Each carries a content security policy, and the offline file **makes no network request**. Three things enforce that: the offline build's egress check (`scripts/offline-file`), ESLint's bans in `src/`, and `e2e/built-csp.spec.ts`, which audits the built file's requests through its main flows.

## The policy

- The CSP is a `<meta>` in `index.html`, first in its head after the charset. Each build puts its own policy in its place.
- Every build keeps `base-uri 'none'; form-action 'none'`.
- Dev keeps `'unsafe-inline'` for the React refresh preamble.
- `index.html` sends no Referer (a `no-referrer` meta), in dev and both builds.

## Online build

`dist/index.html` loads nothing from another host. Its fonts are the bundled `src/fonts/*.woff2`, as in the offline file. Its policy (`onlineCsp`):

- denies by default;
- allows scripts from `./assets` only, so no `script-src 'unsafe-inline'`. `noInlineScripts` fails the build on any inline script;
- allows `'self'` styles (and inline ones), fonts, icons and the manifest, and `data:` images;
- allows `connect-src 'self'`. The app fetches nothing, but Vite's modulepreload polyfill fetches each preloaded chunk in a browser without native modulepreload.

`e2e/built-csp.spec.ts` checks the policy whole, and that the page requests nothing outside its own folder.

## Offline single file

The file has its own policy (`offlineCsp`):

- It denies by default and names no `'self'`. On `file://`, `'self'` would admit any `file:` URL, a UNC share's among them.
- It allows inline styles, and `data:` images and fonts.
- It allows no connect, frame, object, worker, media or manifest source. The check-in dialog's message is a sandboxed `srcdoc` frame, which fetches nothing.
- It allows the file's one inline script by its sha256. `offlineScriptHash` is the build's last step and hashes the final text. The build fails on a second script or a mismatch.
- The file sends no Referer and turns DNS prefetch off.

The file works alone from disk:

- Its icons are `data:` URLs too (`offlineIcons`): the SVG, the .ico's 16–64 px bitmaps and the 192 px PNG.
- It has no manifest link.
- The sync file, imports and exports go through the File System Access API, file inputs and downloads, which no fetch directive governs.

## The egress check

The build then runs the egress check on the finished file (`offlineEgressCheck` → `scripts/offline-file.checkOfflineFile`). It fails on:

- anything that loads;
- a `<!--` in the script's text. After it, a `<script` would make the browser read past the first `</script`, where the check stops;
- a looser policy, or a CSP directive named twice (browsers enforce its first copy);
- no `no-referrer` meta, or no DNS-prefetch-off meta;
- a network API in the code:
  - a navigation away: the location assigned, its `assign` / `replace`, or `navigation.navigate`. No CSP directive stops one;
  - a reference to `window.open`, called or not;
  - a resource hint's rel value, quoted anywhere in the script. The library hint code the app never calls is on the inert list;
- a URL off the inert list. Protocol-relative ones count too, a dotless UNC `//host/share` among them.

Each inert entry carries its reason.

## ESLint bans

In `src/` (the tests apart), ESLint bans:

- the network APIs;
- navigating away: a location assignment, `location.assign` / `replace`, `navigation.navigate`, a form's submit, a link's or form's target in markup. The one link the app makes, a download's, takes `URL.createObjectURL(…)` directly;
- the HTML-parsing sinks: `innerHTML` / `outerHTML` writes, `insertAdjacentHTML`, `document.write`, `dangerouslySetInnerHTML`. Nodes are built, never parsed from a string.
