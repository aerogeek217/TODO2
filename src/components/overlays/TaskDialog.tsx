import { useId, useRef } from 'react'
import type { TaskDialogPayload } from '../../stores/task-dialog-payload'
import { useUIStore } from '../../stores/ui-store'
import { DialogFrame } from '../shared/Dialog'
import { TaskDialogContent } from './TaskDialogContent'
import { TaskDialogFilterBar } from './TaskDialogFilterBar'
import styles from './TaskDialog.module.css'

/**
 * The task dialog: the tasks behind a dashboard number or a person chip
 * (`ui-store.taskDialog`), or — on a phone — the screen filter's tasks
 * (desktop shows those in the top bar's filtered-tasks panel). What it
 * shows is `TaskDialogContent`; the screen filter's dialog adds that
 * filter's bar under its header (the filter itself: the workspace behind
 * follows).
 *
 * It sits low (the editor's own layer) so the rows' menus and popovers open
 * above it; the editor stacks over it (`nested`) and takes focus. Esc closes
 * it unless the editor (or another layer) has the key.
 */
export function TaskDialog() {
  const payload = useUIStore((s) => s.taskDialog)
  if (!payload) return null
  return <TaskDialogPanel payload={payload} />
}

function TaskDialogPanel({ payload }: { payload: TaskDialogPayload }) {
  const hide = useUIStore((s) => s.hideTaskDialog)
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  return (
    <DialogFrame
      onClose={hide}
      layer="overlay"
      initialFocus="panel"
      // The editor on top owns Esc while it's open.
      escapeBelongsElsewhere={editorIsOpen}
      aria-labelledby={titleId}
      className={styles.dialog}
      data={{ 'task-dialog': '' }}
      panelRef={panelRef}
    >
      <TaskDialogContent
        payload={payload}
        titleId={titleId}
        panelRef={panelRef}
        onClose={hide}
        filterBar={payload.source.kind === 'screen' ? <TaskDialogFilterBar /> : null}
      />
    </DialogFrame>
  )
}

const editorIsOpen = () => useUIStore.getState().editPopupMode != null
