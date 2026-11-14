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
