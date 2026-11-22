# NCEMS sign-in (drop-in)

Microsoft once per app per device, then one 4-digit PIN for every NCEMS app. Same PIN screen as Open Shifts.

**Start with `KICKOFF_PROMPT.md`.** Give it to Claude together with your app's code. It asks you a few questions,
writes the request to send Derek, and then does the wiring.

## What's in this folder

| File | Goes where | What it is |
|---|---|---|
| `ncems-signin.js` | your page | The sign-in screens, the device key, the Microsoft step. Gives your app a 1-hour token. |
| `ncems-id-verify.js` | your Worker | Checks that token. About 60 lines, no secrets. |
| `fonts/`, `logo-ncems.png` | next to `ncems-signin.js` | The Geist font and the NCEMS logo the screens use. |
| `example.html` | reference | The smallest working page. |
| `KICKOFF_PROMPT.md` | Claude | The prompt that walks an app through the change. |

Copy the whole folder into your app (keep the files together). Don't load it from another site.

## How it works

1. **First time on a device:** the person signs in with Microsoft. The browser makes a key that can't be copied off
   the device and registers the public half with the shared sign-in Worker, **ncems-id**.
2. **Every day:** the PIN pad. The device signs a one-time challenge, the PIN goes with it, and ncems-id returns a
   **1-hour token made for your app only**.
3. **Your page** sends that token to **your Worker** as `Authorization: Bearer <token>`.
4. **Your Worker** checks it with `ncems-id-verify.js` and looks the person up in **your own** list of who may do what.

ncems-id only says *who* someone is. It knows nothing about roles in your app.

## Before anything works: Derek adds your app

ncems-id refuses apps and web addresses it doesn't know. Derek needs, for each app: a short key (like `hub`), the
app's name, its Entra client ID, every web address it's served from, and how many days between Microsoft sign-ins.
`KICKOFF_PROMPT.md` writes that request for you.

In Entra, the app registration must have a **Single-page application** redirect URI that is exactly your site's
address with a trailing slash (for example `https://hub.northcountryems.org/`), accounts in **this organizational
directory only**, and no client secret.

## The page: `NCEMSSignIn`

```html
<script src="signin/ncems-signin.js"></script>
<script>
  NCEMSSignIn.init({ app: 'hub', clientId: '<client id>', appName: 'NCEMS Hub',
                     onSignedIn: session => startApp(session) });
</script>
```

### `init(options)`

| Option | Default | |
|---|---|---|
| `app` | required | The key Derek gave this app. |
| `clientId` | required | The app's Entra Application (client) ID. |
| `appName` | `'NCEMS'` | Shown on the first screen. |
| `onSignedIn(session)` | | Runs after every unlock. `session` is `{ token, name, email, expires, microsoftAgainAt }`. May be `async`. Return `{ pending: true, title, text }` to show "Almost there" (not allowed in yet), or `{ microsoft: true, text }` to ask for Microsoft again. |
| `onLocked()` | | The hour is up; the PIN pad is showing. Hide anything private. |
| `onSignedOut(why)` | | `'signout'`, `'locked'` (5 wrong PINs), `'expired'` or `'gone'`. |
| `days` | `90` | Only the number shown in "Then just your PIN for 90 days". The real limit is set in ncems-id. |
| `redirectUri` | `location.origin + '/'` | Must match the Entra redirect URI exactly. The page at that address must load this script with the same `init`. |
| `auto` | `true` | `false` = show nothing until `getToken()` is called (apps with public pages). |
| `autoLock` | `true` | Show the PIN pad when the token's hour is up. |
| `theme` | `'auto'` | `'auto'`, `'light'` or `'dark'`. |
| `logo` | `logo-ncems.png` beside the script | A URL, or `false` for none. |
| `fonts` | `fonts/` beside the script | A folder URL, or `false` for the system font. |
| `haptics` | `true` | `false` = no vibration on taps. |
| `shared` | `false` | `true` = offer "Set up as a shared phone/tablet" on the first screen. Only works if Derek has marked the app shared in ncems-id. See **Shared devices**. |
| `sharedSetupBy` | `'Someone allowed to set these up'` | Who sets shared devices up, for the explanation screen, e.g. `'A battalion chief'`. |
| `sharedHelp` | how to get a PIN | The text behind "Not on the list?". |
| `sharedIdleMinutes` | `5` | A shared device goes back to the name list after this long untouched. |

### Everything else

| Call | |
|---|---|
| `await NCEMSSignIn.getToken()` | The token. Shows the PIN pad first if there isn't a good one. Use it for every request to your Worker. |
| `NCEMSSignIn.session()` | `{ token, name, email, expires, microsoftAgainAt, shared }` or `null`. |
| `NCEMSSignIn.isShared()` | `true` if this phone or tablet is set up as a shared device. |
| `NCEMSSignIn.lock()` | Forget the token, show the PIN pad. |
| `await NCEMSSignIn.changePin()` | Current PIN, new PIN, again. Resolves `true` if changed. The new PIN works in every NCEMS app. |
| `NCEMSSignIn.signOut()` | "Sign out of this phone?" The device forgets its key; next time is Microsoft again. |
| `NCEMSSignIn.setTheme('dark')` | Match your app's own day/night switch. |

The token is kept in memory only. A reload asks for the PIN again; that is on purpose.

## The Worker: `ncems-id-verify.js`

```js
import { ncemsUser } from './ncems-id-verify.js';

const who = await ncemsUser(request, { app: 'hub' });   // throws if the token isn't good for this app
// who = { oid, name, email, authTime, expires, app }
const role = await myRoleFor(who.oid);                   // your own list
```

- `err.code` is one of `no-token`, `bad-token`, `unknown-key`, `bad-signature`, `wrong-app`, `expired`,
  `microsoft-needed`, `shared-not-allowed`. Answer `401` for all of them.
- `who.shared` is `true` when the token came from a shared device (only possible with `allowShared`).
- `{ app: 'hub', maxAuthAgeDays: 30 }` also requires a Microsoft sign-in on that device in the last 30 days
  (use it for admins). On `microsoft-needed`, have the page's `onSignedIn` return `{ microsoft: true }`.
- Know people by `who.oid`. Names and emails can change.
- Check the token on every request, and allow CORS only for your own site.

## Shared devices

For agency phones and tablets that several people use. Ask Derek to mark the app shared and to list who may set
devices up (he needs their NCEMS email addresses).

- **Setting one up:** on the first screen, "Set up as a shared tablet". Someone on the list signs in with Microsoft
  once. They are signed out of Microsoft again straight away, so their mail isn't left open on the device.
- **Using it:** tap your name, enter your NCEMS PIN. The list is everyone who has an NCEMS PIN. Someone who isn't on
  it signs in to any NCEMS app on their own phone once.
- **Ending:** call `NCEMSSignIn.lock()` when the person's task is done. It also goes back to the names after 5 idle
  minutes, and the token only lasts 30 minutes. `signOut()` on a shared device does the same as `lock()`.
- **Nothing about the person is kept on the device.** Change PIN and Forgot PIN aren't offered there.

**What is weaker:** on a personal device a PIN is useless without that person's own phone. On a shared device the
PIN alone is enough, so someone who has seen a colleague's PIN could act as them **in your app, on a shared device**.
That is why:

- The token says `shared: true`, and `ncems-id-verify.js` **refuses it unless you pass `{ allowShared: true }`**.
- Pass `allowShared` only on the routes crews use from shared devices. Never on admin routes.
- `session.shared` tells the page, so it can hide admin screens on shared devices.
- ncems-id locks a name for 15 minutes after 5 wrong PINs, and locks the device after 10 wrong PINs in 15 minutes.

```js
// page
NCEMSSignIn.init({ app: 'checks', clientId: '…', appName: 'Apparatus Checker', shared: true, sharedSetupBy: 'A battalion chief', … });
// Worker
const who = await ncemsUser(request, { app: 'checks', allowShared: true });   // crew routes
const boss = await ncemsUser(request, { app: 'checks' });                      // admin routes: shared tokens refused
```

## Screens with nobody to type a PIN

Wall displays and kiosks don't use this. Leave them on their own Microsoft sign-in and don't load
`ncems-signin.js` on those pages.

## Rules

- Don't build your own PIN storage or your own token signing.
- Don't put the token in `localStorage`, a cookie or a URL.
- Don't change `ncems-signin.js`; ask Derek, so every app stays the same.
