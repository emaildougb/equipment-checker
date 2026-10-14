# NCEMS EP Checker

Equipment and property check submission tool for North Country EMS crews.

**Version 2.14.1**

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

## Changelog

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
