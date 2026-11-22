# Text moving to check-ins

Moved whole out of the layer tables' long rows. It is merged into its destination and this file is deleted.

## From state.md

### useUIStore, BulkConfirmation, FollowupPopoverRequest, RowPopoverRequest — stores/ui-store.ts

`checkinDialog: { personIds } | null` + `openCheckinDialog(personIds?)` (de-duplicated; the people listed first, the first of them selected; none = the first row) / `closeCheckinDialog` — rendered by `checkin/CheckinDialog`. `checkinImportOpen` + `openCheckinImport({ personId? })` (also closes the check-in dialog; `checkinImportPersonId` = the person the Review widget field's Paste reply opened it for — who replied when the footer names none of your people) / `closeCheckinImport` — `checkin/CheckinImportDialog`. Mobile filter sheet: `isFilterSheetOpen`, `filterSheetFocusSearch`, `toggleFilterSheet`, `setFilterSheetOpen`, `openFilterSheetSearch`.
