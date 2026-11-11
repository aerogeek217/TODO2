import { registerModuleReset } from '../utils/module-reset'

/**
 * The open editor dialogs that hold a copy until their Save — Edit list and
 * the widget editors (a Number's, a chart's, Project pulse's) — as the rest
 * of the app sees them: the one rule that nothing leaves one with changes
 * without its Save / Discard / Keep editing question. Each registers itself
 * while it is mounted (`registerOpenEditor`); whatever would close one or
 * take its subject off the screen from outside it — opening Settings or
 * another editor, a layout switch, a new or duplicated layout, a route
 * change — runs through `afterLeavingEditors` / `leaveOpenEditors`, which
 * asks each one holding changes in turn and carries on only once it was
 * saved or discarded (Keep editing: nothing happens). An editor closed
 * anyway (its subject gone: a data replace, an undo, another tab) says so
 * itself.
 */
export interface OpenEditor {
  /** Whether it holds changes that leaving would lose. */
  changed: () => boolean
  /**
   * Asks Save / Discard / Keep editing (the question already up: the same
   * answer); resolves true once it is closed — saved or discarded —, false
   * for Keep editing.
   */
  ask: () => Promise<boolean>
}

const open = new Set<OpenEditor>()
registerModuleReset(() => { open.clear() })

/** An editor registers while it is mounted; returns its removal. */
export function registerOpenEditor(editor: OpenEditor): () => void {
  open.add(editor)
  return () => { open.delete(editor) }
}

/** Whether an open editor holds changes. */
export function editorsHoldChanges(): boolean {
  return [...open].some((e) => e.changed())
}

/** Asks every open editor holding changes, in turn; resolves whether all were left (saved or discarded). */
export async function leaveOpenEditors(): Promise<boolean> {
  for (const editor of [...open]) {
    if (!editor.changed()) continue
    if (!(await editor.ask())) return false
  }
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
