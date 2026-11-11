import { expect, type Locator } from '@playwright/test'

/**
 * The review deck (`deck`, its dialog) is on its `k`-th card of `n` (1-based).
 * The deck shows no place in the queue as text: the header's dots (`n` ≤ 20;
 * past that its progress bar out of `n`) mark the current card, and the
 * queue rail's `aria-current` row is the same one. Pass `rail: false` while
 * the queue is folded away (under 820px of deck).
 */
export async function expectDeckAt(deck: Locator, k: number, n: number, { rail = true }: { rail?: boolean } = {}): Promise<void> {
  const header = deck.locator('header').first()
  await expect(header).not.toHaveText(/\d+ of \d+/)
  if (n <= 20) {
    const dots = header.getByTestId('review-dots').locator('[data-dot]')
    await expect(dots).toHaveCount(n)
    await expect(dots.nth(k - 1)).toHaveAttribute('data-dot', 'current')
  } else {
    await expect(header.getByTestId('review-progress')).toHaveAttribute('aria-valuemax', String(n))
  }
  if (!rail) return
  const rows = deck.getByRole('navigation', { name: /^Review queue/ }).locator('[data-review-row]')
  await expect(rows).toHaveCount(n)
  await expect(rows.nth(k - 1)).toHaveAttribute('aria-current', 'true')
}
