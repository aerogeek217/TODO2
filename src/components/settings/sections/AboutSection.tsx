import { useFileStorageStore } from '../../../stores/file-storage-store'
import styles from './sections.module.css'

/** What the app is and where the data lives. */
export function AboutSection() {
  const isConnected = useFileStorageStore((s) => s.isConnected)
  const fileName = useFileStorageStore((s) => s.fileName)
  return (
    <div className={styles.section}>
      <div className={styles.about}>
        TODO2 — a local-first todo app<br />
        Data stored {isConnected ? `in ${fileName}` : 'locally in your browser (IndexedDB)'}<br />
        No account, no server, fully offline
      </div>
    </div>
  )
}
