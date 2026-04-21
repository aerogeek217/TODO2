import type { CalendarOrientation } from './canvas-rails'

export interface FloatingCalendar {
  id?: number
  canvasId: number
  x: number
  y: number
  width: number
  height: number
  /** Row/column orientation. Undefined = default 'vertical'. */
  orientation?: CalendarOrientation
  /** Week offset from today's week (0 = this week). Clamped to ±WEEK_OFFSET_MAX on read. */
  weekOffset?: number
}
