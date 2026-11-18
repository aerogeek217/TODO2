import { registerModuleReset } from '../utils/module-reset'

/**
 * The open editor dialogs that hold a copy until their Save — Edit list and
 * the widget editors (a Number's, a chart's, Created vs completed's) — as the rest of the app sees them: the one rule that nothing leaves one with changes
 * without its Save / Discard / Keep editing question. Each registers itself
 * while it is mounted (`registerOpenEditor`); whatever would close one or
 * take its subject off the screen from outside it — opening Settings or
 * another editor, a layout switch, a new or duplicated layout, a route
 * change, and in a cell a tab switched or closed, a row collapsed, a split,
 * merge or insert, Change widget, an added widget, the widget popup closed
 * — runs through `afterLeavingEditors` / `leaveOpenEditors`, which asks each
 * one holding changes in turn and carries on only once it was saved or
 * discarded (Keep editing: nothing happens). An editor closed anyway says
 * so itself: only where nothing could ask — a data replace, an undo, a hash
 * typed in, a cell resized too small to show its widget.
 *
 * The layout edit mode (`workspace-store.editing`) registers too, as a
 * **layout-wide** editor (`layoutWide`): it is asked only when something
 * would leave the layout — a layout switch, New / Duplicate / delete layout,
 * Settings opening, an in-app route change (`leaveLayout`) — never by what
 * happens inside a cell (`afterLeavingEditors`, `leaveOpenEditors`), which
 * in the mode are its own edits.
 */
interface OpenEditor {
  /** Whether it holds changes that leaving would lose. */
  changed: () => boolean
  /**
   * Asks Save / Discard / Keep editing (the question already up: the same
   * answer); resolves true once it is closed — saved or discarded —, false
   * for Keep editing.
   */
  ask: () => Promise<boolean>
  /**
   * A layout-wide editor (the layout edit mode): asked only on leaving the
   * layout (`leaveLayout`), and left (`leave`) there when it holds no changes.
   */
  layoutWide?: boolean
  /** A layout-wide editor's quiet exit, on leaving the layout with no changes. */
  leave?: () => void
}

const open = new Set<OpenEditor>()
registerModuleReset(() => { open.clear() })

/** An editor registers while it is mounted; returns its removal. */
export function registerOpenEditor(editor: OpenEditor): () => void {
  open.add(editor)
  return () => { open.delete(editor) }
}

/**
 * Who a leave check asks: `cell` (default) — what happens inside the
 * layout (a cell's tab switched or closed, a split, an editor opened, the
 * widget popup): every editor but the layout-wide ones; `layout` —
 * leaving the layout: every editor.
 */
type LeaveScope = 'cell' | 'layout'

function asked(editor: OpenEditor, scope: LeaveScope): boolean {
  return scope === 'layout' || editor.layoutWide !== true
}

/** Whether an open editor holds changes (`scope`: which are asked, `LeaveScope`). */
export function editorsHoldChanges(scope: LeaveScope = 'cell'): boolean {
  return [...open].some((e) => asked(e, scope) && e.changed())
}

/** Asks every open editor holding changes, in turn; resolves whether all were left (saved or discarded). */
export async function leaveOpenEditors(scope: LeaveScope = 'cell'): Promise<boolean> {
  for (const editor of [...open]) {
    if (!asked(editor, scope) || !editor.changed()) continue
    if (!(await editor.ask())) return false
  }
  return true
}

/** Whether leaving the layout asks a question first: an open editor — the layout edit mode too — holds changes. */
export function layoutLeaveAsks(): boolean {
  return editorsHoldChanges('layout')
}

/** Leaves every layout-wide editor holding no changes (the layout edit mode), asking nothing. */
export function quitLayoutEditors(): void {
  for (const editor of [...open]) if (editor.layoutWide === true && !editor.changed()) editor.leave?.()
}

/**
 * Leaving the layout (a layout switch, New / Duplicate / delete layout,
 * Settings, a route change): every open editor holding changes is asked —
 * the layout edit mode's Save / Discard / Keep editing too —, then the
 * layout-wide ones holding none are left. Resolves whether everything was
 * left (false: Keep editing, stay).
 */
export async function leaveLayout(): Promise<boolean> {
  if (!(await leaveOpenEditors('layout'))) return false
  quitLayoutEditors()
  return true
}

/**
 * Runs `run` at once when no open editor holds changes; else asks first
 * (`leaveOpenEditors`) and runs it once they were saved or discarded — never
 * on Keep editing.
 */
export function afterLeavingEditors(run: () => void): void {
  if (!editorsHoldChanges()) {
    run()
    return
  }
  void leaveOpenEditors().then((left) => { if (left) run() })
}

// ── Which editor is open ────────────────────────────────────────────────────

/**
 * The one roster of the stores' "which editor is open" fields (Edit list
 * and the Number editor in `ui-store`; a chart's and Created vs
 * completed's in `chart-widgets-store`): each store registers how
 * its fields close, beside them, so everything that closes every editor —
 * Settings opening, the widget popup, a data replace — and the one-at-a-time
 * rule (`openOneEditor`) go through the same list. Wiring, not state: never
 * reset.
 */
const fields = new Set<() => void>()

/** Registers how a store's open-editor fields close (`closeOpenEditors` runs it). */
export function registerEditorFields(close: () => void): void {
  fields.add(close)
}

/**
 * Closes every open editor, asking nothing: one with changes was asked
 * before (`leaveOpenEditors`), or is closed anyway and says so itself (its
 * subject gone: a data replace).
 */
export function closeOpenEditors(): void {
  for (const close of fields) close()
}

/**
 * Opens an editor (`open` sets its store's field): an editor with changes is
 * asked first (never on Keep editing), and every other one closes — one at
 * a time, whichever store holds it.
 */
export function openOneEditor(open: () => void): void {
  afterLeavingEditors(() => {
    closeOpenEditors()
    open()
  })
}
