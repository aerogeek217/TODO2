# Layout autosave

A layout has no Save. `stores/workspace-store` (`useWorkspaceStore`) holds the stored layouts and the open one, and writes every change at once through `layoutRepository` (`data/layout-repository`): a structural edit as one undo step, view state with no step. This file covers the store's state, the edits and their undo steps, the lists that follow an edit, view state, failed writes, and how layouts are opened, created, duplicated, renamed, reordered and deleted.

See also:

- [Workspace layout](workspace-layout.md): the table these writes change, and what is structure and what is view state;
- [Layout ops](layout-ops.md): what each edit does to the table;
- [Layout edit mode](layout-edit-mode.md): the one place a layout is not written at once. The mode holds a draft that only its Done writes.

## The store's state

| State | What it holds |
|-------|---------------|
| `layouts` | the stored layouts, in the tabs' and the picker's order: `sortOrder`, then oldest first |
| `activeLayoutId` | the open layout's id |
| `working` | the open layout as shown, with a divider drag's `live` frames |
| `saved` | the open layout as committed: every edit and view change, without a drag's frames. An edit's undo step starts from it |
| `writeFailed` | the open layout's last write failed: the top bar's `Couldn't save · Retry` |
| `writesPending` | the writes of committed edits still running: `data-layout-writing` on the layout controls, which e2e waits on |
| `repairedIds` | the layouts repaired on read that nothing has written back ([Reading a stored layout](workspace-layout.md#reading-a-stored-layout)) |
| `hydrated` | a layout has been opened |
| `resizePreview` | transient: a structural resize drag's preview |

`resizePreview` holds the probe body, the layout's id and the dragged handle. `setResizePreview(preview | null)` sets it per frame and ignores a repeat that draws the same table. It is cleared at the drag's end and by any open. It is never saved and never an undo step.

## Structural edits

Outside the layout edit mode every structural edit is written at once and is **one undo step** with the snackbar, named plainly. A structural edit is anything that changes:

- a track's id or a cell's area (a divider's Alt-drag);
- a tab's place;
- a tab's config (an editor's Save, a ⋯ menu's setting);
- a tab's kind.

The path is `edit` → `commitEdit` → `commit` → `writeLayout`. `working` and `saved` become the new layout with `modifiedAt` stamped, and `layoutRepository.putAndPrune` writes the row. In the layout edit mode `edit` changes the draft instead, as a step of the mode's own undo ([The draft](layout-edit-mode.md#the-draft)).

The store's edits and the step each commits:

| Edit | Undo step |
|------|-----------|
| `addWidget(kind, target, seed?)`, the target a `LayoutDropTarget` | `Added “<tab>”` |
| `moveTab(tabId, target)` | `Moved “<tab>”` |
| `movePanel(cellId, target)`, a whole cell | `Moved cell` |
| `removeWidget(tabId)`: the ⋯'s **Remove widget**, a tab's × (`Remove <title>`), a strip Number's × | `Removed “<tab>”` |
| `closeTab(tabId)` | `Removed “<tab>”` |
| `closeCell(cellId)` | `Closed cell`, `Closed cell “<tab>”` or `Closed cell (N tabs)` |
| `splitCell(cellId, side)`, which returns the new cell's id | `Split cell` |
| `insertTrack(edge)`, which returns the new cell's id | `Inserted row` or `Inserted column` |
| `mergeCells(aId, bId)`, `false` unless the two make a rectangle | `Merged cells` |
| `moveEdge(stretch, delta, opts, undo?)` moving part of a line (a divider's Alt-drag) | `Moved divider` |
| `patchTabConfig(tabId, kind, patch, description?)` | `Changed “<tab>”`, or the caller's own |
| `changeTabKind(tabId, kind, seed?)` | `Changed “<tab>” to <Kind>` |
| the mode's **Done** | `Edited layout “Default”`, one step for the whole session |

- A lone widget's cell stays, empty, after `removeWidget`; a cell `closeTab` empties closes ([Cells](layout-ops.md#cells)).
- A widget editor's Save names its own step: `Edited number “<name>”`, `Edited breakdown “…”`.
- `Moved divider` is a step with no snackbar (`EditUndoOptions.quiet`): the table shows the move.
- `undo.mergeKey` makes a run of edits one step (`UndoEntry.mergeKey`). The divider's arrow keys pass `divider:<identity>`.
- `addWidget` and `changeTabKind` complete the seed (`seedFor`): a new Neglect map without `seed.neglectTagIds` gets the tag store's `Project: …` tags ([Task maps](task-maps.md#config)).
- An edit whose result is the same structure (view state only) is written as view state, with no step.

## Lists follow the edit

Every list belongs to one layout ([Lists](lists.md#lists-belong-to-a-layout)).

- `putAndPrune` writes the row and, in the same transaction, removes the lists the layout owns that the row no longer names (`storedListRefs`): list tabs, and Numbers that follow a list. A Review widget's filter is temporary and names none. `layoutListRefs` says what a layout in memory shows.
  - A removed list is deleted with its ranks, and the list stores forget it (`forgetLists`).
  - A list another layout's stored row names is handed to that layout instead (`OwnedListsRemoved.handedOver`), and the list store reloads.
- An edit that would make the layout show a list it doesn't own is refused: nothing changes, and `addWidget` returns `null`. `foreignListRefs` finds them: among the lists the edit adds, one that another layout owns or that has no owner. A list that no longer exists is no one's.

## The undo step

`isLayoutEditStep` tells a structural edit's undo step. The step keeps an `EditRun`: the layout's id, its body before the first edit and after the last, what each commit removed and what its own undo removed.

- **Undo** restores the removed lists first (`layoutRepository.restoreLists`, the newest commit's first; the list and rank stores reload). Then it commits the body as before the edit.
- **Redo** restores what the undo's commit removed and commits the body after the edit the same way, which removes the edit's lists again.
- Either commit carries the view state of the moment (`utils/workspace-layout-view.withViewStateOf`) and the layout's name and hue as they are now. The view state carried:
  - sizes (`copySizes`);
  - a row's collapse where it is the same track (`sameTrackIn`);
  - each cell's active tab where the cell still holds it;
  - each tab's `viewState`.
- Both run only while that layout is open. Else `UndoRefused` says `Open layout “<layout>” to undo: <step>.` and the step stays on the stack.
- Once the layout is gone the step is dropped: `UndoGone`, `Can’t undo: <step> — its layout is gone.`
- Steps merged by a key share their run. The merged step's undo goes back to before the first edit and brings back every removal of the run.
- Undo doesn't survive a reload.

## View state

View state saves at once too, with no undo step: track sizes, collapsed row tracks, each cell's active tab, each tab's view state (a calendar's view, the rows' details width).

- `setActiveTab(tabId)`, `setTrackCollapsed(trackIds, collapsed)` and `patchTabViewState(tabId, kind, patch)` apply to `working` and `saved` and write the stored row at once.
- `setTrackCollapsed` takes row tracks by id: one, or a cell's several in one write (**Collapse row**).
- The write is `layoutRepository.updateView`: the row is read and written in one transaction, the last write wins, and `modifiedAt` is untouched.
- A failed view-state write is logged, and the change is kept for the session.

### Sizes

Sizes are view state. These change `working`, then go onto `saved` and the stored row through the same path, an axis at a time (`copySizes`):

- `setTrackSizes(sizeById, opts?)`: batched, by track id, either axis. A weighted track gets a weight, a fixed one its px.
- `copyTrackSizes(from, axes, opts?)`: a drag's frame. It copies an axis's sizes from a layout the drag computed, or puts the start's sizes back. A fit row's new height, its `fitPx`, comes with them.
- `clearTrackFitPx(trackId)`: a fit row fits again.
- `moveEdge(stretch, delta, opts)` while it only moves a whole line: its two tracks' sizes.

A divider drag passes `{ live: true }` for its frames. Only `working` changes then, with no write per frame. `endResize()`, which the divider calls once when the drag ends, saves what the frames changed. A keyboard step or a double-click saves at once.

## Write order

- Writes are made in call order: the edits' `putAndPrune` and the view changes' `updateView` transactions run in the order created.
- So a view change made right after an edit lands on top of it, and an edit's write includes every view change made before it.
- `settleLayoutWrites()` resolves once every commit's write, and what follows it, has run. The tests await it (`registerModuleSettle`), and so does a data replace before its write (`registerReplaceSettle`; [Data replaces](startup-and-data-replaces.md#data-replaces)).

## A failed write

- A write that lands clears `writeFailed` and the layout's repair mark.
- A write that fails keeps what is on screen and says so: the notice `Couldn't save layout "<name>".` and `Couldn't save · Retry` beside the layout tabs. `writeFailed` is set only while that layout is still open.
- The next commit of the layout writes all of it. **Retry** (`retryWrite()`) writes `saved` again and resolves whether it is stored.
- The lists the failed step stopped showing are deleted by that next write, which hands them to the step (`ListClaim`, `settleListClaims`); the write's own step keeps the rest. So the failed step's Undo, or Redo, brings them back.
- Leaving the layout tries once more first. `load(id)`, `createLayout` and `duplicateLayout` wait for the layout's writes still running, then retry a failed one (`readyToLeave`). When it fails again they stay on the layout and say `Couldn't save layout "<name>". Retry before leaving it, or its last changes are lost.`

A write of a layout that is gone (deleted just before the edit, or in another browser tab) writes nothing. `putAndPrune` returns `null` and no row is made again. The notice is `Layout "<name>" was deleted: this change wasn't saved.`, and `writeFailed` stays off: there is nothing to retry.

## Nothing is unsaved

Outside the mode nothing about a layout or a list is ever unsaved, so nothing asks on a layout switch, on leaving the route or on closing the tab. Only an open editor with changes asks when it is left: Edit list, a widget editor, the mode's draft ([Popovers and editors](popovers-and-editors.md)).

## The layouts

### Opening

- `init()` runs `layoutRepository.ensureDefault`, then opens the `activeLayoutId` layout, falling back to the most recently used. It is idempotent, and is called after startup has loaded the sync file.
- The page load's first `init()` also deletes the open layout's own lists that its stored row doesn't show (`pruneOwnedLists`): what an interrupted edit left. It is not undoable. Concurrent first calls share it.
- `load(id)` switches layouts and stamps `lastUsedAt` with a field patch. It never rejects: a failed read or write says `Couldn't open layout "<name>".` and keeps the open layout.
- The switch's read and writes are awaited first. Then the change on screen is one synchronous step with no view transition: every cell is new, so nothing morphs, and a transition would freeze the page while the new layout mounts, losing presses.
- `refreshAllStores` clears the undo stack and re-runs `init()` once the store is hydrated.

### New and Duplicate

- `createLayout(name)` stores an empty layout under the name, last, and opens it. It resolves `null` for a blank name or a failed write, with `Couldn't create layout "…".`
- `duplicateLayout(name)` is **Duplicate layout…** in the open layout's tab menu and the picker. The open layout as committed is stored as a new layout, last, and opened.
  - The lists it shows are copied for it in the same transaction, each as saved, with its ranks (`layoutRepository.insertWithListCopies`). The copy's tabs are repointed at the copies, and the list and rank stores reload.
  - The source keeps its own lists.
  - It resolves `null` for a blank name or a failed write, with `Couldn't duplicate layout "<name>".`

### Rename

`rename(id, name, hue?, icon?)` writes only the name, the hue and the icon ([Hue and icon](workspace-layout.md#hue-and-icon)). It is no undo step. A failed write keeps the old name and says so.

### Order

- `reorderLayouts(orderedIds, description?)` shows and saves a new order at once as one undo step, `Reordered layouts`, shown in the snackbar. Layouts it leaves out keep their order after the named ones.
- `moveLayout(id, toIndex)` moves one layout: the tabs' drag, **Move left** / **Move right**, the picker's drag. Its step is `Moved layout “<name>”`. No move makes no step.
- A failed write puts the order back with a notice, resolves `false` and leaves no undo step.
- The step's undo and redo re-save the order. They throw on a failed write, so the entry stays.
- **New layout** and **Duplicate layout** put the new layout last.

### Delete

- `delete(id)` refuses the last layout. It never rejects: a failed delete says so and resolves `false`.
- The layout's lists and their ranks go with it in one transaction (`deleteUnlessLast`). It is not undoable, and the confirm says so when lists go with it.
- Deleting the open layout opens the most recently used. A failure after the delete committed (opening the next layout) drops the deleted layout's tab and says `Deleted layout "<name>", but couldn't open another. Reload the page.`
- The undo steps of its edits then say the layout is gone.

### Requests from the palette

`ui-store` holds `layoutRequest: LayoutRequest | null`, set by `requestLayout` and cleared by `clearLayoutRequest`: a layout action asked for outside the layout controls.

- It is `{ kind: 'switch', layoutId }`, `{ kind: 'new' }` or `{ kind: 'duplicate' }`. `new` may carry a `transfer` ([Move / Copy to layout](cross-layout-moves.md)).
- `LayoutControls` takes it and runs it as its own controls do.

## The repository

`layoutRepository` covers the `layouts` table and the `activeLayoutId` setting (`getActiveId` / `setActiveId`).

Reads:

- `getAll` returns the layouts in the picker's order (`byLayoutOrder`: `sortOrder`, then oldest first, then id), and `get` returns one. Both return `ReadLayout`s ([Reading a stored layout](workspace-layout.md#reading-a-stored-layout)).

Layout rows:

- `insert` adds a layout after the others. Its `sortOrder` is picked in the add's transaction.
- `put` keeps the stored `sortOrder`, so a write never undoes a reorder. It never makes a new row: a layout deleted while the write waited stays gone. It resolves whether it wrote.
- `reorder(orderedIds)` writes the order.
- `touch(id, lastUsedAt)` and `rename(id, name, hue?, icon?)` are field patches that leave the rest of the row as stored. With `hue`, `rename` sets it in the same update, and `null` removes the key. With `icon` (an `IconValue`), it sets the layout's icon too.
- `ensureDefault()` creates an empty `Default` layout and makes it active when the table is empty. The count check and the insert share one read-write transaction, so concurrent callers (StrictMode's double effects, several mounts) create exactly one.

Rows with their lists, each in one read-write transaction over `layouts`, `listDefinitions` and `listOrders`:

- `putAndPrune(layout)`, a committed layout edit: `put`, then the lists the layout owns that the row as written no longer names are removed. It returns `OwnedListsRemoved`, or `null` when the layout is gone: nothing is written or removed.
- `pruneOwnedLists(layoutId, shown, only?)` deletes the lists the layout owns (among `only` when given) that are neither in `shown` nor named by its stored row, with their ranks. `storedListRefs` reads the row as stored, by a tolerant walk of the raw row.
- `OwnedListsRemoved` is `{ deleted, rows, handedOver }`. `rows` holds the deleted lists and their ranks, for `restoreLists`. `handedOver` holds the lists another layout's stored row names: each is given to the first such layout in the picker's order instead of deleted. Only data a file or the audit's adopt left is that way.
- `restoreLists(rows)` puts lists back as their layout's lists, with their ranks. While one of their layouts is gone it restores nothing and returns `false`.
- `deleteUnlessLast(id)` refuses the last layout. It deletes the layout with the lists it owns (`ownerLayoutId`) and their `listOrders`, handing over a list another layout names. It returns `OwnedListsRemoved`, or `null` when nothing was deleted.
- `insertWithListCopies(layout, copies)`, Duplicate layout: it inserts the layout as `insert` does and adds each `ListCopy` (`{ from, def }`) as a new list owned by it, with `from`'s ranks copied. It points the layout's tabs at the copies (`repointLayoutLists`) and returns the new id and the old → new list ids.
