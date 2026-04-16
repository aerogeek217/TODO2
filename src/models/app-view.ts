export enum AppView {
  Canvas = 'canvas',
  Dashboard = 'dashboard',
  List = 'list',
  Calendar = 'calendar',
  Settings = 'settings',
}

export type ListSortBy = 'priority' | 'due' | 'people' | 'tag' | 'project' | 'org' | 'status'

export type DateField = 'due' | 'created' | 'modified'

