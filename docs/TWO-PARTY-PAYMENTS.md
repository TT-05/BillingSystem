# Receivables, payables, and two-party payment confirmation

## Behavior

The overview now shows **Receivables / 待收款** and **Payables / 待付款** separately, with an amount and outstanding-transfer count on each card. These come directly from the current, already-netted `settlements(balances(...))` output. Original expense counts and gross bilateral debts are not used. Zero amounts/counts are explicit; confirmed server snapshots update the cards immediately. The integer-money and netting algorithm in `src/domain/finance.ts` is unchanged.

Only the recommended debtor sees **I've Paid / 我已付款**. They can report the full recommendation or a smaller positive amount. This creates a **Pending confirmation / 待确认** request without changing the ledger's financial records, balances, or revision. The designated creditor sees **Confirm Receipt / 确认收款** and **Reject / 拒绝**. The debtor can cancel. Both participants can open the immutable status history.

| From                           | To                   | Authorized actor    | Financial effect  |
| ------------------------------ | -------------------- | ------------------- | ----------------- |
| No request                     | Pending confirmation | Debtor              | None              |
| Pending confirmation           | Confirmed            | Designated creditor | One new repayment |
| Pending confirmation           | Rejected             | Designated creditor | None              |
| Pending confirmation           | Cancelled            | Debtor              | None              |
| Confirmed, Rejected, Cancelled | Any state            | Nobody              | Forbidden         |

The current ledger remains shared with its active members. The UI shows a participant's own payment requests; Rules keep confirmation metadata within the same ledger membership boundary as financial history. This is a receipt acknowledgment, not a bank transaction.

## Additive schema and atomic writes

Existing ledgers, financial documents, and historical repayments need no migration. Nothing was written to production during implementation.

| Path beneath `ledgers/{ledgerId}`               | Purpose                                                                             |
| ----------------------------------------------- | ----------------------------------------------------------------------------------- |
| `payments/{requestId}`                          | Immutable terms plus pending/terminal state, actors, server timestamps, and version |
| `paymentSlots/{payerId}/creditors/{receiverId}` | One pending request per debtor/creditor pair, across arbitrary request IDs          |
| `paymentAudit/{requestId}_{version}`            | Immutable before/after snapshots of initiation and terminal response                |
| `records/{requestId}`                           | Created only by creditor confirmation; existing financial envelope/schema           |
| `audit/{requestId}_1`                           | Existing immutable financial audit for the newly effective repayment                |

A request has a random 256-bit hex ID generated once per open form. Retrying its initiation is idempotent. The transaction reads the pair's slot and previous request, so simultaneous requests for the same pair cannot both succeed.

Initiation atomically writes the pending request, slot, and version-1 payment audit. Rejection/cancellation atomically writes the terminal status and version-2 payment audit. Confirmation atomically writes **five documents**: request, payment audit, repayment record, financial audit, and incremented parent ledger revision. The financial record ID equals the request ID. Transactions and Rules prevent a second effective record, terminal replay, or competing terminal responses.

Rules enforce authenticated membership, payer identity on initiation, creditor identity on confirm/reject, debtor-only cancellation, distinct active participants, positive integer minor-unit amounts within the existing per-record bound, ledger currency, immutable payment terms, integer revisions/versions, and authoritative server timestamps. They check paired audit snapshots and the exact payment amount/identities/date in the effective repayment in both directions. A request cannot become confirmed without its repayment, and a repayment cannot be created without the creditor's atomic pending-to-confirmed transition.

The previous generic one-sided repayment creation route is blocked by both client service and Rules. New and legacy repayments are read-only under the new Rules; they retain their existing amounts, versions, deletion flags, and financial effects. Expense and loan corrections still create audited versions. Existing financial and payment audit events cannot be edited or deleted.

## Stale balances and trust boundary

Initiation and confirmation each re-fetch financial records from the server and recompute the unchanged settlement plan. A request must fit the current recommended pair and amount. The transaction reads the parent ledger before this query; every financial write must increment that same revision, causing a concurrent modification to retry or fail safely.

A pending request is tied to its original ledger revision. Any intervening revision change, including another confirmed payment, settings change, or membership update, requires cancelling/rejecting the old request and creating a new request from the updated recommendation. The UI explains this and disables stale receipt confirmation. This intentionally favors a fresh review over silently changing the amount reported as paid.

Rules do **not** independently aggregate every financial record or compute the greedy netting plan. Full-plan validation is client transaction logic over server data; Rules enforce bounded amounts, current revisions, exact request-to-record matching, and the two distinct authenticated actors. A custom client could submit a misleading pending claim, but cannot turn it into an effective repayment without the designated creditor's authenticated approval. As before, shared members can enter incorrect expense/loan facts; audit trails record claims and corrections, not proof of real-world transfers. Administrators can bypass client Rules.

## Mobile authentication and layout

- Email/password remains available. Mobile Google login uses Firebase `signInWithRedirect`; desktop retains `signInWithPopup` with redirect fallback only for `auth/popup-blocked`. A user closing a popup does not trigger a surprise redirect.
- `getRedirectResult` completes before the auth/profile UI is exposed. Existing Google profile initialization and UID-safe account linking remain in place; an unexpected UID after redirect linking is signed out.
- On `bill9206.web.app`, redirect fallback moves to the existing authorized `bill9206.firebaseapp.com` Hosting alias first, so app and Firebase auth helpers share an origin. It preserves the invitation URL and selected language. No Firebase/OAuth token is passed in the URL or manually copied between origins. Google sign-in finishes on the canonical alias; a new OAuth redirect URI or paid proxy is not required.
- Existing authenticated account linking is never moved across origins automatically. If its popup is blocked on `web.app`, the error tells the user to open `bill9206.firebaseapp.com`, sign in with the existing method, and link Google there.
- Emulator Auth is proxied through Vite on the same origin only when `VITE_USE_EMULATORS=true`. This fixed a reproduced WebKit redirect-storage failure with the direct `:9099` helper. Auth/Firestore tests still use the isolated `demo-settle` project. Production has no Vite server or proxy.
- Summary cards and request actions wrap for narrow screens. Dialogs respect dynamic viewport height, payment actions have touch-sized targets, and mobile form inputs use at least 16px text. Language switching and draft input retention are tested.

Implementation follows Firebase's [Google sign-in guidance](https://firebase.google.com/docs/auth/web/google-signin) and [redirect storage guidance](https://firebase.google.com/docs/auth/web/redirect-best-practices). Mobile browser automation uses actual Chromium and WebKit engines with phone viewports/touch/user agents; it is not a physical-device or live Google consent test.

## Verification and local commands

Final results are recorded at the top of `TEST-RESULTS.md`. The unit suite includes unchanged financial calculations, summary netting/counts, localization, and auth redirect behavior. Security tests include complete forged five-write packets, missing audits, unauthorized actors, replay, duplicate initiation, rejection, cancellation, concurrent terminal responses, and a race with a financial edit. Browser scenarios cover English and Chinese financial workflows, full two-party UI, blocked-popup fallback, mobile redirect, mobile email/password, persistence, and no page overflow.

Use Node 22+ and Java 21+. Install browser engines for a fresh test environment:

```sh
npm ci
npx playwright install chromium webkit
npm run lint
npm run typecheck
npm run test
npm run test:integration
npm run test:e2e
npm run build
```

On macOS the existing configuration uses installed Google Chrome for Chromium scenarios; WebKit is installed by Playwright. On Linux, browser dependencies may require `npx playwright install --with-deps chromium webkit`.

## Safe manual redeployment

No deployment or production data migration is part of this task. The architecture still uses only Firebase Authentication, Firestore Standard, and classic static Hosting, within Spark quotas. No dependencies, Functions, paid services, bank APIs, or TTL policies were added.

The existing `.firebaserc` defaults to `bill9206`; Hosting continues to serve `dist`, and no query requires an additional composite index. Environment values and credentials remain unchanged and ignored by Git. **Rules must be deployed before the new frontend.** Old open tabs will have one-sided repayment writes rejected after the Rules update, so ask the five friends to refresh after release.

```sh
cd /Users/test/billSystem
npm run build &&
npx firebase deploy --project bill9206 --only firestore:rules,firestore:indexes &&
npx firebase deploy --project bill9206 --only hosting
```

The existing `npm run deploy` script already enforces the same Rules-first target/order. After release, smoke-test a fresh debtor request and creditor response on the real Hosting site, check zero/pending balances, and verify real Google login on iOS Safari and Android Chrome. Do not test by editing historical production financial records.

## Changed files

See the complete manifest below (paths relative to `/Users/test/billSystem`).

- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/FIREBASE-SETUP.md`
- `docs/MANUAL-TESTING.md`
- `docs/TEST-RESULTS.md`
- `docs/TWO-PARTY-PAYMENTS.md`
- `e2e/google.spec.ts`
- `e2e/ledgerWorkflows.ts`
- `e2e/mobile.spec.ts`
- `e2e/paymentHelpers.ts`
- `e2e/payments.spec.ts`
- `firestore.rules`
- `playwright.config.ts`
- `src/App.tsx`
- `src/components/Auth.tsx`
- `src/components/Payments.tsx`
- `src/components/Profile.tsx`
- `src/components/RecordForm.tsx`
- `src/domain/settlementSummary.ts`
- `src/domain/types.ts`
- `src/i18n/locales/en.json`
- `src/i18n/locales/zh-CN.json`
- `src/services/errors.ts`
- `src/services/firebase.ts`
- `src/services/googleAuth.ts`
- `src/services/ledger.ts`
- `src/services/payments.ts`
- `src/styles.css`
- `tests/i18n.test.ts`
- `tests/payments.rules.test.ts`
- `tests/redirect.test.ts`
- `tests/rules.test.ts`
- `tests/summary.test.ts`
- `vite.config.ts`
- `vitest.config.ts`
- `vitest.rules.config.ts`
