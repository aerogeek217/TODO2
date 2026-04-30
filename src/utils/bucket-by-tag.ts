/**
 * Untagged-fallback bucket key + label, shared between
 * `ListView.buildTagSections` (ListView grouping) and
 * `dashboard-lists.bucketByTag` (custom-list interpreter). Surfaces are
 * expected to use these constants so the "no tag" group renders identically
 * across views.
 */
export const UNTAGGED_BUCKET_KEY = 'no-tag'
export const UNTAGGED_BUCKET_LABEL = 'No tag'
