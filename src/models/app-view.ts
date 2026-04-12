export enum AppView {
  Canvas = 'canvas',
  Dashboard = 'dashboard',
  List = 'list',
  Calendar = 'calendar',
  Settings = 'settings',
}

export type ListSortBy = 'priority' | 'due' | 'people' | 'tag' | 'project' | 'org' | 'status'

export type DateField = 'due' | 'created' | 'modified'

export type AssignedFilter = 'all' | 'unassigned' | 'assigned'
export type FollowupFilter = 'all' | 'followup' | 'no-followup'
export type CompletedFilter = 'all' | 'incomplete' | 'completed'
