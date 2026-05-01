export interface ContextMenuItem {
  label: string
  action: () => void
  danger?: boolean
  separator?: boolean
}
