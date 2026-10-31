# Authentication

Email forms are implemented in AuthPage.tsx; AuthProvider supplies the shared API client and user; AccountPage verifies the current profile and handles logout.

Manual checks: register with a real test email; log in before verification and resend; verify using the email link; log in; request/reset the password; check a consumed reset link is rejected; log out and confirm account access redirects to login. Reload currently signs out by design (memory-only sessions).

Google/Facebook sign-in SDKs are integrated; see SOCIAL-LOGIN.md for provider setup.

Still pending: real-provider testing and social linking UI, durable session design, WEB devices, email links that target the web directly. Native SDKs are not imported into this client.
