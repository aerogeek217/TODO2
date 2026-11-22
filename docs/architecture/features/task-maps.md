# Task maps

The task maps are whole widgets that draw many tasks at once: the Neglect map (kind `neglect`), Work clusters (kind `clusters`, `components/workspace/clusters/`) and the List wall (kind `listwall`, `components/workspace/listwall/`). The menus list them under **Insights** after the glance kinds, but they are not glance widgets (see [Glance widgets](glance-widgets.md)). Their settings are layout config; Work clusters and the List wall have none.

## Neglect map

It plots every open task the screen filter keeps by days untouched (`modifiedAt`, capped at 60) against days until due (14 late … 30 ahead). The pure placement is in `utils/neglect-map`.

### Zones

- A task due soon (Settings' due-soon range) or late, and untouched for the tab's threshold ([Config](#config)), is **Slipping**: the shaded corner.
- The other corners are In hand, Planned and Drifting.
- A strip under the plot holds the tasks without a due date. They are **Forgotten** once untouched.
- Each zone's word carries its count and opens its tasks as a list in the task dialog (`glance-drills.neglectZoneDrill`). A zone with none is plain words.
- The words are the four corners', and the strip's No due date (every task without one) and Forgotten.

### Slipping list

- The numbered Slipping list sits beside the plot only while the widget is at least 900px wide (`NEGLECT_SIDE_LIST_MIN_PX`). On a phone it sits under the plot.
- Narrower, the plot fills the widget, there is no list, and the dots carry no numbers.

### Dots

- A dot opens the editor.
- A drag on empty plot lassoes dots into the widget selection, which the bulk bar acts on.

### Config

The tab's config is layout config (`NeglectTabConfig` in `models/workspace-layout`): `colourBy` and `untouchedDays`, both set in its ⋯. The tab has no view state.

- **Color by** is `colourBy` (`NeglectColourBy`): the picked tags (`{ kind: 'tags', tagIds }`), People (`{ kind: 'people' }`) or None (`{ kind: 'none' }`).
- A deleted tag stays in `tagIds` and stops coloring, as in a filter.
- The threshold is `untouchedDays`: a whole number from 1 to 59 (`isNeglectUntouchedDays`, `NEGLECT_UNTOUCHED_MAX`), so its line stays left of the 60-day cap. The menu offers 7, 14, 21, 30 and 45 (`NEGLECT_UNTOUCHED_CHOICES`).
- A new map (`defaultNeglectConfig`) colors by the `Project: …` tags at 14 days (`DEFAULT_NEGLECT_UNTOUCHED_DAYS`). The workspace store passes those tags as `TabSeed.neglectTagIds` (`utils/neglect-map.projectTagIds`).

### Names beside dots

A task's name stands beside its dot where it fits (`utils/neglect-labels.placeNeglectLabels`).

- It works over the dots as drawn and each name's measured width.
- The boxes are in a grid, so a name looks only at those near it. The work is capped (`NEGLECT_LABEL_WORK_MAX`).
- A name goes right of the dot, else left, clear of every dot, badge, other name and the plot's own words.
- The Slipping tasks get their names first, then the flagged ones.
- A name is cut with an ellipsis where there is less room than the name (at most 160px), and is absent under 56px.
- The names take no press, so a bigger map simply names more of its tasks.

## Work clusters

Its face is picked by `utils/widget-face.taskMapFaceFor`. The graph and its deterministic force layout are in `utils/work-clusters`.

- It draws the open tasks' people and tags as bubbles sized by their tasks.
- A person is joined to a tag by the tasks they share.
- Clusters are found by label propagation. Each is outlined and named by its biggest tag, and its name opens its tasks.
- Bridges between clusters are drawn in amber.
- A bubble opens the person / tag menu.
- The widget name's tooltip is the legend. There is no ⓘ on a widget.

## List wall

Its data is `hooks/use-list-wall`.

- It shows every list tab of the layout at once: a block per list, a square per open task the list shows.
- A list shows what its tab would: its filter, prompt pick and the screen filter.
- The trouble comes first: overdue, due soon, follow-up late, on track, stale. That state is the square's fill.
- A task's priority is a ring, with Focus's glow, as on the task's checkbox (`PriorityRing`).
- The blocks sit side by side, as many as fit at 8 squares across, sharing the width (`list-wall.wallShape`).
- A wide cell shows every list in one row, never wrapping into empty width.
- A block has 2–6 rows of squares, and up to 12 in one row of blocks.
- The widget name's tooltip is the legend, as Work clusters' is.
- A list's name brings its tab to the front of its cell. A square opens its task.
- In a narrow cell, at most 560px wide, it draws a bar per list instead (`listWallFaceFor`). A short cell keeps the blocks, with fewer rows.
