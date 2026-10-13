# Profile and account settings

The profile uses real account data. The initial avatar is derived from the name;
no example identity from the design is persisted.

## Visibility and editing

- Public: display name, unique username (not used to sign in), bio,
  photo, musical genres and favorite artists.
- Friends only: city and listening activity preference.
- Private: email, verification status and birthday. Email is read-only.
- The listening preference is stored only. Live presence/current-room sharing is
  not implemented. It needs server-side friendship and room visibility checks,
  removal on revocation, and a mobile realtime subscription.
- Each editor preserves unrelated JSON keys. Avatar changes use a separate route
  so stale profile saves cannot restore a removed photo or bypass image validation.

## Profile photo

Tap **Edit photo** under the avatar to choose/crop a library image or remove it.
Cancelling the picker leaves the current photo unchanged. The photo is public.

The app resizes/compresses the selection before sending a JPEG data URI to
`PUT /users/me/avatar`; `DELETE /users/me/avatar` restores initials. Both routes
require authentication and use the authenticated user's ID. The backend checks
size and JPEG content, limits decoded dimensions, re-encodes to 256 × 256 and
strips metadata. The maximum encoded input is 64,000 base64 characters (48 KB).

For this project the thumbnail is stored in `publicInfo.avatar` in PostgreSQL,
with the profile. No local file paths, public upload folder or migration are needed.
This increases profile/list response size; move avatars to object storage and use
thumbnail URLs before scaling to large user lists.

Native modules were added: `expo-image-picker` and `expo-image-manipulator`.
Rebuild the development app after pulling; a Metro reload alone cannot add native
modules. `npm run dev:ios` builds iOS. For an existing native directory, first run
`npx expo prebuild --platform ios --no-install` to refresh native configuration.

## Manual acceptance

1. Choose a photo, crop it, save; reopen the app and confirm persistence.
2. View the profile from a different account; verify the public photo appears,
   but the email/birthday do not.
3. Replace and remove the photo; cancelling the picker must not change it.
4. Save the bio after changing a photo; verify neither overwrites the other.
5. Check a denied picker permission, interrupted network request, and an old
   development build: show a readable error, keep the existing photo.
6. Save public, friends-only, private and music sections, then reload.
7. Try unlinking both providers on a social-only account; the final method is kept.
8. Check smaller screens and larger accessibility text.

Password accounts use the reset email flow. Social-only accounts have a **Create
password** action that sends a single-use, 30-minute email link to the authenticated
account. Completing it verifies that mailbox and signs out all sessions; linked
Google/Facebook identities remain available. The existing reset screen opens even
if the app is still signed in. Unlinking does not revoke already open sessions.
The bottom tabs currently show paginated read-only account lists, not full room
playback or playlist editors.

Photo library API: https://docs.expo.dev/versions/latest/sdk/imagepicker/
Server image processing: https://sharp.pixelplumbing.com/api-constructor/


## Unique usernames

Public information → Edit accepts 3–30 ASCII letters, digits or underscores; values
are trimmed and stored lowercase. An empty field clears the optional username.
PostgreSQL enforces both the format and uniqueness, including concurrent edits.
A taken username returns 409; invalid input returns 400. Search supports names
and usernames, optionally prefixed with @. Login continues to use email.

The migration imports valid, unambiguous legacy `publicInfo.username` values.
Duplicate/invalid legacy handles are not claimed; their original JSON remains
preserved, but the UI uses only the dedicated username column. Choose a new
username if no handle appears after migration.

Manual checks:
- Two accounts claim `Nouha_42` and `nouha_42`: only one succeeds.
- A social-only account requests Create password, opens the email while still
  signed in, saves an 8+ character password containing a number, then signs in
  with email/password. Google/Facebook login must still reach the same account.
- Reuse the email link: it must fail. After login, Create password becomes Change
  password. Existing sessions are revoked after completing the link.
