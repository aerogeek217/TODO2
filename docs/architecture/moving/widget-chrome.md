# Text moving to widget-chrome

Moved whole out of the layer tables' long rows. It is merged into its destination and this file is deleted.

## From state.md

### useUIStore, BulkConfirmation, FollowupPopoverRequest, RowPopoverRequest — stores/ui-store.ts

`widgetPopup` (`WidgetPopupTarget`: `{ kind: 'tab', tabId }` · `{ kind: 'list', tabId }` — the list a Number follows — · `{ kind: 'review' }`, or `null`; `setWidgetPopup` / `closeWidgetPopup`, opened through `services/widget-popup`): what the widget popup shows, one at a time. `popupReviewView` (`patchPopupReviewView`): the popup review's sort, kept in memory (no layout to save it in; the Review widget's sort writes here for `REVIEW_POPUP_TAB_ID`).
