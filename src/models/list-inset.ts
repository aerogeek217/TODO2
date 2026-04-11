export type ListInsetPreset = 'due-this-week' | 'starred' | 'high-priority'

export type ListInsetAttributeFilter =
  | { type: 'priority'; priority: number }
  | { type: 'person'; personId: number; personName: string }
  | { type: 'tag'; tagId: number; tagName: string; tagColor?: string }
  | { type: 'org'; orgId: number; orgName: string; orgColor?: string }

export interface ListInset {
  id?: number
  name: string
  preset?: ListInsetPreset
  attributeFilter?: ListInsetAttributeFilter
  canvasId: number
  x: number
  y: number
  width: number
  height: number
  isCollapsed: boolean
}
