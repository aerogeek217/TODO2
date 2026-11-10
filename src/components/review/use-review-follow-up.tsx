import { useLayoutEffect, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from 'react'
import type { PersistedTodoItem } from '../../models'
import { useFollowupInput } from '../../hooks/use-followup-input'
import { useLatestRef } from '../../hooks/use-latest-ref'
import { useToday } from '../../hooks/use-today'
import { markFollowedUpWithUpdate } from '../../services/mark-followed-up'
import { autoNextFollowup, useSettingsStore } from '../../stores/settings-store'
import { useTodoStore } from '../../stores/todo-store'
import { startOfDay } from '../../utils/date'
import { formatFollowupDate, isFollowedUpToday, nextAfterFollowup } from '../../utils/followup'
import { statusUpdateText } from '../../utils/status-updates'
import { useTooltip } from '../shared/use-tooltip'
import { useReviewSession, useReviewSessionApi } from './review-session-context'

/** Same day, or both none. */
function sameDay(a: Date | null, b: Date | null): boolean {
  return (a ? startOfDay(a).getTime() : null) === (b ? startOfDay(b).getTime() : null)
}

/**
 * A review card's follow-up (the deck's card and the Review widget's
 * faces): the update line's text (the session's draft for the task), the
 * Next follow-up field — starting on what Mark followed up would leave (the
 * follow-up popover's rule), a date typed and not set kept for the task —
 * and Mark followed up: the notes first (`flushNotes`), then the follow-up
 * with the update line's text as one undo step (`markFollowedUpWithUpdate`),
 * the next card opening at once.
 */
export function useReviewFollowUp(todo: PersistedTodoItem, flushNotes: () => Promise<unknown>, updateRef: RefObject<HTMLInputElement | null>) {
  const todoId = todo.id
  const session = useReviewSessionApi()
  const today = useToday()
  const autoFollowup = useSettingsStore((s) => s.autoFollowup)
  const followupDefaultInterval = useSettingsStore((s) => s.followupDefaultInterval)
  const draft = useReviewSession((s) => s.drafts[todoId] ?? '')
  const isLast = useReviewSession((s) => s.index >= s.order.length - 1)

  /** `run` after the notes typed so far (each edit its own undo step, in order). */
  const afterNotes = (run: () => unknown) => { void flushNotes().finally(run) }

  const proposal = autoNextFollowup(today, { autoFollowup, followupDefaultInterval })
  const current = todo.nextFollowupAt ?? null
  const ruled = nextAfterFollowup(current, today, proposal)
  const input = useFollowupInput(ruled ?? undefined, 'next', today)
  // A date typed and not set yet is kept for the task (Back brings it back; the deck's close asks over it).
  const typeNext = (text: string) => {
    input.change(text)
    session.getState().setNextDraft(todoId, text.trim() === '' ? null : text)
  }
  const settleNext = (date: Date | null) => {
    if (date) input.settle(date)
    else input.change('')
    session.getState().setNextDraft(todoId, null)
  }
  // Coming back to the card: the date typed before, as typed.
  const inputLatest = useLatestRef(input)
  useLayoutEffect(() => {
    const typed = session.getState().nextDrafts[todoId]
    if (typed != null) inputLatest.current.change(typed)
  }, [todoId, inputLatest, session])
  const s = input.state
  const untouched = s.kind === 'unchanged'
  const fieldDate: Date | null | 'invalid' =
    untouched ? ruled : s.kind === 'empty' ? null : s.kind === 'valid' ? s.date : 'invalid'
  const hasUpdate = statusUpdateText(draft) !== ''
  const doneToday = isFollowedUpToday(todo, today)

  const setNext = (date: Date | null) => afterNotes(() => useTodoStore.getState().update(todoId, { nextFollowupAt: date ?? undefined }))
  /** A date for the next follow-up (⏎ in the field, a quick button): set now, the field showing it; then on to the update line. */
  const apply = (date: Date | null) => {
    setNext(date)
    settleNext(date)
    updateRef.current?.focus()
  }
  /** The field's ×: no next follow-up, at once; the field stays empty (Mark followed up then leaves none). */
  const clearNext = () => {
    settleNext(null)
    if (current !== null) setNext(null)
  }
  const onNextKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
    e.preventDefault()
    if (e.repeat || fieldDate === 'invalid') return
    if (!sameDay(fieldDate, current)) apply(fieldDate)
    else updateRef.current?.focus()
  }

  /**
   * Mark followed up: the notes first, then the follow-up (with the update
   * line's text: one undo step); the next card opens at once. Once the
   * follow-up is written the task is marked and its typed text cleared — a
   * write that fails leaves both, the text there to try again.
   */
  const followUp = () => {
    if (fieldDate === 'invalid') return
    const options = untouched ? {} : { next: fieldDate }
    const text = draft
    const nextText = session.getState().nextDrafts[todoId]
    const before = useTodoStore.getState().todos.find((t) => t.id === todoId)?.lastFollowupAt?.getTime()
    afterNotes(async () => {
      try {
        await markFollowedUpWithUpdate([todoId], options, text)
      } catch (err: unknown) {
        console.error('[review] the follow-up could not be recorded', err)
        return
      }
      // Written: the task's last follow-up moved (a failed write leaves it, and says so itself).
      const after = useTodoStore.getState().todos.find((t) => t.id === todoId)?.lastFollowupAt?.getTime()
      if (after == null || after === before) return
      const state = session.getState()
      state.mark(todoId, 'done')
      // Only the text that was sent: what was typed since stays.
      if ((state.drafts[todoId] ?? '') === text) state.setDraft(todoId, '')
      if (state.nextDrafts[todoId] === nextText) state.setNextDraft(todoId, null)
    })
    if (isLast) {
      // The last card stays: it shows what it wrote.
      if (!untouched && fieldDate) input.settle(fieldDate)
      updateRef.current?.focus()
    }
    session.getState().next()
  }

  const nextWords = fieldDate === 'invalid'
    ? 'Fix the next follow-up date'
    : fieldDate ? `next ${formatFollowupDate(fieldDate, today)}` : 'no next follow-up'
  // What Mark followed up will do, as the follow-up popover's tooltip says it.
  const kept = untouched && current !== null && ruled === current
  const followUpWords = kept
    ? 'Record a follow-up today and keep the next follow-up'
    : fieldDate === null
      ? (current === null ? 'Record a follow-up today (no next follow-up)' : 'Record a follow-up today and clear the next follow-up')
      : 'Record a follow-up today and set the next follow-up to the date in the field'
  const { triggerProps: followUpTipProps, tooltip: followUpTip } = useTooltip(
    followUpWords + (hasUpdate ? ', and add the status update' : ''),
  )
  const hint = hasUpdate ? `With the update · ${nextWords}` : nextWords.charAt(0).toUpperCase() + nextWords.slice(1)

  return {
    today,
    draft,
    setDraft: (text: string) => session.getState().setDraft(todoId, text),
    input,
    untouched,
    current,
    fieldDate,
    hasUpdate,
    doneToday,
    typeNext,
    apply,
    clearNext,
    onNextKeyDown,
    followUp,
    afterNotes,
    hint,
    followUpTipProps,
    followUpTip: followUpTip as ReactNode,
  }
}

export type ReviewFollowUp = ReturnType<typeof useReviewFollowUp>
