import type { LaunchStep } from '../../services/app-startup'

/**
 * How long one part of launch may take before the start screen names it and
 * offers its ways out. Longer than the sync file's two timed checks
 * (`FILE_LINK_TIMEOUT_MS` each), so a check that times out goes on by itself
 * before the screen says anything.
 */
export const START_SCREEN_EXPLAIN_MS = 6000

/** What the start screen offers at a step: Reload always; the other two only at the sync file's step, while launch waits for the browser. */
type StartScreenAction = 'reload' | 'forget-file' | 'continue-without-file'

interface StartScreenCopy {
  title: string
  body: string
  actions: readonly StartScreenAction[]
}

/**
 * The start screen's words once a part of launch has taken long: which part
 * it waits on, what that means, and the ways out that are safe there — none
 * of them deletes or changes a task. `waitingOnBrowser`: at the sync file's
 * step, launch waits for the browser to hand the file over
 * (`FileStorageStatus.launchWait`), which may be given up; otherwise the
 * file's data is being loaded, and only Reload is offered.
 */
export function startScreenCopy(step: LaunchStep, waitingOnBrowser: boolean): StartScreenCopy {
  switch (step) {
    case 'database':
      return {
        title: 'Still opening the database…',
        body: 'Your browser hasn’t answered yet. If TODO2 is open in another tab or window, close it there, then reload. Your tasks stay in this browser.',
        actions: ['reload'],
      }
    case 'sync-file':
      if (waitingOnBrowser) {
        return {
          title: 'Still checking the sync file…',
          body: 'Your browser hasn’t answered about the file TODO2 syncs with. Keep waiting, or continue without the file: the data in this browser opens, sync stays paused and nothing is written to the file.',
          actions: ['reload', 'forget-file', 'continue-without-file'],
        }
      }
      return {
        title: 'Still checking the sync file…',
        body: 'TODO2 is loading the sync file’s data. A large file can take a while.',
        actions: ['reload'],
      }
    case 'tasks':
      return {
        title: 'Still loading tasks…',
        body: 'Your browser hasn’t answered yet. Reloading starts again; your tasks stay in this browser.',
        actions: ['reload'],
      }
  }
}
