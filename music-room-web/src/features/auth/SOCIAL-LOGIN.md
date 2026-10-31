# Browser social login

The web uses Google's official Identity Services button (ID token) and Meta's JavaScript SDK (user access token). Credentials are sent to the existing backend routes `/auth/google` and `/auth/facebook` for verification. No provider secret belongs in Vite configuration.

Set public values in the ignored `.env`:

- `VITE_GOOGLE_CLIENT_ID`: the Web client ID whose audience the backend accepts.
- `VITE_FACEBOOK_APP_ID`: the same Meta app ID used by the backend.
- `VITE_FACEBOOK_API_VERSION`: supported Graph version, currently v26.0.

For local Google testing, add `http://localhost:5173` as an authorized JavaScript origin for the Web OAuth client in Google Cloud. Add test users if the consent app is in testing. This integration uses popup credentials, not a backend redirect callback. Use the same hostname consistently.

For Meta, configure the Website platform and Facebook Login JavaScript SDK domains to match the web origin. Enable JavaScript SDK login; development accounts must have a role in the app. Use HTTPS if Meta rejects the HTTP development origin. Do not publish or change app mode just to bypass a configuration error. Enable the email permission for the login use case.

Allow provider popups/scripts. On SDK load failure the page provides retry; Facebook cancellation sends no login request. Existing-email conflicts remain errors requiring explicit linking: the browser linking interface is still to implement. Sessions remain memory-only.

Verification performed: TypeScript/build, mocked API tests, browser tests with mocked SDKs for Google login, Facebook login/cancellation, and stable artwork bounds. Real provider acceptance still requires a manual login after console configuration. No claim that live OAuth is validated yet.

References:
- https://developers.google.com/identity/gsi/web/guides/display-button
- https://developers.google.com/identity/gsi/web/reference/js-reference
- https://developers.facebook.com/docs/javascript/reference/FB.login/
