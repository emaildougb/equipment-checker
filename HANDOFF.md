# HANDOFF — WAMBOchecker

## What it does

Daily apparatus/rig check app for North Country EMS / Clark Fire District 13, replacing Vector Solutions "Check It." Crews pick a unit (ambulances M25A, M25B, M19, M18, M14; M12 is retired; "Other Units" covers the rescue-rig rotation), enter initials + mileage, then walk through mechanical/fluids/tires, exterior compartments 1–7, and interior areas (Med Vault, Fridge, Action Area, Gurney, Bench Seat, Compartments A–F, Lifepak 35, Medication Kit, Airway Bag, Med Shelf, IV Tray, Pediatric I-Gels, Portable Suction) in a fixed walk order.

Two-state checks throughout: mechanical/fluid items are WNL/Abnormal, inventory items are Complete/Abnormal. Anything flagged Abnormal expands into "Fixed on the spot" or "Unable to fix" — the latter both keeps the flag and gets surfaced in an "UNABLE TO FIX — IMMEDIATE ADMIN REVIEW" block at the top of the report email. Reports at ≥90% complete send immediately; below 90%, they're held and auto-sent at 5 PM the same day (only fires if the app happens to be open on some device at/after 5 PM — no backend cron).

Now v2.13.1. Full version history and check conventions are documented in the existing `README.md` — that doc is thorough, current, and worth reading directly rather than duplicating here.

## Where the data lives

- **Fleet/inventory data: `units.json`** (~316 KB) — fetched at runtime, not embedded in the HTML. Contains `emailjs` config, `rescueRotation`, `rescueRigChecks`, `ambulanceCompartments` (the bulk of the file — full nested item lists per unit: M25A, M25B, M19, M18, M14, each with compartments and a `cabArea`), `cloudinary` config, `oxygenCheck`, and `unitNotices` per unit.
- **Submitted checks: EmailJS**, not a database. There's no persisted "all past reports" store server-side — each completed check is emailed out (flags-first format: "⚠ N FLAGS" or "✅ ALL CLEAR" banner, then full detail). Photos go to Cloudinary and are linked, not attached.
- **Admin edits (renaming/adding/removing items or quantities): browser `localStorage`, per device only.** To push a fleet-wide change, an admin has to tap "Download units.json" in admin mode and manually upload that file to the GitHub repo root. Any device with its own local admin overrides keeps showing those on top of the repo file until manually cleared — this is a known source of "why does my phone show something different" confusion.
- **Red tag numbers** (last 4 digits) are remembered per unit/bag, presumably also in localStorage, and pre-filled with a one-tap Confirm on the next check.

## Structure

- `index.html` — the entire app UI and logic, single file.
- `units.json` — all apparatus data, fetched at runtime.
- `logo.png`, `ambulance.jpg`, `rescue51.jpg`, `sar51.jpg` — branding/background images.
- `README.md` — already detailed and current (fleet list, check flow, conventions, deploy steps, version history, known limits). Read that alongside this file.
- Forest-green branding, CSS variables documented in the README.

## Anything odd

- **No backend at all.** The 5 PM deferred-send only works if a device happens to have the app open past 5 PM; admin sync is a manual download/upload bridge, not a live push; two people checking the same unit/date just both show up as dual initials, there's no live merge.
- **EmailJS/Cloudinary are not BAA-capable — the README explicitly says no real PHI should go through this app.**
- **Admin password is hardcoded** in the client — fine for a small department, not real security (README's own words).
- **`units.json` is large (316 KB)** and is the single source of truth for the entire fleet's item lists; a bad edit here breaks every unit's check, not just one.
- **iOS caches hard.** Every deploy requires crews to delete and re-add the home-screen icon; a normal reload isn't enough. This bit affects every app in this set (Intubation, apps hub), not just this one.
- M25A/M25B have sealed transmissions and are explicitly excluded from completion-percentage math — if you're debugging why a check won't hit 90%, that's one place to check.
