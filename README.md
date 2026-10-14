# NCEMS EP Checker

Equipment and property check submission tool for North Country EMS crews.

**Version 2.15**

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

When two crew members check the same ambulance on the same day, each phone shows the other person's marks as they go, tagged with their first name, plus a "Live with ..." banner at the top. Stored in Firebase collection `liveChecks`, one doc per unit per day (`M19_2026-10-14`). The newest mark wins, so nobody's work gets overwritten by an older tap. Each person still submits their own check. If Firebase can't be reached, the check works exactly like before, just without the sharing. Needs the `liveChecks` line in the Firebase rules:

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
  }
}
```

## When the email goes out

- 75% or more complete: sends right away
- Under 75%: held on the phone and sent automatically at 11:00 AM, so the partner can finish first. Submitting again before then replaces it
- Under 75% after 11:00 AM: sends right away
- These live in `units.json` under `sendRule` (`minPct`, `holdUntil`)

## Changelog

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
