# Facebook native sign-in

Login and registration show Facebook beside Google. Existing accounts must sign in
with their usual method and explicitly choose **Link Facebook** in their profile.
No automatic account merging is performed.

## Configuration

In the mobile `.env` set `EXPO_PUBLIC_FACEBOOK_APP_ID` and
`EXPO_PUBLIC_FACEBOOK_CLIENT_TOKEN` (Meta App Settings → Advanced → Client Token).
The App ID must match backend `FACEBOOK_CLIENT_ID`. Never put the backend
`FACEBOOK_CLIENT_SECRET` in the mobile app. The Client Token is intended for native
client configuration and is not the App Secret.

Add iOS platform `com.sonora.musicroom` in Meta. Android needs its package name,
activity and signing key hashes configured for the actual build. While unpublished,
use a Facebook account with an accepted app role and grant `email` permission.

Rebuild after configuring these values; Metro reload alone cannot add native SDKs:

```sh
npx expo prebuild --platform ios
npm run dev:ios
# On an Android development environment:
npm run dev:android
```

Expo Go cannot run this SDK. Advertising ID collection and automatic app-event
logging are disabled. iOS explicitly uses Limited Login, without an ATT request.

## Token handling

- Android sends a Graph access token to `/auth/facebook`; the backend uses
  `debug_token` to check app ownership and checks the returned profile identity.
- iOS sends its OIDC authentication token in `accessToken` and a per-attempt random
  `nonce`. The backend verifies RS256 signature using Meta's fixed JWKS endpoint,
  issuer, application audience, expiration, nonce and required profile claims.
  OIDC tokens are never passed to the Graph API.
- Facebook credentials stay in memory; only Sonora refresh tokens are persisted.
- SDK login state is cleared before and after the interaction. Cancelling does not
  send credentials to the backend. Logout during a dialog prevents late sign-in.

## Manual checks (both platforms)

1. Cancel Facebook → remain logged out; no account created.
2. Use an eligible new Facebook identity → Sonora profile appears, one user exists.
3. Logout and repeat → the same user is returned, no duplicate.
4. Existing email → 409 instructs explicit linking; no automatic merge.
5. Email login → profile → Link Facebook → confirm → logout → Facebook login.
6. Identity already linked to another user → conflict, original account unchanged.
7. Missing email permission → understandable rejection; use email sign-in.
8. Close/reopen Sonora → session restored; logout → close/reopen → logged out.

Tests use mocked providers/storage and signed local RSA fixtures. They do not
prove Meta dashboard configuration or successful real native authorization.

References: https://github.com/thebergamo/react-native-fbsdk-next
and https://developers.facebook.com/docs/facebook-login/limited-login/token/validating/
