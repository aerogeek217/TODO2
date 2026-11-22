# Layout ops

The operations that change a layout's table: splitting and inserting tracks, removing and merging them, and what happens to cells. The table itself is in [workspace-layout](workspace-layout.md).

## Layout ops

The ops are in `utils/workspace-layout-ops`. Each returns a normalized table, or the same layout when there is nothing to do, which `dropChangesLayout` relies on.

### Split and insert

- `splitCell`: a new empty cell on a side, taking half.
  - An even span splits on its middle line. An odd one splits its middle track, and the cells crossing it then span both halves.
  - The new cell never comes out collapsed. Split below or above a collapsed cell, the old half keeps its collapse; beside it in a collapsed row, the row expands.
- `insertTrack`: a row at the top / bottom or a column at the left / right, full width / height, holding one new empty cell.
  - It takes half the nearest weighted track's size.
  - A new column across rows that are all collapsed expands them.
- `insertTrackBeside`: a row above / below a cell's row or a column left / right of its column, on that inner line.
  - It takes half of the cell's track.
  - The cells spanning across the line grow into it, and the gaps beside them become new empty cells.
  - At an outer edge it is `insertTrack`.
- `insertTrackAt` (the edit mode's rulers): a full row / column on any line of the table.
  - The cells crossing the line grow across; its other places become new empty cells. At the edges it is `insertTrack`.
  - Given a run of lines whose tracks between are slivers (`through`), it first merges the slivers into the major track beside them. The new track then goes on the one line left, sized from that major.
  - A hovered "+" previews the result (`utils/structure-preview`).

### Remove and merge tracks

- `removeTrack` (a ruler's **Remove row** / **Remove column**), refused for an axis's last track:
  - Along the axis, a cell spanning the track (through it, or starting or ending in it) shrinks.
  - A cell lying only in it moves into its *place*: the neighboring track over its own extent. The neighbor is the track before, else the one after.
    - A place of only empty cells: the cell moves into it. Those cells give it up, and what is left of them is cut into rectangles.
    - Else its tabs join the filled cell of that place sharing the most of its edge, the first along it on a tie. A cell sticking out past the place counts only its part beside it.
    - An empty cell lying only in the track just goes.
  - The track's size goes to that neighbor when both are weighted or both fixed.
  - `trackRemoval` is the plan, which the menu's message reads.
  - No widget is ever deleted.
- `mergeTrackInto` (a sliver's **Merge into B**): `removeTrack` toward the named neighbor, so the line between them goes and its space joins that track.
- `evenTracks` (**Even all widths** / **Even all heights**): the weighted tracks of an axis take their mean weight. View state.

### Cells

- `mergeCells`: two cells whose union is a rectangle. The first grows over the second, whose tabs join its strip after its own.
- `closeCell`, **the absorb rule**:
  1. The neighbor sharing its whole edge grows over it: left, above, right, below, the first there is.
  2. Else the neighbors along one side that together cover that whole edge all grow across it.
  3. Else (the center of a pinwheel) it stays as an empty cell.
- `moveTab` / `movePanel` onto a target `{ kind: 'cell', cellId, index? } | { kind: 'swap', cellId } | { kind: 'split', cellId, side } | { kind: 'insert', edge } | { kind: 'layout' }`:
  - `swap`: a whole cell trades places with another (`swapCells`). For a tab it is a join.
  - A cell the move empties closes by the absorb rule.
  - A whole cell's move closes its old place first or places first, whichever leaves no empty cell.
- `swapCells`: two cells trade areas, each keeping its id and tabs (**Swap with ▸**, Alt+arrow onto a card, a card dropped on a slot).
- `setCellArea`: a card stretched over empty cells. `cellAreaFits` says where it may go.
- `removeTabKeepCell` (**Remove widget**): a lone widget's cell stays, empty.
- `moveEdge`: a divider ([Dividers](workspace-layout.md#dividers)).

### Collapse row

- `setTrackCollapsed`: **Collapse row** collapses every row track the cell covers, so its side-by-side neighbors fold with it.
  - The cells lying only in a collapsed track show their top lines; a cell spanning through it gets shorter.
  - Column tracks don't collapse.
- **A collapsed row expands by itself once no filled cell lies only in collapsed rows over it**: its cell closed, moved away, or grown on into an expanded row (`workspace-grid.expandOrphanRows`, the end of every op's `normalizeGrid`).
- A stored layout that arrives with such a row has it expanded when the workspace shows it, as view state (`use-expand-orphan-rows`).
