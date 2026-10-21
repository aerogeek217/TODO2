import type { PersistedListDefinition } from '../models/list-definition'
import { LAYOUT_NAME_MAX, layoutBodyOf, type LayoutBody } from '../models/workspace-layout'
import { registerModuleReset } from '../utils/module-reset'
import { isRecord } from '../utils/is-record'
import { CURRENT_DB_VERSION } from './database'
import { rowFixes, sanitizeRow, validateRow } from './import-validation'
import { pickLayoutBody } from './layout-shape'
import { upgradeDataSet, type DataRow } from './schema-upgrades'

/**
 * Unsaved layout and list changes kept across a reload, in `localStorage`:
 * per browser, outside the Dexie database — so never in the sync file, an
 * export or a backup, and untouched by a data replace (the stores drop them
 * then; `clearUnsavedDrafts`). Each record carries what it was made
 * against (the stored layout's columns and bands, the saved list), and is only taken
 * back while the stored data still matches: a draft made against other data
 * is dropped, never applied to it. Storage that can't be read or written
 * (private mode, quota, blocked site data) just means nothing is kept.
 *
 * Each record also carries the schema version it was written in: a record
 * an older build kept is read through the schema upgrades (as a file of that
 * version would be) before any check, so a draft is never applied in an old
 * shape; one a newer build kept is dropped.
 */

const LAYOUT_KEY = 'todo2-unsaved-layout'
const LISTS_KEY = 'todo2-unsaved-lists'

/**
 * The open layout's unsaved working copy: its body (columns and bands). Kept
 * as `columns` / `top` / `bottom` (and `baseColumns` / `baseTop` /
 * `baseBottom` for the base), so a record kept before bands existed reads
 * as a body without bands.
 */
export type LayoutDraftRecord =
  /** Edits to a stored layout, made against `base` (its stored body then). */
  | { kind: 'saved'; layoutId: number; base: LayoutBody; body: LayoutBody }
  /**
   * A new layout not stored yet (only one an older build kept; it opens
   * again only while it shows no list). A `listNames` an older build kept
   * with it is ignored.
   */
  | { kind: 'new'; name: string; body: LayoutBody }

/** A list's unsaved edits, made against `base` (the saved definition then). */
export interface ListDraftRecord {
  draft: PersistedListDefinition
  base: PersistedListDefinition
}

/** The schema version of a record kept without one: the first build that kept drafts. */
const FIRST_DRAFT_VERSION = 63

/** The schema version a record was written in, or `null` when this build can't read it. */
function versionOf(v: unknown): number | null {
  if (v === undefined) return FIRST_DRAFT_VERSION
  return typeof v === 'number' && Number.isInteger(v) && v >= FIRST_DRAFT_VERSION && v <= CURRENT_DB_VERSION ? v : null
}

/** `rows` of `table` upgraded from schema `from` to the current one; `null` when that fails or loses a row. */
function upgradeRows(table: string, rows: unknown[], from: number): unknown[] | null {
  if (from === CURRENT_DB_VERSION) return rows
  try {
    const out = upgradeDataSet({ [table]: rows as DataRow[] }, from, CURRENT_DB_VERSION)[table]
    return out?.length === rows.length ? out : null
  } catch {
    return null
  }
}

/**
 * This tab's last write of each kind: the text it stored (`null` = none
 * kept), or `false` when storage refused it.
 */
let layoutWritten: string | null | false = null
let listsWritten: string | null | false = null
registerModuleReset(() => {
  // A fresh page load's storage: no drafts kept from an earlier test.
  layoutWritten = writeJson(LAYOUT_KEY, null)
  listsWritten = writeJson(LISTS_KEY, null)
})

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key)
    return raw == null ? null : JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

/** Writes `value` (or removes the key for `null`): the text stored (`null` when removed), false when storage refused. */
function writeJson(key: string, value: unknown): string | null | false {
  try {
    if (value == null) {
      localStorage.removeItem(key)
      return null
    }
    const text = JSON.stringify(value)
    localStorage.setItem(key, text)
    return text
  } catch (err) {
    console.warn(`[drafts] could not keep unsaved changes (${key})`, err)
    return false
  }
}

/** A body only when it passes the layout repair unchanged; else `null`. */
function bodyOf(raw: unknown): LayoutBody | null {
  if (!isRecord(raw) || !Array.isArray(raw.columns)) return null
  const { fixes, ...body } = pickLayoutBody({ columns: raw.columns, top: raw.top, bottom: raw.bottom })
  return fixes.length === 0 ? layoutBodyOf(body) : null
}

/** The kept layout draft, or `null` (none, or not readable by this build). */
export function readLayoutDraft(): LayoutDraftRecord | null {
  const v = readJson(LAYOUT_KEY)
  if (!isRecord(v)) return null
  const from = versionOf(v.schemaVersion)
  if (from === null) return null
  // The body (and the base's) as layout rows, upgraded together.
  const upgraded = upgradeRows('layouts', [
    { columns: v.columns, top: v.top, bottom: v.bottom },
    { columns: v.baseColumns, top: v.baseTop, bottom: v.baseBottom },
  ], from)
  if (!upgraded) return null
  const body = bodyOf(upgraded[0])
  if (!body) return null
  if (v.kind === 'saved') {
    const base = bodyOf(upgraded[1])
    if (!base || typeof v.layoutId !== 'number' || !Number.isInteger(v.layoutId) || v.layoutId < 1) return null
    return { kind: 'saved', layoutId: v.layoutId, base, body }
  }
  if (v.kind === 'new') {
    if (typeof v.name !== 'string' || v.name.trim() === '' || v.name.length > LAYOUT_NAME_MAX) return null
    return { kind: 'new', name: v.name, body }
  }
  return null
}

/** Keeps the layout draft (`null` = none). */
export function writeLayoutDraft(record: LayoutDraftRecord | null): void {
  layoutWritten = writeJson(LAYOUT_KEY, record && { ...storedForm(record), schemaVersion: CURRENT_DB_VERSION })
}

/** A layout draft as kept: the body's keys flat (`columns`, `top`, …), the base's prefixed. */
function storedForm(record: LayoutDraftRecord): Record<string, unknown> {
  const { body } = record
  const flat = { columns: body.columns, top: body.top, bottom: body.bottom }
  if (record.kind === 'new') return { kind: 'new', name: record.name, ...flat }
  const { base } = record
  return {
    kind: 'saved', layoutId: record.layoutId, ...flat,
    baseColumns: base.columns, baseTop: base.top, baseBottom: base.bottom,
  }
}

/** A list definition only when import would take it as it is (rebuilt from known keys); else `null`. */
function listDefOf(raw: unknown): PersistedListDefinition | null {
  if (!isRecord(raw) || typeof raw.id !== 'number') return null
  if (validateRow('listDefinitions', raw) !== true || rowFixes('listDefinitions', raw).length > 0) return null
  return { ...sanitizeRow('listDefinitions', raw), id: raw.id } as PersistedListDefinition
}

/** The kept list drafts by list id; unreadable entries are left out. */
export function readListDrafts(): Map<number, ListDraftRecord> {
  const out = new Map<number, ListDraftRecord>()
  const v = readJson(LISTS_KEY)
  if (!isRecord(v)) return out
  for (const [key, entry] of Object.entries(v)) {
    if (!isRecord(entry)) continue
    const from = versionOf(entry.schemaVersion)
    const upgraded = from === null ? null : upgradeRows('listDefinitions', [entry.draft, entry.base], from)
    if (!upgraded) continue
    const draft = listDefOf(upgraded[0])
    const base = listDefOf(upgraded[1])
    const id = Number(key)
    if (!draft || !base || draft.id !== id || base.id !== id) continue
    out.set(id, { draft, base })
  }
  return out
}

/** Keeps the list drafts (an empty map removes them). */
export function writeListDrafts(records: ReadonlyMap<number, ListDraftRecord>): void {
  const entries = [...records].map(([id, record]) => [id, { ...record, schemaVersion: CURRENT_DB_VERSION }] as const)
  listsWritten = writeJson(LISTS_KEY, entries.length > 0 ? Object.fromEntries(entries) : null)
}

/** Forgets every kept draft (a data replace: they were made against other data). */
export function clearUnsavedDrafts(): void {
  layoutWritten = writeJson(LAYOUT_KEY, null)
  listsWritten = writeJson(LISTS_KEY, null)
}

/**
 * Whether the unsaved changes on screen are kept for a reload: this tab's
 * last write of each kind reached storage and is still there — another tab
 * of the app shares the storage, and its own writes replace these.
 */
export function unsavedDraftsKept(): boolean {
  return stillKept(LAYOUT_KEY, layoutWritten) && stillKept(LISTS_KEY, listsWritten)
}

function stillKept(key: string, written: string | null | false): boolean {
  if (written === false) return false
  // Nothing of this kind to keep: another tab's draft doesn't matter here.
  if (written === null) return true
  try {
    return localStorage.getItem(key) === written
  } catch {
    return false
  }
}
