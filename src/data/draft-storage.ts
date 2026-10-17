import type { PersistedListDefinition } from '../models/list-definition'
import { LAYOUT_NAME_MAX, type LayoutColumn } from '../models/workspace-layout'
import { registerModuleReset } from '../utils/module-reset'
import { isRecord } from '../utils/is-record'
import { rowFixes, sanitizeRow, validateRow } from './import-validation'
import { pickLayoutColumns } from './layout-shape'

/**
 * Unsaved layout and list changes kept across a reload, in `localStorage`:
 * per browser, outside the Dexie database — so never in the sync file, an
 * export or a backup, and untouched by a data replace (the stores drop them
 * then; `clearUnsavedDrafts`). Each record carries what it was made
 * against (the stored layout's columns, the saved list), and is only taken
 * back while the stored data still matches: a draft made against other data
 * is dropped, never applied to it. Storage that can't be read or written
 * (private mode, quota, blocked site data) just means nothing is kept.
 */

const LAYOUT_KEY = 'todo2-unsaved-layout'
const LISTS_KEY = 'todo2-unsaved-lists'

/** The open layout's unsaved working copy. */
export type LayoutDraftRecord =
  /** Edits to a stored layout, made against `baseColumns` (its stored columns then). */
  | { kind: 'saved'; layoutId: number; baseColumns: LayoutColumn[]; columns: LayoutColumn[] }
  /**
   * A new layout not stored yet. `listNames` names the lists its tabs show
   * (by id), so a draft whose lists are gone or are other lists now is dropped.
   */
  | { kind: 'new'; name: string; columns: LayoutColumn[]; listNames: Record<string, string> }

/** A list's unsaved edits, made against `base` (the saved definition then). */
export interface ListDraftRecord {
  draft: PersistedListDefinition
  base: PersistedListDefinition
}

/** Whether the last write reached storage (both kinds). */
let layoutWriteOk = true
let listsWriteOk = true
registerModuleReset(() => {
  layoutWriteOk = true
  listsWriteOk = true
  // A fresh page load's storage: no drafts kept from an earlier test.
  writeJson(LAYOUT_KEY, null)
  writeJson(LISTS_KEY, null)
})

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key)
    return raw == null ? null : JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

/** Writes `value` (or removes the key for `null`); false when storage refused. */
function writeJson(key: string, value: unknown): boolean {
  try {
    if (value == null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch (err) {
    console.warn(`[drafts] could not keep unsaved changes (${key})`, err)
    return false
  }
}

/** Columns only when they pass the layout repair unchanged; else `null`. */
function columnsOf(raw: unknown): LayoutColumn[] | null {
  if (!Array.isArray(raw)) return null
  const picked = pickLayoutColumns(raw)
  return picked.fixes.length === 0 ? picked.columns : null
}

/** The kept layout draft, or `null` (none, or not readable by this build). */
export function readLayoutDraft(): LayoutDraftRecord | null {
  const v = readJson(LAYOUT_KEY)
  if (!isRecord(v)) return null
  const columns = columnsOf(v.columns)
  if (!columns) return null
  if (v.kind === 'saved') {
    const baseColumns = columnsOf(v.baseColumns)
    if (!baseColumns || typeof v.layoutId !== 'number' || !Number.isInteger(v.layoutId) || v.layoutId < 1) return null
    return { kind: 'saved', layoutId: v.layoutId, baseColumns, columns }
  }
  if (v.kind === 'new') {
    if (typeof v.name !== 'string' || v.name.trim() === '' || v.name.length > LAYOUT_NAME_MAX || !isRecord(v.listNames)) return null
    const listNames: Record<string, string> = {}
    for (const [id, name] of Object.entries(v.listNames)) {
      if (typeof name !== 'string') return null
      listNames[id] = name
    }
    return { kind: 'new', name: v.name, columns, listNames }
  }
  return null
}

/** Keeps the layout draft (`null` = none). */
export function writeLayoutDraft(record: LayoutDraftRecord | null): void {
  layoutWriteOk = writeJson(LAYOUT_KEY, record)
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
    const draft = listDefOf(entry.draft)
    const base = listDefOf(entry.base)
    const id = Number(key)
    if (!draft || !base || draft.id !== id || base.id !== id) continue
    out.set(id, { draft, base })
  }
  return out
}

/** Keeps the list drafts (an empty map removes them). */
export function writeListDrafts(records: ReadonlyMap<number, ListDraftRecord>): void {
  listsWriteOk = writeJson(LISTS_KEY, records.size > 0 ? Object.fromEntries(records) : null)
}

/** Forgets every kept draft (a data replace: they were made against other data). */
export function clearUnsavedDrafts(): void {
  layoutWriteOk = writeJson(LAYOUT_KEY, null)
  listsWriteOk = writeJson(LISTS_KEY, null)
}

/** Whether the unsaved changes on screen are kept for a reload (the last writes reached storage). */
export function unsavedDraftsKept(): boolean {
  return layoutWriteOk && listsWriteOk
}
