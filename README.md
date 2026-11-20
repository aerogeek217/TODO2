# TODO2

**A task manager for people who track a lot of work across a lot of people — and want all of it on one screen, on their own device.**

Lists, a calendar and at-a-glance numbers sit side by side in a workspace you arrange yourself. Your tasks never leave your browser: no account, no server.

**[Open TODO2](https://aerogeek217.github.io/TODO2/)** · [Download the offline file](https://aerogeek217.github.io/TODO2/todo2.html) · [What changed](CHANGELOG.md)

![A TODO2 workspace: a task list, three counts, a breakdown by person and this week's calendar](docs/screenshots/workspace.png)

## Why TODO2

- **Yours alone.** Everything is stored in your browser and works offline. There is nothing to sign up for, and your tasks are never sent anywhere.
- **One screen, your layout.** Split the workspace into cells and put a list, a calendar, a chart or notes in each. An edit mode rearranges the grid, and any widget opens larger when you need room. Save as many layouts as you need and switch between them.
- **Built for following up.** Every task can have people, a next follow-up date and dated status updates, so "what did we last hear, and when do I ask again?" always has an answer.

## A closer look

### Lists that stay readable

Filter, group and sort each list its own way. Rows stay quiet until something needs you: color is saved for what is overdue, due soon or waiting on a follow-up.

![A task list grouped under headings, with priorities, dates, people and tags on each row](docs/screenshots/list.png)

### Everything about a task, and a way to walk through them

A task holds its priority, status, people, tags and due date beside its notes, a checklist and a dated log of status updates. The Review widget steps through one person's tasks, or any filter you type, a card at a time: type what you learned, press Enter, and the task is marked followed up and the next card opens.

![The Review widget: a queue of one person's tasks on the left and the current task's full card on the right](docs/screenshots/review.png)

### Plan the day and the week

The Planner shows today beside the next seven days. Tasks land on the day they are due or due for a follow-up, and you drag anything else onto the day you plan to do it. Dragging a follow-up moves its date, a due date never moves, and Focus tasks without a day wait in a group of their own.

![The Planner: a strip of the next seven days over today's tasks on the left and the days ahead on the right, with Focus tasks that have no day below them](docs/screenshots/planner.png)

### Numbers and charts from your own filters

Count anything you can filter. Break your open work down by person, tag, status or priority, and click any number to see the tasks behind it.

![Three number widgets, a breakdown of open tasks by person, and a created-versus-completed chart](docs/screenshots/insights.png)

### Type it the way you'd say it

Press `Ctrl` + `Space` anywhere and type. `@` adds a person, `#` a tag, `!` a status, and `/due fri` a due date, each turning into a chip as you type.

![Quick Add with a tag, a due date and a person recognized as you type](docs/screenshots/quick-add.png)

### And also

- A week and month **calendar** you can drag tasks onto
- A **Neglect map** of what is slipping, **Work clusters** of who works on what, and a **List wall** showing every list at once
- Free-form **notes** that turn into tasks
- **One filter for the whole screen**: type `@priya #launch due fri` in the top bar, and pause it with a click
- **Check-ins**: copy a status request for each person from their open tasks into your own message, then paste the reply back in
- A **command palette** (`Ctrl` + `K`) and editable keyboard shortcuts
- **Repeating tasks** on any interval (`2w`, `3m`), **undo** for nearly everything, dark and light themes, and a phone layout

## Get started

| | |
|---|---|
| **Online** | Open **[aerogeek217.github.io/TODO2](https://aerogeek217.github.io/TODO2/)**. Your tasks are saved in that browser. |
| **Offline** | Download **[todo2.html](https://aerogeek217.github.io/TODO2/todo2.html)** and open it. It is a single file that makes no network requests. |

**Keeping your data safe.** TODO2 takes a backup inside the browser every day. For a copy outside the browser, export to JSON or Markdown at any time, or (in Chrome or Edge) connect a sync file in Settings and TODO2 keeps that file up to date. Put the file in a synced folder to use it on more than one computer.

## Development

Requires Node 22.13 or later.

```
npm install
npm run dev
```

The dev server runs on `http://localhost:5180`.

| Command | What it does |
|---|---|
| `npm run build` | Lints, then builds both outputs into `dist/`: `index.html` (online) and `todo2.html` (offline, single file) |
| `npm test` | Unit and component tests (Vitest) |
| `npm run test:e2e` | Browser tests (Playwright) |
| `npm run lint` | ESLint |

Built with React 19, TypeScript, Vite, Zustand, Dexie (IndexedDB), dnd-kit, CodeMirror and React Router. Architecture notes are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## License

[MIT](LICENSE)
