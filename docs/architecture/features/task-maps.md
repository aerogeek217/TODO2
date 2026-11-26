# Task maps

The task maps are whole widgets that draw many tasks at once: the Neglect map (kind `neglect`) and Work clusters (kind `clusters`, `components/workspace/clusters/`). The menus list them under **Insights** after the glance kinds, but they are not glance widgets (see [Glance widgets](glance-widgets.md)). Their settings are layout config; Work clusters has none. The squares of every list of a layout at once are the [List board](list-board.md)'s.

## Neglect map

It plots every open task the screen filter keeps by days untouched (`modifiedAt`, capped at 60) against days until its date (14 late … 30 ahead). The pure placement is in `utils/neglect-map`.

- **A task's date** is the earlier of its due date and its next follow-up (the due date on a tie). The row and the dot's tooltip name the one that placed it: `2d late`, `due in 3d`, `follow-up today`, `follow-up 2d late`.
- **A task whose only date is a planned day is left off the map**: no dot, no zone, no count. The Planner holds it.
- **Untouched is Settings' Stale after** (`staleAfterDays`, read live), the filter word `stale` ([Filters](filters.md#the-words-that-read-settings)). The map has no threshold of its own.
- **Soon is Settings' due-soon range**, the filter words `due soon` / `followup soon`: late, or within the range (`utils/urgency.isDueNear`).

The axes' marks: `14d late` · `Today` · `+Nd` (the due-soon line) · `+30d` down, `0d` · Stale after · `30d` · `60d+ untouched` across. `+Nd` and `30d` give way where their label would come within 4px of a neighbor's in the plot as measured (`utils/neglect-labels.uncrowdedMarks`); the others always show.

Stale after's line, its mark, the shaded Slipping corner and the strip's Forgotten part are drawn only while it is on and under the 60-day cap (`staleLineShown`). Past the cap a task is still stale by its real days, on the cap. With Stale after `0` (off) nothing is stale, so nothing is Slipping, Drifting or Forgotten.

### Zones

- A task due or to follow up soon or late, and stale, is **Slipping**: the shaded corner.
- The other corners are In hand (soon, not stale), **Later** (later, not stale) and Drifting (later, stale).
- A strip under the plot holds the tasks with neither date. They are **Forgotten** once stale.
- Each zone's word carries its count and opens its tasks as a list in the task dialog (`glance-drills.neglectZoneDrill`). A zone with none is plain words.
- The words are the four corners', and the strip's **No dates** (every task in it) and Forgotten.

### The list

- The list sits beside the plot only while the widget is at least 900px wide (`NEGLECT_SIDE_LIST_MIN_PX`). On a phone it sits under the plot. It is the medium face alone.
- Narrower, the plot fills the widget, there is no list, and the dots carry no numbers.
- **A switch over it, `Slipping N | Forgotten N`, picks the zone it lists.** The picked side has a tint and its word its zone's color. Until one is picked, it shows Slipping, or Forgotten while nothing is slipping and something is forgotten. The pick is never saved.
- Slipping lists latest first, then the longest untouched, numbered as its dots are badged. Forgotten lists the longest untouched first, each row with a yellow dot, and the plot's dots carry no numbers.
- A row reads the date that placed it and the days untouched (`no dates · 63d untouched`). It opens the editor.
- Past nine rows, `N more` opens the zone's tasks in the task dialog. The small face keeps the Slipping count.

### Dots

- A dot opens the editor. It takes a press 24px round, though drawn at 9px (an `::after`); where two overlap, the dot on top takes it.
- A drag on empty plot lassoes dots into the widget selection, which the bulk bar acts on.

### Config

The tab's config is layout config (`NeglectTabConfig` in `models/workspace-layout`): `colourBy` and `hiddenStatusIds`, both set in its ⋯ (`neglect-menu`). The tab has no view state.

- **Color by** is `colourBy` (`NeglectColourBy`): the picked tags (`{ kind: 'tags', tagIds }`), People (`{ kind: 'people' }`) or None (`{ kind: 'none' }`).
- A deleted tag stays in `tagIds` and stops coloring, as in a filter.
- **Hide statuses ›** is `hiddenStatusIds` (absent: none): a checkbox per status, its mark in its color, the item's value naming the hidden ones (`None` when none). A task with a hidden status leaves every zone, count and Review. A deleted status's id stays and hides nothing.
- A new map (`defaultNeglectConfig`) colors by the `Project: …` tags. The workspace store passes those tags as `TabSeed.neglectTagIds` (`utils/neglect-map.projectTagIds`).
- The layout repair (`data/layout-shape.pickNeglectConfig`) keeps only the model's keys. A stored `untouchedDays` is dropped quietly, with no repair notice and no schema step.

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
