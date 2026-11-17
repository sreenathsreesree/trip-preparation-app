# Consolidated UX & functionality upgrade

What changed, how it is built, and what still needs a real device or a deployment.

## Invitation links
- New links: `tripprep://join/<token>` (fixes the `tripprep:///join/…` links built by
  `Linking.createURL`), and — when `EXPO_PUBLIC_INVITE_HOST` is set at build time —
  `https://<host>/join/<token>` as the primary link, on its own line so messaging apps
  linkify it. The bare code is always included.
- `src/app/+native-intent.tsx` normalises every incoming form (https, custom scheme with two or
  three slashes, encoded tokens) to `/join/<token>`. Trips → **Join** accepts a pasted link or code.
- Joining still needs an explicit tap; expiry, revocation and the use limit are enforced by the
  database when accepting (unchanged).
- **Pending (owner action, free):** deploy `server/invite-links/worker.mjs` (assetlinks.json +
  browser fallback page with an `intent://` button) and set `EXPO_PUBLIC_INVITE_HOST`; see
  `server/invite-links/README.md`. `app.config.ts` then adds a verified App Link intent filter.
  Until then, the custom-scheme link is not linkified by every messaging app; the code works.

## Places: search, Google Maps links, Android share
- Debounced (350 ms) OpenStreetMap search-as-you-type with cancellation, session cache, simpler
  spelling fallbacks and labels with kind, locality, district and state (`places/placeSearch.ts`).
- One field accepts names, coordinates (decimal, N/S/E/W, degrees-minutes-seconds), long Google
  Maps links (place, search, directions, `?q=`, `!3d…!4d…`, `@lat,lng`), `geo:` URIs, OSM links
  and short `maps.app.goo.gl` links (followed online; never guessed). Coordinates are named by
  OSM reverse geocoding. A preview is shown before saving (`places/sharedLocation.ts`).
- **Android share target:** local Expo module `modules/share-intake` (Kotlin, `ACTION_SEND`
  text/plain) and its config plugin. Google Maps → Share → Trip Prep opens **Add to a trip**:
  preview, choose trip, add as route stop / main destination / place inside a destination,
  duplicate check (same id, within 120 m, or same name), saved only on **Add to trip**.
  The native module is compiled only in an EAS/dev build; it is absent on web and in older builds.

## Trip dashboard
Scenic header (cover with dates and route), Plan Destinations as the primary card (counts,
thumbnails, route order), Start / Continue journey (opens the Navigation view, never starts
navigation; after the journey it opens Memories), one combined "prepared overall" number
(checklist readiness 70 %, packing 30 % when there is a list — both parts shown), compact links
(Clothing, Journal, Memories, Group Trip, My Trip), weather folded by default. Checklist sections
and tools are unchanged.

## Destination page
Taller cover with location and status over it, compact action tiles, compact location row, and
the Overview fields in sections that open on tap. No field was removed.

## Route tab
Only main destinations are listed and dragged; places inside travel with their destination
(older routes that contain them keep their saved positions). Thumbnails, leg connectors with road
distance and time, totals, and a Live / Saved / Unavailable tag; missing legs are never estimated.
Suggest a shorter order reorders main stops only, still a preview applied on confirmation, with
restore.

## Destination images
Cover search order: OSM Wikipedia tag → article titled like the place → search with region →
search by name → articles within 3–15 km → Commons photos within 2 km (photos only, no maps or
logos). URLs are validated (https, upload.wikimedia.org, jpeg/png/webp/gif). A 330 px thumbnail is
stored on the device for cards (`auto_cover_thumbs`); missing device copies are re-downloaded;
at most two searches run at once. Credit and licence stay on the destination cover. The user's
own cover, then their first Memories photo, always win over automatic images.

## Memories
`/trips/[tripId]/gallery` is a trip gallery: by place (plan order, favourites first), by day, or
albums. Full-screen viewer with a Details action (caption, favourite, link to the destination's
rating / visit date / moments). Several photos can be added at once to a destination's folder (the
same Drive upload queue and folders as before). Albums only reference photos: removing a photo
from an album or deleting an album never deletes a photo on the device or in Drive.

## Clothing & luggage
`/trips/[tripId]/clothing`: starter categories (all editable), grid or list, items as ordinary
packing entries (so packed state, bags, inventory reservations and packing progress keep working),
added by hand or linked from Inventory (the Inventory record is never copied or changed), quantity,
notes, packed, bag and category per item, bag-wise progress. Deleting a category or a bag that
holds items asks where they go. Clothing is never part of a Group Trip.

## PDF import
Extraction now follows inherited page resources and form XObjects, and explains encrypted PDFs and
fonts without text maps. Parsing understands Day N / DAY 01 / 2nd Day / Second day, date headings,
"N nights" sections, headings followed by bullets and plain lists. Unrecognised lines become
unticked notes (never dropped). The preview explains what was and wasn't read and can show the
extracted text. **OCR:** not included — reliable offline OCR needs new native modules (a PDF page
renderer plus an on-device text recogniser) that can't be verified here; the paste-text fallback
suggests copying text with Google Lens.

## Data
Local migration 14 (additive, new tables only): `auto_cover_thumbs`, `memory_albums`,
`memory_album_photos`, `memory_photo_notes`, `clothing_categories`, `clothing_items`. All are
local-only (see `sync/tables.ts`), per account partition. **No cloud migration** is needed for
this phase; nothing was deployed.

## Clothing and checklist sections (Nov 2026)

- The dashboard's **Clothing** tile now opens the trip's *Clothing* checklist section — the same
  screen the Checklist tab opens (tasks with priority, groups, Add from Inventory). The section is
  found by name (a custom section called "Clothing", else one like "Clothes" or "Outfits") or created
  once; nothing is copied. Bags and packed status remain one tap away ("Bags and packed status").
- Groups (create, rename, delete with "move them to…" or "keep without a group", add into a group,
  move between groups) work in every section. The task editor can also change a task's group and
  shows the Inventory item it is linked to.
- Add from Inventory is offered in Packing and the user's own sections, except ones about
  documents, tickets/bookings, vehicles, errands or shopping. Items are linked, never copied; an
  item already in a section is not added twice, and moving a task into a section that already has
  that item is refused with an explanation.
- No schema change (local schema stays v16).

## Dashboard 2.0 and compact Checklist trips (Nov 2026)

- **Trip dashboard = travel command centre:** compact header (cover, or a layered scenic
  fallback with no photo-error panel; dates, length, travellers, trip type, route), Journey
  overview (destinations, places, route, days, Plan destinations), Journey readiness (one
  percentage, done/total, progress bar, *Open preparation checklist*), the journey button, six
  shortcuts and folded weather. No checklist sections, tasks, templates or tools on the dashboard.
- **Checklist tab:** each upcoming trip is a compact card (dates, timing, %, bar, done/total,
  open essentials). Tap to show its sections; one trip open at a time. The expanded card also
  holds the checklist tools that left the dashboard (Manage sections, Add from template, Save as
  template, Add vehicle checks). *Open preparation checklist* opens the Checklist tab with that
  trip expanded (listed even if it has ended).
- Both screens use `checklistProgress()` on the same loaded checklist, so the figures always match.

## Unified Packing and Checklist (Nov 2026) — phase 1: Packing is the single source

- **Packing list = all packing items.** Categories (Clothing, Footwear, Toiletries…) are the
  Inventory categories; **groups inside a category are its subcategories** (Tops, Bottoms…), so
  there is no second grouping system. Category screen: All / To pack / Packed, groups (create,
  rename, reorder, delete — items stay: keep in the category or move to another group), *Move to
  group*, priority (Essential / Recommended / Optional) in the item editor.
- **Deleting a custom category or group never deletes items:** the user chooses where its packing
  and Inventory items go (`deleteCategoryMoving`). Starter categories stay protected.
- **Clothing organiser → Clothing groups:** its categories that hold items become Clothing groups
  (repeat-safe; ids derived from the name; the organiser's tables are kept, unused). All Clothing
  entry points (dashboard tile, old links) open Packing → Clothing.
- **Old Packing / Clothing checklist tasks** appear in Packing under *From your old checklist*:
  *Move to packing list* (item created and verified first, then the task is removed; recorded so
  it can never convert twice), *Keep in checklist*, *Remove from trip* — each confirmed. The old
  section stays in the Checklist while it has tasks; adding new tasks there points to Packing.
  Checklist tasks are personal (shared trips use the separate group workspace), so converting
  never moves group data into a private list.
- **New trips** no longer get a Packing checklist section; templates that contain one still work
  (their tasks arrive as an old-style section and can be moved into Packing).
- **Readiness** (dashboard and Checklist) = checklist tasks + packing items, each counted once
  (`preparationProgress`); the Checklist card lists *Packing* with packed/total.
- **Local schema v17** (create-only): `packing_entry_meta` (item priority) and
  `checklist_task_resolutions` (decisions on old tasks). **Device-only** — they do not sync yet.
  Future sync path: add matching cloud tables (owner-scoped, RLS like `packing_entries`) and list
  them in the personal backup registry; until then a second device shows default priorities and
  offers old tasks again (converting there is still safe: the task is gone once synced).

## Unified Packing and Checklist — phase 2: sections managed inline

- **No Manage sections screen in the flow:** the expanded trip card on the Checklist tab lists the
  sections with a drag handle (reorder by drag-and-drop) and a ⋮ menu: *Rename, icon and
  settings*, *Move up*, *Move down* (keyboard / screen-reader fallback), *Delete section*
  (confirmed; says how many tasks go; linked Inventory items are never touched). The old route
  still works for deep links.
- **Add section:** name (unique per trip, case-insensitive, max 60), icon, description, *Holds
  physical items* (offers Add from Inventory) and optional starter tasks.
- **From Inventory category:** pick a category → it becomes a section (or reuses the section
  already linked to it, or one with the same name) and the Inventory picker opens filtered to
  that category; items already in the section cannot be added twice. The picker also browses by
  category and searches; quantities per item.
- **Eligibility for Inventory** comes from the section's setting first, then its kind
  (`holdsItems`). Old Packing / Clothing sections no longer offer it — packing lives in Packing.
- **Local schema v18** (create-only): `checklist_section_settings` (icon, description,
  holds-items, linked Inventory category). **Device-only**: sections themselves, their names and
  order sync as before; the settings stay on this device. Future sync path: a cloud table keyed
  by section id with the section's RLS, listed in the personal backup registry. Until then a
  second device shows the default icon and kind-based Inventory eligibility.

## Unified Packing and Checklist — phase 3: the section screen

- **Arrange** (header button): groups and tasks in one list. Drag a group's handle to reorder
  groups; drag a task within its group, onto another group (moves it there) or below the groups
  (out of any group). Every row also has Move up / Move down arrows, and the drag handle offers
  the same moves (plus "Move out of its parent") to screen readers. The whole arrangement is saved
  in one transaction (`arrangeSection`) and refused if the section changed meanwhile.
- **Task ⋮ menu:** *Edit details*, *Move to a group*, *Move to another section* (refused when its
  Inventory item is already there), *Remove from this trip* (confirmed; a linked Inventory item is
  never touched). Swipe-to-delete stays.
- **One task editor:** title, priority, description, notes, section, group, Inventory source
  (search and link one item, change the quantity to take, or unlink), done, delete. An item already
  linked in the same section cannot be linked twice; sections that do not hold items offer no link.
  Old Packing / Clothing sections are not offered as move targets.
- **Inventory picker** (Add from Inventory): browse by category or search, choose several with a
  quantity each; items already in the section are shown and cannot be added again.
- **Templates:** applying a template whose sections include Packing or Clothing asks first; on
  approval those tasks become packing items (clothes → Clothing, the rest → Miscellaneous, with
  their priority and notes; names already on the list are skipped), never checklist tasks.
  Declining adds none of them; the other sections are applied as before.
- No schema change in this phase. Group order and links stay device-only as in phase 2; task
  order and section changes sync as before.
