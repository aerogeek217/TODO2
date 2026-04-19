import { NotesBody } from '../../shared/notes/NotesBody'
import styles from './NotesSlotContent.module.css'

interface NotesSlotContentProps {
  onToast?: (message: string) => void
}

export function NotesSlotContent({ onToast }: NotesSlotContentProps) {
  return (
    <div className={styles.wrap}>
      <NotesBody dock="slot" onConvertToast={onToast} />
    </div>
  )
}
