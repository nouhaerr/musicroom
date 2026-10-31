# AI assistance

The initial web scaffold was generated with Codex assistance: Vite/React/TypeScript setup, responsive navigation, placeholder routes, folder structure and development documentation.

The scaffold does not implement authentication, browser OAuth, audio playback, subscriptions or IoT. Type checking and production compilation validate the build only; browser interaction, responsive layouts and functional workflows still need manual verification as features are implemented. The team remains responsible for reviewing and explaining the code.

Codex also adapted the portable mobile API client and its regression tests for the email-auth web implementation, and generated forms/session context. Memory-only browser sessions, manual email-link processing and pending browser OAuth/device support are documented in the README. Build and mocked tests do not replace live browser acceptance tests.

Codex implemented browser Google/Facebook SDK adapters, corrected the native browser fetch binding, and separated the shared artwork from the copy. Mocked browser checks cover social exchanges/cancellation and artwork layout; real-provider tests remain manual.

Web profile update: AI assisted with a responsive profile layout, API-backed section editors,
account linking controls and the authenticated user navigation dropdown. Build and client
unit tests were run. Provider authorization still needs testing with real accounts.
