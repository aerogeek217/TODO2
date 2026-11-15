import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

/**
 * Who imports each export of the app's own modules (`src/`, outside
 * `src/test/`): every TypeScript file of the repository is parsed (the app,
 * its tests, the e2e specs, `scripts/` and the root configs) and each import
 * â€” static, `import type`, dynamic, `typeof import()`, a re-export â€”
 * resolved to the module that declares the name (through `export *` barrels
 * such as `models/index.ts`). For `export-use.test.ts`.
 */

export const ROOT = path.resolve(__dirname, '../../..')
const SRC = path.join(ROOT, 'src')
const TEST = path.join(SRC, 'test')
const SKIP_DIRS = new Set(['node_modules', 'dist', '.claude', 'docs', 'public', 'dev-data', '.git', 'test-results', 'playwright-report'])

/** Every `.ts` / `.tsx` file of the repository, outside the folders above. */
function repoFiles(dir = ROOT, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.isDirectory()) continue
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) repoFiles(p, out)
    } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      out.push(p)
    }
  }
  return out
}

/** A file of the app itself: under `src/`, outside `src/test/`. */
export function isAppFile(file: string): boolean {
  return file.startsWith(SRC + path.sep) && !file.startsWith(TEST + path.sep)
}

/** A test's file: `src/test/` or `e2e/`. */
export function isTestFile(file: string): boolean {
  return file.startsWith(TEST + path.sep) || file.startsWith(path.join(ROOT, 'e2e') + path.sep)
}

/** The repository-relative path with `/`. */
export function rel(file: string): string {
  return path.relative(ROOT, file).split(path.sep).join('/')
}

interface ModuleInfo {
  file: string
  /** Names declared here and exported (`export const x`, `export { x }`, `export default`). */
  local: Set<string>
  /** `export { a as b } from './m'`: b â†’ [module, a] (`*` for `export * as b`). */
  named: Map<string, [string, string]>
  /** `export * from './m'`. */
  stars: string[]
  /** What this file imports: [module, name] pairs (`*` = every export). */
  uses: Array<[string, string]>
}

const EXTENSIONS = ['', '.ts', '.tsx', '/index.ts', '/index.tsx']

function resolveSpec(from: string, spec: string, files: ReadonlySet<string>): string | null {
  if (!spec.startsWith('.')) return null
  const base = path.resolve(path.dirname(from), spec.replace(/\.js$/, ''))
  for (const ext of EXTENSIONS) {
    if (files.has(base + ext.split('/').join(path.sep))) return base + ext.split('/').join(path.sep)
  }
  return null
}

function hasExport(node: ts.Node): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
}

function hasDefault(node: ts.Node): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)
}

function bindingNames(name: ts.BindingName, out: string[] = []): string[] {
  if (ts.isIdentifier(name)) out.push(name.text)
  else for (const el of name.elements) if (!ts.isOmittedExpression(el)) bindingNames(el.name, out)
  return out
}

/** The names read off `ns` in `scope` (`ns.a`), or `null` when `ns` is also used as a whole. */
function memberReads(scope: ts.Node, ns: string, skip?: ts.Node): Set<string> | null {
  const names = new Set<string>()
  let whole = false
  const visit = (n: ts.Node): void => {
    if (n === skip) return
    if (ts.isIdentifier(n) && n.text === ns) {
      const parent = n.parent
      if (ts.isPropertyAccessExpression(parent) && parent.expression === n) names.add(parent.name.text)
      else if (ts.isQualifiedName(parent) && parent.left === n) names.add(parent.right.text)
      else if (!(ts.isPropertyAccessExpression(parent) && parent.name === n) && !(ts.isPropertyAssignment(parent) && parent.name === n)) whole = true
    }
    ts.forEachChild(n, visit)
  }
  visit(scope)
  return whole ? null : names
}

function parse(file: string, files: ReadonlySet<string>): ModuleInfo {
  const text = fs.readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const info: ModuleInfo = { file, local: new Set(), named: new Map(), stars: [], uses: [] }
  const take = (spec: string, name: string) => {
    const mod = resolveSpec(file, spec, files)
    if (mod) info.uses.push([mod, name])
  }
  const takeAll = (spec: string, names: Set<string> | null) => {
    if (names) for (const n of names) take(spec, n)
    else take(spec, '*')
  }

  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
      const spec = st.moduleSpecifier.text
      const clause = st.importClause
      if (!clause) continue
      if (clause.name) take(spec, 'default')
      const nb = clause.namedBindings
      if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) take(spec, (el.propertyName ?? el.name).text)
      if (nb && ts.isNamespaceImport(nb)) takeAll(spec, memberReads(sf, nb.name.text, st))
    } else if (ts.isExportDeclaration(st)) {
      const spec = st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier) ? st.moduleSpecifier.text : null
      const mod = spec ? resolveSpec(file, spec, files) : null
      if (!st.exportClause) {
        if (mod) info.stars.push(mod)
      } else if (ts.isNamespaceExport(st.exportClause)) {
        info.local.add(st.exportClause.name.text)
        if (mod) info.named.set(st.exportClause.name.text, [mod, '*'])
      } else {
        for (const el of st.exportClause.elements) {
          const exported = el.name.text
          const source = (el.propertyName ?? el.name).text
          if (spec == null) info.local.add(exported)
          else if (mod) info.named.set(exported, [mod, source])
        }
      }
    } else if (ts.isExportAssignment(st)) {
      info.local.add('default')
    } else if (hasExport(st)) {
      if (hasDefault(st)) info.local.add('default')
      else if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) for (const n of bindingNames(d.name)) info.local.add(n)
      else if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st) || ts.isEnumDeclaration(st) || ts.isModuleDeclaration(st)) && st.name) {
        info.local.add(st.name.text)
      }
    }
  }

  // Dynamic imports and `typeof import('â€¦')`, anywhere in the file.
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const arg = n.arguments[0]
      if (arg && ts.isStringLiteralLike(arg)) takeAll(arg.text, dynamicReads(n))
    } else if (ts.isImportTypeNode(n) && ts.isLiteralTypeNode(n.argument) && ts.isStringLiteral(n.argument.literal)) {
      const spec = n.argument.literal.text
      if (n.qualifier) take(spec, (ts.isIdentifier(n.qualifier) ? n.qualifier : leftmost(n.qualifier)).text)
      else takeAll(spec, null)
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return info
}

function leftmost(q: ts.QualifiedName): ts.Identifier {
  let left: ts.EntityName = q
  while (ts.isQualifiedName(left)) left = left.left
  return left
}

/** What `import('â€¦')` reads: `.then((m) => m.a)`, `const { a } = await import(â€¦)`; `null` = everything. */
function dynamicReads(call: ts.CallExpression): Set<string> | null {
  const parent = call.parent
  if (ts.isPropertyAccessExpression(parent) && parent.name.text === 'then' && ts.isCallExpression(parent.parent)) {
    const fn = parent.parent.arguments[0]
    if (fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) {
      const param = fn.parameters[0]
      if (param && ts.isIdentifier(param.name)) return memberReads(fn.body, param.name.text)
      if (param && ts.isObjectBindingPattern(param.name)) return new Set(bindingNames(param.name))
    }
  }
  if (ts.isAwaitExpression(parent) && ts.isVariableDeclaration(parent.parent) && ts.isObjectBindingPattern(parent.parent.name)) {
    return new Set(parent.parent.name.elements.map((el) => ((el.propertyName && ts.isIdentifier(el.propertyName)) ? el.propertyName : (el.name as ts.Identifier)).text))
  }
  return null
}

export interface ExportUse {
  /** `src/â€¦` path. */
  file: string
  name: string
  /** Importers in the app (or `scripts/`, the root configs). */
  app: string[]
  /** Importers among the tests. */
  tests: string[]
}

/** Every export of every app module, with who imports it. */
export function exportUses(): ExportUse[] {
  const all = repoFiles()
  const fileSet = new Set(all)
  const mods = new Map(all.map((f) => [f, parse(f, fileSet)]))
  /** module â†’ name â†’ importer files. */
  const importers = new Map<string, Map<string, Set<string>>>()
  const record = (mod: string, name: string, by: string) => {
    const byName = importers.get(mod) ?? new Map<string, Set<string>>()
    importers.set(mod, byName)
    const set = byName.get(name) ?? new Set<string>()
    byName.set(name, set)
    set.add(by)
  }
  /** The module(s) whose export `name` of `mod` is (through named re-exports and `export *`). */
  const resolveUse = (mod: string, name: string, by: string, seen = new Set<string>()): void => {
    if (seen.has(mod)) return
    seen.add(mod)
    const info = mods.get(mod)
    if (!info) return
    if (name === '*') {
      for (const n of info.local) record(mod, n, by)
      for (const [n, [m, src]] of info.named) {
        record(mod, n, by)
        resolveUse(m, src, mod)
      }
      for (const s of info.stars) resolveUse(s, '*', by, seen)
      return
    }
    if (info.local.has(name)) {
      record(mod, name, by)
      return
    }
    const re = info.named.get(name)
    if (re) {
      record(mod, name, by)
      return
    }
    for (const s of info.stars) resolveUse(s, name, by, seen)
  }
  for (const info of mods.values()) {
    for (const [mod, name] of info.uses) resolveUse(mod, name, info.file)
    // A named re-export uses its source's export.
    for (const [m, src] of info.named.values()) resolveUse(m, src, info.file)
  }
  const out: ExportUse[] = []
  for (const info of mods.values()) {
    if (!isAppFile(info.file)) continue
    for (const name of [...info.local, ...info.named.keys()]) {
      const by = [...(importers.get(info.file)?.get(name) ?? [])].filter((f) => f !== info.file)
      out.push({
        file: rel(info.file),
        name,
        app: by.filter((f) => !isTestFile(f)).map(rel).sort(),
        tests: by.filter(isTestFile).map(rel).sort(),
      })
    }
  }
  return out.sort((a, b) => a.file.localeCompare(b.file) || a.name.localeCompare(b.name))
}
