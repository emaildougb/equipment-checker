# NCEMS EP Checker

Equipment and property check submission tool for North Country EMS crews.

**Version 2.18**

## Links

- Live: [https://checks.northcountryems.org/](https://checks.northcountryems.org/)
- Repo: [https://github.com/emaildougb/equipment-checker](https://github.com/emaildougb/equipment-checker)
- Upload: [https://github.com/emaildougb/equipment-checker/upload/main](https://github.com/emaildougb/equipment-checker/upload/main)

## Files (upload ALL of these)

- `index.html` : EP Checker app
- `units.json` : units, check lists, compartments, EmailJS config (version number lives here too)
- `logo.png` : NCEMS round logo (header + home-screen icon)
- `apple-touch-icon.png` : iOS home-screen + tab icon
- `manifest.json` : standalone app-mode config
- `README.md` : this file

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
