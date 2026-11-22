# Text moving to planner-widget

Moved whole out of the layer tables' long rows. It is merged into its destination and this file is deleted.

## From state.md

### usePlannerStore, usePlannerWindow, plannerWindowKey, PlannerDragPreview — stores/planner-store.ts

**`drag`** (`PlannerDragPreview` or null; `setDrag`): the task drag over a Planner now — `{ tabId, over: 'tile' | 'group', key, drop, index }`: the Planner under the pointer, what is hovered, the target's key (its day's `dayKey` — Today's group and today's tile share it — or its tray's, `delayed` / `unplanned`), what a drop there does to the task's plan (`utils/planner.PlannerDrop`) and, over a group, the place the row would land at (before row `index` of the group's rows without it; null with no place: a tile, a refused drop, a task the drop wouldn't bring into the group). Set and cleared by that Planner's `use-planner-drag`; read by its tiles and groups (the marks, the slot), by the page's drag overlay (`PlannerDragLabel`) and by the drop itself (`services/planner-drop.planPlannerDrop`: the place). A zustand store, so the test setup resets it.
