import { createContext, useContext } from 'react'
import { useStore } from 'zustand'
import type { ReviewSession, ReviewSessionApi } from '../../stores/review-session'

/**
 * The review session the rail, the card and the footer read and step
 * (`stores/review-session`): the deck's (`useReviewStore`) or a Review
 * widget's (`reviewWidgetSession`), provided by the host.
 */
export const ReviewSessionContext = createContext<ReviewSessionApi | null>(null)

/** The session provided around the review parts (a host forgot it: an error, not a silent second session). */
export function useReviewSessionApi(): ReviewSessionApi {
  const api = useContext(ReviewSessionContext)
  if (!api) throw new Error('A review part is drawn outside a ReviewSessionContext')
  return api
}

/** A value of the provided session, kept current. */
export function useReviewSession<T>(selector: (s: ReviewSession) => T): T {
  return useStore(useReviewSessionApi(), selector)
}
