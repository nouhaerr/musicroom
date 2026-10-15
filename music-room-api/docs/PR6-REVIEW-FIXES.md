# PR #6 review follow-up

- Email lookup and creation normalize whitespace and case for password and social
  flows. DTOs normalize email before validation; the local guard is covered by
  service-level normalization too. Existing reset links tolerate the normalization.
- Migration `20261015010000_normalize_email` normalizes existing addresses under a
  table lock, then adds a check constraint. The existing unique index prevents
  concurrent duplicate claims. It stops without merging/deleting accounts if two
  addresses normalize to the same value.
- Before deploying, check for conflicts with:
  ```sql
  SELECT lower(btrim(email)) AS normalized_email, count(*)
  FROM "User" GROUP BY lower(btrim(email)) HAVING count(*) > 1;
  ```
  Resolve conflicts through verified account ownership; do not automatically merge
  accounts or delete user data. If deployment already failed, after resolving the
  conflict mark only this migration rolled back with `prisma migrate resolve
  --rolled-back 20261015010000_normalize_email`, then retry `prisma migrate deploy`.
- Registration and profile name updates are limited to 100 characters. Registration
  applies the same input limit in the mobile form.
- Browser verification/reset pages use `Cache-Control: no-store` and
  `Referrer-Policy: no-referrer`. Invalid verification links show a readable HTML
  error while retaining the error HTTP status, with no automatic success redirect.
- Password setup errors now direct API callers to `forgot-password`. The profile's
  Change password button already uses that email-reset flow.
- Android Open email app uses MAIN + APP_EMAIL through `expo-intent-launcher`.
  If no handler exists, the UI explains that users can open their email/webmail
  manually. iOS retains Gmail / Apple Mail fallback.
- Rebuild the Android development app after installing dependencies: this change
  adds a native module. Verify the inbox button and missing-handler fallback on
  device; JS/unit tests alone cannot validate the installed mail applications.
- `Button` and `Field` are exported from mobile `src/components/FormControls.tsx`.
  Legacy fallback form fields were removed; logged-out settings and legal text
  are now English. Legal text remains a test-version draft.
- The Expo MIT notice is preserved and labeled as a template notice. It does not
  grant a project-wide license for Sonora-specific code.
