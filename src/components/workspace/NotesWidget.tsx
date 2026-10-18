import { NotesBody } from '../task/notes/NotesBody'
import styles from './NotesWidget.module.css'

interface NotesWidgetProps {
  onToast?: (message: string) => void
}

/** Body of a notes tab: the single global note. */
export function NotesWidget({ onToast }: NotesWidgetProps) {
  return (
    <div className={styles.wrap}>
      <NotesBody onConvertToast={onToast} />
    </div>
  )
}
