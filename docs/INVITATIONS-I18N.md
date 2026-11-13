# Invitation fix and bilingual UI

## Evidence and diagnosis

Read-only production checks on 2026-11-12 (America/Edmonton):

- The deployed Firestore Rules matched the starting local file byte for byte: SHA-256 `553b038355210f56bf0715bd20f189a17be9172237c5bbc359f6111212431a67`. Release update: `2026-11-13T02:40:57.969405Z` UTC. The frozen snapshot is `tests/fixtures/invitations-before.rules`; it is test data, never a deployment target.
- Deployed Hosting asset `/assets/index-C466k7gW.js` used `expiresAt: Timestamp.fromMillis(Date.now() + 10080 * 60 * 1000)`, equivalent to seven days after the browser clock. Rules capped this value at seven days after **server** request time. A clock ahead of the server beyond network latency causes `permission-denied`, even for a correctly authenticated owner inviting an existing Google user.
- The frozen deployed Rules reproduce that rejection in the emulator with a client clock one minute ahead. They also reproduce rejection of stale ledger name/currency metadata. A valid request with an expiry safely inside the window succeeds with the same owner and recipient.
- The two production Auth accounts were Google accounts with verified, lowercase email addresses. Invitation creation does not read recipient profiles: recipient registration cannot grant or remove the owner's creation permission. Private `users/{uid}` access remains unchanged.
- The historical failed browser request and its device time were not available. Clock-sensitive expiry is a confirmed deployed defect and reproduced cause of this error; its role in that particular historical request cannot be proven retrospectively. Stale metadata was another reproduced failure path and is also fixed.

## Exact changes

New invitation documents use only `createdAt: serverTimestamp()`; Rules derive expiry as `createdAt + duration.value(7, 'd')`. They still enforce owner creation, creator UID, parent ledger metadata, canonical email, random 256-bit tokens, unused/nonrevoked initial state, verified matching email at acceptance, and atomic membership/token consumption.

The creation service reads the current parent ledger inside a transaction, checks ownership, and uses fresh name/currency fields. Email is trimmed, lowercased, and validated. A permission rejection now explains ownership, reload, and Rules rollout checks. No recipient lookup, email enumeration, role escalation, account merge, or new production data is involved.

Old documents retain their original `expiresAt` and expire at exactly that time. No migration is required. Old clients can still create bounded legacy documents under new Rules. Owner revocation remains irreversible. Neither owners nor recipients can rewrite identity, target email, creation time, or expiry. The five-historical-member limit, self-leave checks, financial validation, paired audit writes, and immutable history are preserved.

The UI displays server-derived expiry. A device-clock expiry estimate is advisory; the server decides acceptance. Replayed, revoked, expired, wrong-email, unverified, unauthorized, and malformed requests are tested. Failed acceptance offers email/verification/expiry/capacity/network recovery guidance without disclosing another user's profile.

## Internationalization

- `i18next` and `react-i18next`, bundled English and Simplified Chinese resources in `src/i18n/locales`.
- New users always start in `zh-CN`, without browser-language detection. The accessible `语言 / Language` selector is available on authentication, application, error, and modal screens. Switching is immediate and persists under localStorage key `settle-language`. If storage is blocked, in-memory switching still works.
- English source phrases are stable translation keys (`keySeparator` and `nsSeparator` disabled). `audit.*` and `field.*` cover persisted enum/field labels. Add the same key and matching interpolation variables to both files; resource parity and literal coverage tests prevent missing entries.
- Firebase Auth language follows the UI for verification/reset emails and supported OAuth pages. External Google consent UI remains provider-controlled. Localized system settlement descriptions are searchable.
- Notifications and errors retain stable keys in state and are translated at render time, so visible messages change language immediately. Native form validation is localized as well.
- `Intl` formats displayed money, numbers, percentages, ledger dates, and server timestamps. The actual ledger currency and integer minor-unit arithmetic never change. Input/database dates remain `YYYY-MM-DD`, independent of locale or UTC offset.
- User-entered names, descriptions, and notes remain verbatim. Only canonical settlement descriptions/notes identified by `settlementKey` are localized, including audit history and editing. Existing database content remains compatible.
- No translation network requests, translation SaaS, paid dependency, server code, Functions, Storage, TTL billing, or extensions were added. Expiration is authorization logic, not a Firestore TTL policy.

## Verification and deployment

See `TEST-RESULTS.md` for final counts and the changed-file manifest below. Emulator tests explicitly target `demo-settle`; production checks are read-only.

Registered Web App configuration matches `.env.local`, Authentication's public configuration endpoint returns HTTP 200, `bill9206.web.app` is authorized, and Cloud Billing reports `billingEnabled: false`. `.env.local` is ignored and no credentials are committed. Classic Hosting still serves `dist`; default single-field indexes/index merging suffice for the unchanged queries.

[Firebase pricing](https://firebase.google.com/pricing), [Firestore quotas](https://firebase.google.com/docs/firestore/quotas), and [Hosting quotas](https://firebase.google.com/docs/hosting/usage-quotas-pricing) confirm Spark support for the services used. Normal free-plan quotas still apply.

**Rules must be redeployed.** Deploy Rules/indexes successfully before publishing the new frontend, since new invitation documents intentionally omit `expiresAt`:

```sh
cd /Users/test/billSystem
npm run build
npx firebase deploy --project bill9206 --only firestore:rules,firestore:indexes
npx firebase deploy --project bill9206 --only hosting
```

The `npm run deploy` script also enforces the same Rules-first sequence and explicitly targets `bill9206`.

These commands are recommendations only; this work does not execute them. Node 22+ is required. No remaining Firebase configuration value needs entry. After the owner's manual deployment, refresh open tabs and smoke-test a fresh invitation between the two real Google users, then switch languages and refresh. Emulator OAuth tests do not replace a real Google consent/redirect check on Hosting.

## Changed files

All paths below are relative to `/Users/test/billSystem`.

- `firestore.rules`
- `src/services/ledger.ts`, `src/services/errors.ts`, `src/services/firebase.ts`
- `src/domain/types.ts`, `src/domain/display.ts`, `src/domain/invitations.ts`
- `src/App.tsx`, `src/strings.ts`, `src/styles.css`, `index.html`
- `src/components/Auth.tsx`, `Dialog.tsx`, `GroupSettings.tsx`, `InvitationDialog.tsx`, `LedgerForm.tsx`, `Profile.tsx`, `RecordForm.tsx`, `LanguageSelector.tsx`
- `src/i18n/index.ts`, `format.ts`, `validation.ts`, `authLanguage.ts`, `locales/en.json`, `locales/zh-CN.json`
- `package.json`, `package-lock.json`
- `vitest.config.ts`, `vitest.rules.config.ts`
- `tests/auth.integration.test.ts`, `tests/rules.test.ts`, `tests/i18n.test.ts`, `tests/invitations.regression.test.ts`, `tests/invitations.before.test.ts`, `tests/fixtures/invitations-before.rules`
- `e2e/google.spec.ts`, `e2e/ledger.spec.ts`, `e2e/ledgerWorkflows.ts`, `e2e/ledger.zh.spec.ts`, `e2e/i18n.spec.ts`
- `README.md`, `docs/INVITATIONS-I18N.md`, `docs/TEST-RESULTS.md`, `docs/ARCHITECTURE.md`, `docs/FIREBASE-SETUP.md`

`src/domain/finance.ts`, original financial tests, `.env.local`, Firebase project selection, Hosting settings, and indexes are unchanged.
