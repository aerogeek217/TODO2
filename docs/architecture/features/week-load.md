# Week load

How well the dates that put tasks on each day were kept, week by week, against the usual week. A meter in the [Planner](planner-widget.md)'s top line opens a popover with one week's chart, day by day. It always counts every task: the [screen filter](screen-filter.md) is never applied, so the meter means the whole workload whatever filter is on.

## The rules

`services/stats/week-load.computeWeekLoad` is pure. `hooks/use-week-load.useWeekLoad` hands it every task, their events (`trend-events-store`'s `week-load` window: from 8 weeks before this week's start, the trend's event types plus `followup`, `followedUp` and `planned`), the status updates, Settings' first day of the week (`weekStartsOn`), the two log stamps and now. The hook is `null` until the events are read, and memoized on the tasks, the events, the status updates, the day and the settings.

The result holds 15 weeks, 8 back to 6 ahead, this week at offset 0. Each week has its 7 days, and each day, for each kind — `due`, `followup`, `planned` —, the counts `done`, `late`, `moved`, `removed`, `ahead`. Each week also has its totals, its slipped share and its notes. The result also holds the usual week.

### Where a date lands

- A task's **Planner day** at a moment is its planned day if it has one, else the earlier of its due date and next follow-up (the due date's on a tie): `utils/planner.plannerNaturalDay`'s rule without its clamps. Its **kind** is the date that put it there.
- A task **lands on day D** when, open, its Planner day was D at D's start or became D during D. It lands once per day, under the kind that put it there first.
- A task can land on several days of a week: a due date moved from Monday to Wednesday on Monday slips on Monday and lands again on Wednesday.
- A date moved off D before D began never lands on D: that is planning ahead.
- A deleted task's history goes with it, so it counts nowhere.
- The fields come from the one replay, `task-history.taskFieldReplayAt`, read at each day's start and after each change during it.

### What became of it

On a day gone by, a landing is **done** when, by the end of D:

- **due**: the task was completed (a repeating task's advance counts: a `deadline` event to exactly the date its rule advances to that day);
- **follow-up**: the task was followed up (a `followedUp` event) or completed — a follow-up moved by Mark followed up is followed up, not moved;
- **planned**: the task was completed, followed up, or got a status update dated from the day it was planned for D through D.

Otherwise it **slipped**. It was **late** if the date was still on D when D ended (completed later, or still open), **moved** if its Planner day changed to another day, or **removed** if the date was cleared and nothing else put it on D.

**Today**, what is done so far is done, a landing moved or removed today has slipped, and the rest is still **ahead**. **Days to come** count the tasks' current dates, all ahead.

The **slipped share** (`slipPct`) is `slipped / (done + slipped)` over the week as a whole percentage, or null when nothing has closed.

### The usual week

- `usual.perWeek` is the median number of tasks completed per week over the 8 full weeks before this one, zeros included. It may be a half.
- `usual.weekdayShares` are those weeks' completions by weekday, from `weekStartsOn`. They are even when there were none.
- This week is never part of it.

### Before the logs reach back

- A day before `planLogSince`'s day places tasks without their planned day. The note says `Planned days are recorded from Nov 25`.
- A day before `historyLogSince`'s day places them without their follow-up. The note says `Follow-ups are recorded from …`, with the year when it isn't this one.
- A stamp not yet written reads as now.

## The meter

`planner/WeekLoadMeter` sits in the Planner's top line, before Reset plan. It is drawn only while the Planner is alone in its cell.

- A 56 × 6px bar of this week's dates in the kinds' solid colors: due, then follow-up, then planned, each as long as its count. A dashed mark sits at the usual week. The scale is the larger of the load and 1.5 × the usual week.
- Then `19 / 13`: the load, then the usual week.
- Its accessible name and tooltip: `This week: 19 dates, usual 13`.
- A click opens or closes the popover under it (`aria-expanded`, the open trigger's ring). Esc hands the focus back to it.
- It draws nothing until the events are read.
- **In a widget 540px wide or less it is not drawn**, before Reset plan's words go at 420px. Measured in Chromium: with the name shown, the week arrows in the top line, a badge and a range across two months, the line keeps about 40px to spare at 541px.

**The usual week is shown whole**: a half rounds up (12.5 → 13). Every comparison in words (the pill, the line under the chart) uses that shown number, so the words agree with what is on screen. The marks sit at the exact value.

## The ⋯ menu's Week load…

A cell of tabs, the widget popup and a narrow widget have no meter. The widget's ⋯ menu has **Week load…** between Unplanned filter… and Reset plan › while the Planner is drawn (`planner-reset.usePlannerMenuEntries`).

- It sets `planner-store.weekLoadTabId`. `WeekLoadHost`, on the workspace page, opens the popover beside that tab's widget (the popup's while the popup shows it), on its right, or on its left where the right has no room.
- A press on the widget closes it. Esc hands the focus back to what opened it (the ⋯ button), else to the widget's first control.
- It closes with the widget editors (`registerEditorFields`): Settings opening, the widget popup, a data replace, another editor opening.

## The popover

`planner/WeekLoadPopover`, a `dialog` named `Week load`, on the shared popover root (`usePopoverAnchor` with a caret: under the meter on its right edge, flipped above it near the viewport's foot). It opens on this week every time and takes the focus.

Top down:

- **The header**: `‹`, `This week · Nov 23 – 29`, `›`. Other weeks are `Last week`, `3 weeks ago`, `Next week`, `In 2 weeks`. The arrows step one week and are inert at either end; an arrow going inert keeps the focus in the popover.
- **The summary**: the load, `dates · usual 13`, then the pills:
  - `50% slipped`, on past weeks and this week, once something has closed;
  - `6 over usual`, `Room for 4` or `At usual`.
- **The day chart**: 7 columns over a baseline, about 120px tall. Each column holds the day's count above it and one box per kind, bottom up: due, follow-up, planned.
  - A box is outlined in its kind's color and filled from the bottom as far as its dates were done, so it reads as a progress bar. Its empty part is slipped on a day gone by and still ahead on a day to come.
  - A dashed mark across the column sits at that weekday's usual: `usual.perWeek × weekdayShares[i]`.
  - Every column shares one scale (`week-load-words.chartScale`): the busiest day of all 15 weeks, or the highest usual mark, never under 6. So the weeks compare as they are stepped.
  - Each column is `role=img`, its name and tooltip the day in words: `Wed, Nov 25: 3 due (2 done, 1 late); 2 follow-up (2 ahead)`, or `Thu, Nov 26: nothing`.
  - Under the baseline, the weekday and date; today's in the accent.
- **The legend**: Due, Follow-up, Planned, Usual (the dashed line), and the empty box: `Slipped` on a past week, `Slipped or ahead` this week, `Ahead` on a week to come.
- **One line of words**:
  - a past week: `13 of 26 slipped: 4 late, 8 moved, 1 removed.`, or `Nothing slipped.`;
  - this week: `12 still ahead this week; 2 slipped so far (2 moved).`;
  - a week ahead: `Already over your usual week.`, `Already at your usual week.` or `Room for 4 more before your usual week.`
- **The notes**, one line each, when the week reaches back before a log began.

Esc and a press outside close it; Esc stops there, so a widget popup behind it stays open.

### Colors

The kinds' colors are the app's: due `--color-deadline`, follow-up `--color-followup`, planned `--color-week-load-planned` (the plan tick's `--color-text-secondary`), all in `tokens.css`, so both themes come from the tokens.

## Where it lives

| Part | File |
|---|---|
| The statistic | `services/stats/week-load.ts` |
| The hook | `hooks/use-week-load.ts` |
| The meter | `components/workspace/planner/WeekLoadMeter.tsx` |
| The popover and its host | `components/workspace/planner/WeekLoadPopover.tsx` |
| The words and numbers | `components/workspace/planner/week-load-words.ts` |
| The styles | `components/workspace/planner/WeekLoad.module.css` |
| The ⋯ entry | `components/workspace/planner/planner-reset.tsx` |

Tests: `src/test/services/stats/week-load.test.ts` (one per rule), `src/test/hooks/use-week-load.test.tsx`, `src/test/components/workspace/planner-week-load.test.tsx` (the meter, the popover's weeks, stepping, the ⋯ entry), `e2e/planner-week-load.spec.ts` (placement and flip, the narrow widget, focus on Esc).
