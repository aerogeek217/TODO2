export enum AppView {
  Canvas = 'canvas',
  List = 'list',
  Calendar = 'calendar',
  Settings = 'settings',
}

export type ListSortBy = 'priority' | 'due' | 'people' | 'tag' | 'project' | 'org'

export type DateField = 'due' | 'created' | 'modified'
