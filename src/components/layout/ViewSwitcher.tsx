import { useNavigate, useLocation } from 'react-router'
import { AppView } from '../../models'
import styles from './ViewSwitcher.module.css'

const views = [
  { view: AppView.Canvas, label: 'Canvas', path: '/' },
  { view: AppView.List, label: 'List', path: '/list' },
  { view: AppView.Calendar, label: 'Calendar', path: '/calendar' },
] as const

export function ViewSwitcher() {
  const navigate = useNavigate()
  const location = useLocation()

  return (
    <nav className={styles.switcher}>
      {views.map(({ view, label, path }) => {
        const isActive = location.pathname === path
        return (
          <button
            key={view}
            className={`${styles.viewButton} ${isActive ? styles.active : ''}`}
            onClick={() => navigate(path)}
          >
            {label}
          </button>
        )
      })}
    </nav>
  )
}
