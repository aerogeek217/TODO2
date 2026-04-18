export enum AppView {
  Canvas = 'canvas',
  Dashboard = 'dashboard',
  List = 'list',
  Calendar = 'calendar',
  Settings = 'settings',
}

export type ListSortBy = 'date' | 'scheduled' | 'deadline' | 'people' | 'tag' | 'project' | 'org' | 'status'

export type DateField = 'date' | 'scheduled' | 'deadline' | 'created' | 'modified'
