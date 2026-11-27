import { NotesBody } from '../task/notes/NotesBody'
import { TaskEditPopup } from '../task/TaskEditPopup'
import { WidgetNameLine } from './WidgetTopLine'
import styles from './NotesWidget.module.css'

interface NotesWidgetProps {
  onToast?: (message: string) => void
}

/** Body of a notes tab: the single global note (alone in its cell, under a slim name line); its lines convert to tasks in `TaskEditPopup`. */
export function NotesWidget({ onToast }: NotesWidgetProps) {
  return (
    <div className={styles.wrap}>
      <WidgetNameLine name="Notes" />
      <NotesBody onConvertToast={onToast} taskEditor={TaskEditPopup} />
    </div>
  )
}
