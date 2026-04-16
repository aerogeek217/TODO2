export const STATUS_ICON_KEYS = ['person', 'message-bubble'] as const
export type StatusIconKey = (typeof STATUS_ICON_KEYS)[number]

export function StatusIcon({ icon, filled }: { icon?: string; filled?: boolean }) {
  switch (icon) {
    case 'person':
      return (
        <svg width="1em" height="1em" viewBox="0 0 16 16"
          fill={filled ? 'currentColor' : 'none'}
          stroke={filled ? 'none' : 'currentColor'}
          strokeWidth={filled ? 0 : 1.3}
          style={{ verticalAlign: '-0.125em' }}>
          <circle cx="8" cy="5" r="3" />
          <path d="M2.5 14a5.5 5.5 0 0 1 11 0" />
        </svg>
      )
    case 'message-bubble':
      return (
        <svg width="1em" height="1em" viewBox="0 0 16 16"
          fill={filled ? 'currentColor' : 'none'}
          stroke="currentColor"
          strokeWidth={filled ? 0 : 1.3}
          style={{ verticalAlign: '-0.125em' }}>
          <path d="M3 2.5h10A1.5 1.5 0 0114.5 4v6A1.5 1.5 0 0113 11.5H7.5L4 14.5v-3H3A1.5 1.5 0 011.5 10V4A1.5 1.5 0 013 2.5z" />
        </svg>
      )
    default:
      return null
  }
}
