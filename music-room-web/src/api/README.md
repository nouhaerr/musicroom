# Shared web API contract

```tsx
import { ApiError, type ApiClient } from '../../api';
import { useAuth } from '../auth/AuthProvider';

// Inside a component rendered by App (already wrapped in AuthProvider):
const { client, user } = useAuth();
// user is reactive; client is the same instance used by /auth/login.
const playlists = await client.request<Playlist[]>('/playlists');
```

For non-React services, `import { client } from '../api'` (adjust relative path).
Do not instantiate another ApiClient in feature pages: it would have a separate session.

- `client.baseUrl`: normalized server origin from `VITE_API_URL`, default `http://localhost:3000`.
- `client.user`: current `{ id, name, email, musicPreferences }` or null.
- `request<T>(path, method = 'GET', body?)`: relative API path starting with `/`; JSON body, Bearer authorization and parsed JSON response. A 401 refreshes once and retries once. Parallel HTTP/socket refreshes share a single operation; late refusals reuse the renewed token.
- `ApiError`: `status` and server `message` for HTTP refusals (including 403, 404, 409, 429). Network failures use status 0. A failed/interrupted refresh clears the session; never automatically loop on authentication failure.
- `subscribe(listener)`: notified on login, logout, refresh and profile changes; returns unsubscribe. It does not emit immediately: read `client.user` initially.
- `socketAuth(refusedToken?)`: resolves `{ token, deviceId }`; passing the currently refused token refreshes it first. A stale refused token reuses the current session. Rejects with 401 when logged out.

`deviceId` is currently **null on web**, because the backend only supports IOS/ANDROID device registration. Socket callers must support null; do not invent a mobile device identity.

Sessions are memory-only: reload/closing the tab requires another login. Credentials are not persisted in localStorage/sessionStorage. The login route is `/auth/login`; `/account` demonstrates authenticated profile loading/logout. Use `user` from useAuth for reactive page guards. Backend authorization is always authoritative.

The portable client and tests originate from music-room-mobile; keep contract changes coordinated between copies. Tests cover rotation races, logout, errors and socket authentication. Native SDKs are not included.
