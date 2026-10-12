# Check-in reply captures

Pasted replies to the sample check-in email (the four tasks in `sample-tasks.ts`, sent to "Marcus Chen" on 2026-10-12), read by `src/test/services/checkin-reply/fixtures.test.ts`.

Each capture is `<name>.html` and / or `<name>.txt` — the `text/html` and `text/plain` flavours of one paste — plus an optional `<name>.expected.json` (footer, per-task blocks, changed fields and merged notes). Any new pair dropped here is tested automatically: without an `.expected.json` it is checked for the general contract (the footer is read, every ref matches a sample task, the HTML and plain-text readings agree).

## Synthetic captures

The `synthetic-*` files are **hand-made imitations**, not real mail-client output. They mimic the reply edits from the manual test (an `x` in task 2's Completed box, task 1's Progress changed, a line added to task 3's Notes and one of its bullets edited):

- `synthetic-new-outlook-inline` — new Outlook / Outlook on the web: `elementToProof` / `x_` classes, `rgb()` inline styles, `divRplyFwdMsg` header, a Safe Links–wrapped link; plain text with tab-separated cells.
- `synthetic-classic-outlook-inline` — classic Outlook (Word editor) clipboard HTML: `xmlns:o` document, `<style>` block, `MsoNormal` / `MsoNormalTable`, `<o:p>`, `mso-*` styles, Word list paragraphs with `mso-list:Ignore` bullets, a bold run split in two; Word's plain text with tabs and `·` bullets.
- `synthetic-classic-outlook-plain-quoted` — a plain-text reply with `> ` quoting and lines wrapped at about 76 columns (a wrapped title and a wrapped Progress value).

## Real captures

Save real ones as `new-outlook-reply.html` / `.txt`, `classic-outlook-reply.html` / `.txt` (any name works). Capture them from a `paste` event (what the import dialog reads), not `navigator.clipboard.read()` (Chromium sanitizes that HTML). Replace real names, email addresses and other personal details with placeholders before committing.
