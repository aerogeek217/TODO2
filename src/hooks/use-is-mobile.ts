import { useMediaQuery } from './use-media-query'

const MOBILE_QUERY = '(max-width: 640px)'

/** Whether the viewport is phone-sized (≤ 640px wide); re-renders when that changes. */
export function useIsMobile(): boolean {
  return useMediaQuery(MOBILE_QUERY)
}
