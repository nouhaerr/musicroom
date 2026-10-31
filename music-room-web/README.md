# Sonora web

Responsive React + TypeScript client for the Music Room web bonus, built with Vite. It uses the existing NestJS API; this is not a Next.js project.

## Run locally

Use Node.js 24 LTS (the initial scaffold was checked with 24.18.0).

```sh
cd music-room-web
npm ci
cp .env.example .env
npm run dev
```

Open http://localhost:5173. Start the backend separately from `music-room-api` with `make` when implementing API features. `VITE_API_URL` defaults to `http://localhost:3000`; Vite variables are public browser configuration, never secrets. On another device, localhost refers to that device.

```sh
npm run typecheck
npm run build
npm run preview
```

## What exists now

Responsive navigation, email registration/login, resend verification, manual verification-link processing, password reset and logout are connected to the API. `/account` displays the authenticated user and verifies the session via `/users/me`. Errors/success notices disappear after 10 seconds; password requirements appear on invalid submission.

The portable mobile API client was copied into `src/api` with its session regression tests. Changes to that client must be coordinated with the mobile copy. Run `npm test` to check refresh serialization, logout races, authentication and device adapter behavior; these are mocked client tests, not browser acceptance tests.

Browser sessions are **memory-only**: reload or tab closure signs out locally (the server session remains until expiry/revocation). No token is persisted in browser storage. Durable browser sessions, WEB device registration and authenticated guards for future feature pages remain to implement. The backend currently accepts only IOS/ANDROID devices, so the browser does not pretend to be a mobile device.

Existing emails still point to the backend's mobile landing pages. Paste the emailed URL into the web verification/reset form to use it here. Direct web links with `?token=` are supported, but email routing must be configured separately before claiming an end-to-end web email flow.

Production hosting must serve `index.html` for browser routes (including email verification/reset links). `vite preview` is only a local build preview, not a production server.

## Work split

| Owner | Feature folders |
| --- | --- |
| Auth/users developer | `src/features/auth`, `profile`, `friends`, `devices`, `invitations`, `access` |
| Rooms/music developer | `src/features/rooms`, `playlists`, `src/realtime` |
| Coordinate together | `src/app`, `src/components`, `src/api`, `src/styles`, dependency files |

Feature pages, components and endpoint adapters live inside their feature folder. Shared UI goes in `src/components/ui`; shared layout in `src/components/layout`. Replace placeholder elements in `src/app/App.tsx` as pages become functional. The playlist owner action should link to `/playlists/:playlistId/access`.

Agree on the shared HTTP/session client contract first: current user, authenticated requests, refresh, logout, device registration and `X-Device-Id`, consistent errors. Reuse backend contracts and portable mobile logic where appropriate, but do not import Expo SecureStore or native Google/Facebook SDKs into the browser. Browser OAuth is integrated with the provider SDKs; see `src/features/auth/SOCIAL-LOGIN.md` for console setup and remaining live tests. Durable session persistence remains to implement. Confirm web origins, redirect URLs and email links before testing OAuth.

## Branch workflow

The shared starting branch is `feat/web-auth-users-social`. The rooms developer can create a separate branch from it:

```sh
git fetch origin
git switch -c feat/web-rooms origin/feat/web-auth-users-social
```

Each developer commits their own feature changes. Coordinate changes to shared files and review integration before merging to main. This scaffold does not implement subscription or IoT bonuses.

Google/Facebook buttons now exchange browser credentials with the backend. Their public IDs must be configured in `.env`, and website origins authorized in the provider consoles. Existing-account linking UI remains pending.
