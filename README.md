# NCEMS EP Checker

Equipment and property check submission tool for North Country EMS crews.

## Links

- Live: [https://checks.northcountryems.org/](https://checks.northcountryems.org/)
- Repo: [https://github.com/emaildougb/equipment-checker](https://github.com/emaildougb/equipment-checker)
- Upload: [https://github.com/emaildougb/equipment-checker/upload/main](https://github.com/emaildougb/equipment-checker/upload/main)

## Files (upload ALL of these)

- `index.html` — EP Checker app
- `logo.png` — NCEMS round logo (header + home-screen icon)
- `apple-touch-icon.png` — iOS home-screen + tab icon
- `manifest.json` — standalone app-mode config
- `README.md` — this file

## Admin access

Admin section uses Microsoft sign-in (same account as Outlook and Teams).

Before it works, the app needs an Azure app registration:
1. Go to [Entra admin center](https://entra.microsoft.com) → App registrations → New registration
2. Set redirect URI to `https://checks.northcountryems.org/`
3. Paste the Application (client) ID into `MSAL_CONFIG.clientId` near the top of `index.html`

The tenant ID (North Country EMS) is already set: `153dc089-095e-4a20-8d10-39321a0aca09`

## EmailJS setup

Submissions are sent via EmailJS. Service ID, template ID, and public key are configured inside `index.html` in the `APP.data.emailjs` block.

## Changelog

### v2.0
- Admin login replaced with Microsoft agency sign-in (MSAL — same as Grounds Tracker)
- Removed hardcoded password gate
- Added manifest.json for standalone app-mode launch

### v1.x
- Initial EP Checker build with flip-card admin login

## Notes

- Custom domain: checks.northcountryems.org (CNAME → emaildougb.github.io)
- iOS home-screen caches hard — delete and re-add icon after every deploy
