import { reviewWidgetTargetIn } from '../services/review-widget'
import { useWorkspaceStore } from '../stores/workspace-store'
import { useIsMobile } from './use-is-mobile'

/**
 * Whether the Review buttons show here (widget feedback 2B): some layout
 * holds a Review widget for a jump to go to — re-read live as widgets are
 * added or removed — and this isn't a phone (the jumps are desktop only). Hidden, never disabled.
 */
export function useReviewJumpAvailable(): boolean {
  const isMobile = useIsMobile()
  const has = useWorkspaceStore((s) => reviewWidgetTargetIn(s.working, s.layouts) != null)
  return has && !isMobile
}
