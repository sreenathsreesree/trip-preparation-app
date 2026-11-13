# Travel experience: recommendations, PDF import, weather and covers

All four features use free, keyless public services or run on the phone. No Google Cloud billing,
no paid API, no secret in the app. Everything they store lives in the signed-in account's own
local database (account partitions), so another account on the same phone never sees it.

| Feature | Source | Cost / key | Stored on the phone |
|---|---|---|---|
| Explore recommendations, place search | OpenStreetMap: Overpass API (places by category), Photon (search) | Free, no key; ODbL, credited "© OpenStreetMap contributors" | `remote_cache` (7 days), added places as ordinary plan places |
| Weather | Open-Meteo forecast API | Free, no key (non-commercial use, < 10 000 calls/day); CC BY 4.0, credited | `remote_cache` (fresh for 3 h, shown stale offline) |
| Covers | Wikipedia search + Wikimedia Commons image info (free licences only) | Free, no key; author and licence shown with every image | `auto_covers` + a downloaded copy |
| PDF import | On the phone (`pdfText.ts`, `itinerary.ts`) | No service | `pdf_imports` (original PDF copy, text, draft), `plan_node_days` |

Local schema v12 (`0012_travel_experience.ts`) adds only new tables. None of them sync to the
cloud; the confirmed plan from a PDF syncs as ordinary places. **No cloud migration.**

## Explore — root cause and fix
Recommendations depended only on Google Places through a proxy that needs billing; with no proxy
the provider was `unconfiguredProvider`, so every category showed "not set up". Places typed in
by name also had no coordinates to search around. Now OpenStreetMap is the default live provider
(`places/config.ts`): Google is used only if `EXPO_PUBLIC_PLACES_PROXY_URL` is set (billing,
key in the proxy only), `EXPO_PUBLIC_PLACES_PROVIDER=demo` gives labelled demo data, `=off`
disables search. Location search works, so destinations can get coordinates. Results show their
source: "Live from OpenStreetMap", "saved … ago", or "Demo data — not real places". Distance
filters 5/10/25/50 km; duplicates are caught by id and by same name within 300 m. Added places
are stored as `manual` places with an `osm:` id (the cloud accepts names and coordinates for
those; Google content may not be stored). OSM has no ratings: "Popular" puts places with a
Wikipedia entry first. Requests are spaced ≥ 1.1 s per service.

## PDF import
Text PDFs are read on the phone: Flate streams, object streams, ToUnicode fonts (Word, Google
Docs, browsers), simple fonts, page-tree order, kerning joins. Scanned PDFs (pictures of text)
are detected and the user pastes the text instead — **OCR is not available** (it would need a
server-side service; none is enabled). The parser finds days ("Day 2 – Munnar"), dates (several
formats; missing ones counted from Day 1), the day's destination ("Kochi to Munnar" → Munnar),
and classifies lines as sights, stays, food, transport or notes; "A and B" become two places.
Transport and notes are offered but not included by default. Exact name matches with the trip
are reused; near matches are flagged for the user. The draft is saved at every edit and can be
reopened; Confirm only adds (places under each day's destination, planned days, notes).

## Weather
Destination Overview shows now / today / the planned day, humidity, wind, rain chance, update
time and stale state; the trip dashboard shows each destination on its planned day. More than
7 days ahead is marked uncertain; beyond 16 days "not available yet". Open-Meteo has no official
severe-weather warnings — the card says so. Packing ideas (rain, cold, heat, sun, wind) come only
from real forecast values and are added only when the user taps Add.

## Covers
When a destination or trip has no own photo, a freely licensed Commons image of that place is
chosen: the exact article when OpenStreetMap links one, otherwise a search with the region; the
page must carry the name and be within 60 km when coordinates are known; disambiguation pages
and non-free images are refused. Shown with title, author, licence and a link; "Change" moves to
the next suitable image; an own photo always wins and is never replaced. With nothing suitable,
a placeholder — never an unrelated image. Recommendation cards show a photo only for places with
an exact Wikipedia link.

## Verification status
- Automated: unit tests with recorded-format fixtures; real Chrome-made and image-only PDFs;
  web e2e (`e2e:travel`) with provider fixtures served by the harness.
- Not yet verified against the live services or on a phone: this build environment cannot reach
  photon.komoot.io, overpass-api.de, api.open-meteo.com or wikipedia/wikimedia.
