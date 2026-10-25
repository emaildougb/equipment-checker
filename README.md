# NCEMS EP Checker

Equipment and property check submission tool for North Country EMS crews.

**Version 2.33**

## Links

- Live: [https://checks.northcountryems.org/](https://checks.northcountryems.org/)
- Repo: [https://github.com/emaildougb/equipment-checker](https://github.com/emaildougb/equipment-checker)
- Upload: [https://github.com/emaildougb/equipment-checker/upload/main](https://github.com/emaildougb/equipment-checker/upload/main)
- Worker health: [https://ncems-checks.d-boyce.workers.dev/health](https://ncems-checks.d-boyce.workers.dev/health)
- Cloudflare dashboard: [https://dash.cloudflare.com/](https://dash.cloudflare.com/) > Workers > `ncems-checks`

## Files (upload ALL of these)

- `index.html` : EP Checker app
- `units.json` : units, check lists, compartments, EmailJS config (version number lives here too)
- `logo.png` : NCEMS round logo (header + home-screen icon)
- `apple-touch-icon.png` : iOS home-screen + tab icon
- `manifest.json` : standalone app-mode config
- `README.md` : this file

## Where are you today and rig claims (2.32)

Needs the ncems-checks Worker 1.3 (/fleet routes). If the Worker can't be reached, or nobody is signed in, the old plain lists still work.

- **Home:** big date, and a crew card. Right after sign in (2.33) it pops up "Where are you today?" on its own; "Not on a crew today (just looking)" skips it for that person for the rest of the check day on that device The schedule (Derek's feed, through the Worker) suggests the crew. Pick M51, M52 or M54
- **Your crew's primary comes with it** when it's at your station, in service and nobody has it yet: M51 gets M25A, M54 gets M19, M52 gets M25B
- **Ambulances list:** banner "All ambulances must be checked daily for mission readiness." Then your crew's rigs with their check status (checked at 75% or more, partly checked, in progress, not checked yet), rigs still open at your station ("Take it"), rigs at other stations (tap, then "Is M18 at Station 51 today?"; Yes moves it to your station and the app remembers that), rigs another crew already took (shows who), and out of service rigs at the bottom. "Give back" frees a rig for another crew. A plain list of every ambulance is at the bottom
- **Other Units:** today's date, each unit shows its check day ("Checked on Sundays"), and a due unit turns green once it's checked today
- **Picture slots:** each ambulance row has a picture spot. Add `"photo": "m25a.jpg"` to an ambulance in units.json (and upload the picture) to show it; until then it shows the shop number
- Check day runs 07:30 to 07:30 Pacific, set in the Worker

## Log out and auto sign out (2.28)

Crews do checks on the shared agency iPhones and iPads, and every check is saved under whoever is signed in, so the Checker signs people out.

- **Log out button** on the home screen next to Switch user. If a check is in progress it asks first; the check stays saved on the device either way.
- **Idle:** signs out after 60 minutes with nobody touching the app (checked every 30 seconds and whenever the app comes back to the front).
- **Shift change:** signs out anyone who signed in before the last 07:30 Pacific. If someone is actively tapping right at 07:30, it waits until they stop for 2 minutes.
- **Sign out clears** this device's Microsoft sign in (and signs out at Microsoft when there is signal), the saved login hint, the saved name for the Name box and the kit mover cache. It does **not** clear checks in progress (autosave), held reports waiting for 11:00, or anything waiting to send.
- The sign in screen says why: logged out, signed out after an hour with no activity, or signed out for shift change.
- To change the timing without new code, add to units.json: `"autoSignOut": { "idleMinutes": 60, "shiftChange": "07:30" }`. Use `0` or `""` to turn a part off. Remember to build units.json from the shared copy once one exists.

## Haptics (2.28, everywhere since 2.30)

The phone buzzes on almost anything you can tap: buttons, links, the logo flip, checkboxes and their labels, photo buttons, section and compartment headers, the bottom progress bar and popups. It also buzzes when you finish typing a number (mileage, narc counts, PSI, fridge temp) or pick from a list, and gives a small tick for each spot an item passes while you drag it in Reorder. Events have their own buzz on Android: success when a check is sent, error for a narc count over par or a required item missing, a double buzz for problem taps. iPhones and iPads use the system haptic from a hidden switch checkbox (iOS 18 and newer) and only have the one style; older iOS stays silent. A label and its checkbox only buzz once. To turn it off, add `"haptics": false` to units.json.

## Kit moves (2.27)

Trusted crew put kit items in the order they really sit. Doug approves every move before it reaches anyone else.

- **Who can move:** since 10/22 the Worker's `MOVERS` variable lists Doug, Derek Langdon, Dennis Madler, Stephen Schutts, Lyndsey Maylone, Josh Robertson and Joseph Slack (it replaces the built in Josh and Joseph). **Who approves:** Doug (d.boyce). Both lists live in the Worker (`DEFAULT_MOVERS`, `DEFAULT_APPROVERS` in worker.js 1.2). To change them without new code, add `MOVERS` or `APPROVERS` (comma separated emails) under the Worker's Settings, Variables and Secrets.
- **Mover:** open a check, open a compartment or bag, tap **↕ Reorder**. Hold ≡ and drag (one long drag goes as far as you want; hold near the top or bottom edge to scroll), use the arrows, or tap an item's number and type the spot to send it straight there. Tick other rigs that carry the exact same kit, add a note, **Send to Doug**. Needs signal.
- **Doug:** gets an email (EmailJS) with the new and old order and a link to `?moves=1`. Opening the Checker signed in as Doug shows a blue "kit moves waiting" banner. **Approve** saves the new order to the shared list (table `units`, note "Kit move by ...") for every device. **Turn down** takes an optional reason. Either way the mover gets an email back.
- **Safe:** a move only changes order, never adds or removes items. If a rig's kit changed since the move was sent, that rig is skipped and the decision says so. Checks in progress are not affected (marks are kept by item name).
- **Stored:** D1 table `moves` (who, when, rigs, kit, old and new order, note, status, who decided, when, why). Movers see their own moves from their banner.
- Josh is also a Checker admin, so he can still edit lists directly in admin mode. Moves are the path that comes to Doug.

## Cloudflare (2.24)

The Checker's data lives on Doug's Cloudflare account in its own Worker, `ncems-checks` (separate from `ncems-api`, which runs Incident Reports and the hub banner). Setup steps are in `WORKER_SETUP.md`, which ships in a separate zip with `worker.js`. Neither file goes on GitHub.

- **Check records:** D1 database `ncems-checks-db`, table `checks`. Saved with the signed in email. Each record still goes to Firebase too (`firebaseUntil` in units.json turns that off once CG Staff reads from Cloudflare).
- **Photos:** R2 bucket `ncems-check-photos`, by month and rig. Since 2.30 there is no Cloudinary: the app tries R2 twice, and if both fail the photo stays on the phone with the check (the crew sees a warning, and it is left out of the report and record).
- **Shared unit list:** admin edits save to the Worker (table `units`, every version kept) and every device gets them the next time the app opens. No more Download units.json and upload to GitHub. The newer list version wins between GitHub and the shared copy; on a tie the shared copy wins. Before Doug's Claude builds a new units.json, start from the shared copy (Download units.json on the admin page).
- **Old device edits:** edits saved on one device before 2.24 are no longer applied (they were hiding newer list changes on that device). The admin page shows a banner to send them to the shared list or throw them away.
- **No signal:** checks and an admin's list save wait on the device and send by themselves.
- **Still on Firebase:** live share and known problems. They move when CG Staff does.

## Sign in (2.23)

Everyone signs in with their North Country EMS Microsoft account before a check. Only @northcountryems.org accounts get past the sign in screen.

- Same app registration as the admin login (client ID in `MSAL_CONFIG`). In Entra, Enterprise applications, this app, Properties: **Assignment required must be No**, or crews get blocked by Microsoft.
- The signed in name fills the Name box. Partners can still add their name.
- Every report email has a "Signed in:" line, and every check record saved for CG Staff has `by` (email) and `byName`.
- Shared iPads and iPhones: the home screen shows "Signed in as ... Switch user". The next person taps Switch user and picks or adds their own account.
- If Microsoft sign in can't load at all (no signal), the crew can still do the check. The report says NOT SIGNED IN.
- The hub's `?login_hint=` (or the saved `ncems_login_hint`) is passed to Microsoft so it suggests the right account.

## Admin access

Admin section uses Microsoft sign-in (same account as Outlook and Teams).

Before it works, the app needs an Azure app registration:
1. Go to [Entra admin center](https://entra.microsoft.com) > App registrations > New registration
2. Set redirect URI to `https://checks.northcountryems.org/`
3. Paste the Application (client) ID into `MSAL_CONFIG.clientId` near the top of `index.html`

The tenant ID (North Country EMS) is already set: `153dc089-095e-4a20-8d10-39321a0aca09`

## EmailJS setup

Submissions are sent via EmailJS. Service ID, template ID, and public key are configured inside `index.html` in the `APP.data.emailjs` block.

## Check log (CG Staff Vehicle Checks)

Every submitted check also saves a short record to Firebase (project `ncems-hub-9111d`, same as the hub), collection `vehicleChecks`: unit, crew, time, percent done, fuel, mileage, and every abnormal item tagged Fixed on the spot, Could not fix, or Open. The CG Staff dashboard reads it. This never slows down the crew: if the phone has no signal, the record waits on the phone and sends itself within a minute of getting signal back. The email report works the same as before. Firebase rules must allow `vehicleChecks` (see the CG Staff README for the rules lines).

## Live share (two people, one rig)

When two crew members check the same ambulance on the same day, each phone shows the other person's checkmarks as they go. Since 2.17 there are no names, no "Live with" banner and no flashing rows, just the marks. Stored in Firebase collection `liveChecks`, one doc per unit per day (`M19_2026-10-15`, local date). An issue beats Normal: if either phone marks something ✗ (Abnormal, Overfilled, No), it stays that way until the phone that flagged it (or the same initials on another screen) switches it back, or someone checks Fixed on the spot. Two issues on the same item keep both notes. For O2, fuel, DEF and narc counts, the lower number wins. Each person still submits their own check. If Firebase can't be reached, the check works exactly like before, just without the sharing. Needs the `liveChecks` line in the Firebase rules:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /notices/{doc} { allow read: if true; allow write: if false; }
    match /usage/{doc} { allow read, write: if true; }
    match /vehicleChecks/{id} { allow read: if true; allow create, update: if request.resource.data.unit is string && request.resource.data.atMs is number && request.resource.data.issues is list; }
    match /vehicleStatus/{unit} { allow read: if true; allow create, update: if request.resource.data.oos is bool && request.resource.data.by is string; }
    match /vehicleResolved/{id} { allow read: if true; allow create, update: if request.resource.data.checkId is string && request.resource.data.by is string; }
    match /liveChecks/{id} { allow read: if true; allow create, update: if request.resource.data.unit is string && request.resource.data.date is string && request.resource.data.updatedAt is number; }
    match /vehicleLinks/{id} { allow read: if true; allow create, update: if request.resource.data.checkId is string && request.resource.data.label is string; }
  }
}
```

## Known problems (carried over)

When a crew opens a check, the app looks up every problem reported on earlier checks of that rig (last 45 days) that nobody has marked fixed, and shows them at the top with the crew notes and the latest note from the chiefs (from the linked Shift Ops card). The crew taps **Still broken** (the item gets marked ✗ and tagged as a known problem, so it isn't counted as a new report) or **Now fixed** (writes a fixed mark to `vehicleResolved`, which also completes the linked Shift Ops card in CG Staff). Low fuel and DEF don't carry over. Reads `vehicleChecks`, `vehicleResolved` and `vehicleLinks`.

## When the email goes out

- 75% or more complete: sends right away
- Under 75%: held on the phone and sent automatically at 11:00 AM, so the partner can finish first. Submitting again before then replaces it
- Under 75% after 11:00 AM: sends right away
- These live in `units.json` under `sendRule` (`minPct`, `holdUntil`)

## Changelog

### v2.33 (10/24/2026)
- "Where are you today?" now pops up on its own right after sign in (after the What's new popup if that shows), instead of waiting for a tap on the crew card or Ambulances
- New "Not on a crew today (just looking)" button for chiefs and anyone not on a crew; skips the question for the rest of the check day on that device
- Changed index.html and README.md only

### v2.32 (10/24/2026)
- "Where are you today?" crew pick after sign in, suggested from the schedule, with the crew's primary ambulance claimed automatically
- New Ambulances list: mission readiness banner, today's date and crew, your rigs with check status, take open rigs, move a spare to your station, see rigs other crews took, out of service rigs listed, give back a rig, plain list fallback
- Other Units shows each unit's check day and turns a due unit green once it's checked
- Picture slot on each ambulance row (photo field in units.json)
- What's new popup lists the changes
- Changed index.html and README.md only (units.json not touched). Needs ncems-checks Worker 1.3

### v2.31 (10/24/2026)
- New top bar, the same as CG Staff: white bar, house button on the left goes to the NCEMS Hub, NCEMS logo, "NCEMS" in black and the app name in green, North Country EMS in gray, and the i button on the right for details. iPhone status bar set to default so the clock shows on the white bar
- The bar shows on every screen; the screen headers (Back and the unit name) sit right under it. The home screen corner buttons are gone since the bar has them
- What's new popup has a New top bar line
- Changed index.html and README.md only (units.json not touched)

### v2.30
- Haptics everywhere: links, logo flip, labels and checkboxes, photo buttons, headers, progress bar and popups; a buzz when a number is entered; a tick per spot while dragging in Reorder; success buzz when a check is sent; error buzz for narc over par and for a required item missing. A label and its checkbox only buzz once
- Lyndsey Maylone's admin address fixed (l.maylone, was l.malone), so the logo flip admin login works for her
- Photos: Cloudinary removed. R2 is tried twice; if it still fails the photo stays on the phone with a warning, and a device only photo is never put in the report email (a photo link could have been a huge data link there)
- Kit movers are now set by the Worker's MOVERS variable (added 10/22): Doug, Derek, Dennis, Stephen Schutts, Lyndsey Maylone, Josh, Joseph. No app change needed for that

### v2.29
- Kit reorder: dragging now keeps going until you let go. On iPhone the drag let go after every single spot because the row holding the grip moved in the page; the list now holds the finger instead. Faster scroll when you hold near the top or bottom edge
- Kit reorder: tap an item's number and type a spot (1 to N) to send it straight there, for moving big chunks without the arrows
- units.json 2.29: Medication Kit on all five rigs (M25A, M25B, M19, M18, M14) in Joseph Slack's order from M25A (10/22). Positions 50 and 51 (22g IV, 24g IV) were off screen in his screenshots, so they are a best guess between 20g IV and 16g IV. Surgical Lube is still on M25B, M19, M18 and M14 (not M25A) and sits right after the APAP (spot 4, before Toradol), per Doug 10/22
- Includes everything in 2.28 (2.28 was never uploaded)

### v2.28
- Log out button on the home screen next to Switch user
- Auto sign out after 60 minutes with no activity, and at shift change (07:30 Pacific); a check in progress stays saved on the device
- Sign in screen says why you were signed out
- Haptics: a small buzz on button taps (iPhone/iPad via the iOS 18 switch haptic, Android via vibrate; double buzz on Android for problem taps). Off with `"haptics": false` in units.json
- Fixed: an empty light blue bar showed above the Ambulances button for everyone (the kit moves banner ignored hidden)

### v2.27.1
- Kit move sheet: the note box and buttons now use the app's font (a CSS slip in 2.27 showed the default typewriter font)


### v2.26
- No more Firebase: live share (polls the Worker every 5 seconds while a check is open) and the known problems list read from the `ncems-checks` Worker; crews marking a known problem fixed saves there too
- Check records go to Cloudflare only (the Firebase copy is turned off)
- Counts each app open on the Worker (usage, checker)
- Needs Worker 1.1 (deployed 10/21)

### v2.25
- Med Vault: a count over par is an error (red box: recount, contact a BC). It flags the item and goes to the very top of the report under Immediate Admin Review
- Mechanical & Lights: All Normal button marks every unanswered row Normal; rows stay on screen as a review list and anything already Abnormal is left alone
- Tire pressure is required: red star and red box until answered, and Submit stops until it is
- Worker ncems-checks is live on the NCEMS Cloudflare account (health check green 10/21)

### v2.24
- Moved to Cloudflare: check records (D1) and photos (R2) go to the new `ncems-checks` Worker, with Firebase still written as a safety net
- Shared unit list: admin saves reach every device; every version kept for roll back; admin page shows which list is in use
- Old per-device admin edits no longer applied; banner to send or throw away
- Needs the `ncems-checks` Worker set up (WORKER_SETUP.md). If it isn't up yet, nothing breaks

### v2.23
- Sign in for everyone with the NCEMS Microsoft account (sign in screen before home, Switch user on home, name fills in, signed in email on every report and check record)
- Airway Bag (all 5 rigs, from Joseph Slack): C-MAC Kit and EZ IO Kit moved inside the Airway Bag; Airway Roll runs by tube size 2.5 to 8.5, then laryngoscope handles, blades, Magill, syringe, lube, OPA; "Larynoscope with two batteries and clean" is now "Laryngoscope handles operational and working"; ETT names cleaned up (EET# 8.5, ETT # 5.5, ETT # 6.5); Middle Airway Bag and Airway Adjunct Pocket reordered (best guess, waiting on Joseph to confirm)
- units.json list version 2.23

### v2.22
- Add photo (optional) button on every item marked as a problem: compartment items, bags, mechanical, fluids and under the hood rows, operational checks, tire pressure, main O2 and other unit checks. The photo uploads to Cloudinary like the walk-around photo and saves with the check. Remove photo takes it off
- Problem photos go in the check's `photos` list (labeled with the unit and item) so CG Staff shows them with the check, and each issue also carries its own `photo` link
- Photos are never required. A short description is now required for any problem still open or Unable to fix. Fixed on the spot still needs nothing. Fuel, DEF, cooler reading, main O2 PSI, gurney checks and narc counts are skipped because the reading already says it
- If a crew taps an item back to OK, its photo is left off the check

### v2.21
- Home screen on a computer: the logo stays a circle (it was squashing into an oval on short or zoomed windows), and the Ambulances and Other Units buttons are bigger so the words fit. Phones look the same

### v2.20
- New phone icon: NCEMS green and navy split corner to corner with a white box ambulance, NCEMS across the bottom (matches the Open Shifts icon). `apple-touch-icon.png` is the new icon and `icon-512.png` is the big one Android uses for the icon and the launch screen. Delete the old icon from the home screen and add it again to see it
- Home screen name is now Apparatus (was EP Checker). The page itself is unchanged

### v2.19
- Chuck Andrus and Kim Reid added to the admin list (behind the logo flip). Everyone still lands on the regular check; admin only opens from the logo

### v2.18
- Compartments sort numbers and letters first (1, 2, 3 / A, B, C), then everything else A to Z
- Kits group: LifePak 35, Medication Kit, Airway Bag, Pediatric I-Gels, Portable Suction, EZ IO Kit, CMAC Kit (any interior compartment named like these, or marked `"kit": true`)
- Cab section holds fuel, DEF and the cab items, all open (no second Cab dropdown). Tire pressure moved inside Mechanical & Lights
- Fuel and DEF colors: Full green, ¾ yellow, ½ orange, ¼ red
- Engine oil and transmission: Normal or Abnormal. Abnormal opens Overfilled, notes, Fixed or Unable to fix, and a Save note button. Enter closes the keyboard on any note box
- Sealed transmission note only shows on rigs listed in `sealedTransmission` (25A, 25B)
- Mandatory items: light red box and red dot on the row itself once you open it. Main screen just shows the asterisk
- To Complete popup lists what's missing; tap anywhere on it to close and jump to the first one (cursor lands in the box)
- Fixed on the spot needs no note. Unable to fix needs a reason before Submit
- Outstanding button on any row with an unfixed known problem (items and mechanical/fluid rows); tap for notes and Still broken / Now fixed
- Compartment and bag arrows point right when closed, down when open
- units.json 2.18, all ambulances: EZ IO Kit (pink, blue, yellow needles, EZ Connect lock, stabilizer, driver; moved out of the Med Vault), CMAC Kit (camera unit with turns on check, size 3, size 4, D blade), the old EZ IO Kit and Video Laryngoscope lines removed from the airway bag, regular stethoscopes removed and one Electronic Stethoscope per rig (M19 gets it in Compartment E)

### v2.17
- Live share simplified: no names, no "Live with" banner, no flashing rows. Only the checkmarks sync. Fixes the banner saying you were live with yourself after deleting and re-adding the icon or opening the rig on a second screen
- Your own flag from another screen or an older session no longer locks you out of switching it back
- Known problems box only redraws when something in it changed, so the page stops jumping
- Check date now uses Pacific time. Before, anything after 5 PM saved under tomorrow's date and its marks carried into the next morning's check
- Every section on the check folds up. Tap a header to open or close it. Closed sections show how many are done or a ✓. Compartment groups start open since their compartments already fold. Anything that jumps to a row opens its section first
- Anything mandatory and not done yet (red tags, battery checks, main O2 PSI, fridge temp, narc counts, portable O2 PSI) has a light red box around it, and so do the compartment, bag or closed section it sits in
- Fridge reading in °F (39 to 48°F is good)
- New item option `"psi": true` in units.json: the item gets a PSI box instead of buttons. Under the oxygenCheck minPsi (500), it's an issue
- units.json 2.17, M25A (Joseph's notes 10/15): electronic stethoscope split out in Action Area, Emesis Bag and Chux on the gurney, Suction Cup in the LUCAS bag, MDC (working and functional) in the Cab, gloves off the Med Shelf, surgical lube out of the Med Kit, portable O2 PSI in the Middle Airway Bag, Compartments A, B and C in cabinet order (top left to bottom right)

### v2.16
- Known problems: anything reported on an earlier check and not fixed yet shows at the top of the next check, with the latest note from the chiefs. Still broken or Now fixed, plus Go to it
- Live share: an issue beats Normal. Only the person who flagged it can clear it (or check Fixed on the spot). Two issues keep both sets of notes. Lower O2, fuel, DEF and narc numbers win
- The whole check (same text as the email) is saved with the log, so CG Staff can show the Full check
- Every logged issue carries a key, so CG Staff and the next crew can match it to the exact item
- What's new card on the home screen, once per version. The (i) button opens it any time
- Home screen footer shows the app's own version. If units.json is a different version it says "list" with that number

### v2.15
- Sends now at 75% (was 90%). Under 75% holds until 11:00 AM (was 5:00 PM)
- Live share: two people on the same rig see each other's marks in real time
- Main O2 is now the actual gauge number. Under 500 PSI says exchange the tank
- "WNL" is now "Normal" everywhere
- Fluids section is now Under the Hood: warm engine note, engine oil and transmission get Normal / Overfilled / Abnormal plus a plain words box (color, thickness), closed transmission note kept
- DEF is a gauge like fuel (25 / 50 / 75 / Full) on every ambulance. 25% flags
- Added visual checks for belts, fan and battery
- Every section and every compartment has an "Other notes" box (Joseph Slack's idea)
- Narc box: Fentanyl, Versed and Ketamine each get a count box with par (8 / 5 / 2). Shows short vs par, and flags at 50% or below. Removed the doubled Fentanyl and Versed entries (M19) and doubled Versed (M18)
- LUCAS is now a kit: device (battery check), shoulder strap, extra battery, scissors, backplate
- Nitrous kit on every ambulance (mixer, tank, 2 masks) plus spare bottle
- Orange C-collar bag split into two, so each C-collar bag gets its own red tag (M25A, M25B, M19, M18)
- LifePak 35 has its daily internal self test check
- IV tray sorted: catheters small to large, tape, syringes, needles
- Med kit in kit order (lid panels, then the tray), with a round ABC button to flip to A to Z (numbers first). The choice is remembered on that phone
- "To Complete" no longer wipes typed notes or ✗ items. It only fills in what's untouched
- Fixed items count as done, so the compartment turns green and the button says "All done" once everything is marked
- Unit name in the header, status bar and browser tab ("M19 Check")
- Home button (to the hub) and (i) version button on the home screen
- Check log now carries the photos, notes, narc counts, DEF and O2 reading to CG Staff
- Medic 19: Dry Chemical Extinguisher to exterior Compartment 3, LUCAS kit to exterior Compartment 2, IV pump to Compartment A, stethoscope to Compartment E, radio to the cab, nitrous kit to the bench seat with the spare under the seat, "Other Equipment" is now "Pass-Through" (flashlights, rechargeable flashlight, spare O2), IV tray area removed, vacuum splint bag added with its own red tag, Compartments A and B in shelf order from the photos

### v2.14.1
- Photos now go to Doug's Cloudinary account (`pvkfzitg`, preset `vehiclecheck`: unsigned, images only, shrunk to 1600 px wide, folder `vehicle-checks`). The old account was Derek's from the original checker; old photo links still work while it exists

### v2.14.0
- Each submitted check is logged to Firebase for the CG Staff Vehicle Checks section (unit, crew, time, issues with Fixed on the spot / Could not fix / Open)
- Offline safe: unsent logs queue on the phone and retry every minute
- No change to what crews see or to the email report


### v2.0
- Admin login replaced with Microsoft agency sign-in (MSAL : same as Grounds Tracker)
- Removed hardcoded password gate
- Added manifest.json for standalone app-mode launch

### v1.x
- Initial EP Checker build with flip-card admin login

## Notes

- Custom domain: checks.northcountryems.org (CNAME > emaildougb.github.io)
- iOS home-screen caches hard : delete and re-add icon after every deploy
