// Frozen, read-only production Rules snapshot taken before the invitation fix.
// This file reproduces the old rejection; all other suites use current Rules.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { beforeAll, afterAll, beforeEach, expect, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, serverTimestamp, setDoc, Timestamp } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
let env: RulesTestEnvironment;
let owner: Firestore;
beforeAll(async () => {
  const rules = readFileSync('tests/fixtures/invitations-before.rules', 'utf8');
  expect(createHash('sha256').update(rules).digest('hex')).toBe(
    '553b038355210f56bf0715bd20f189a17be9172237c5bbc359f6111212431a67',
  );
  env = await initializeTestEnvironment({
    projectId: 'demo-settle',
    firestore: { rules, host: '127.0.0.1', port: 8080 },
  });
  owner = env
    .authenticatedContext('google-owner', {
      email: 'owner@example.com',
      email_verified: true,
      firebase: { sign_in_provider: 'google.com' },
    })
    .firestore() as unknown as Firestore;
});
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'ledgers', 'home'), {
      name: 'Google home',
      currency: 'CAD',
      ownerId: 'google-owner',
      memberIds: ['google-owner'],
      members: { 'google-owner': { name: 'Owner' } },
      createdAt: Timestamp.now(),
      revision: 1,
      joinToken: '',
      hasRecords: false,
    });
    // Recipient has already signed in and registered a private Google profile.
    await setDoc(doc(db, 'users', 'google-recipient'), {
      name: 'Google Friend',
      updatedAt: Timestamp.now(),
    });
  });
});
afterAll(async () => {
  await env.cleanup();
});
const oldPayload = (extra: Record<string, unknown> = {}) => ({
  ledgerId: 'home',
  ledgerName: 'Google home',
  currency: 'CAD',
  email: 'friend@example.com',
  createdBy: 'google-owner',
  createdAt: serverTimestamp(),
  expiresAt: Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000),
  usedBy: null,
  usedAt: null,
  revoked: false,
  ...extra,
});
it('reproduces the production code failure under exact deployed Rules with an ahead browser clock', async () => {
  await assertSucceeds(
    setDoc(
      doc(owner, 'invitations', 'a'.repeat(64)),
      oldPayload({ expiresAt: Timestamp.fromMillis(Date.now() + 3600000) }),
    ),
  );
  await assertFails(
    setDoc(
      doc(owner, 'invitations', 'b'.repeat(64)),
      oldPayload({ expiresAt: Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000 + 60000) }),
    ),
  );
});
it('reproduces stale UI metadata rejection without any recipient-profile authorization dependency', async () => {
  await assertFails(
    setDoc(
      doc(owner, 'invitations', 'c'.repeat(64)),
      oldPayload({
        ledgerName: 'Stale name',
        expiresAt: Timestamp.fromMillis(Date.now() + 3600000),
      }),
    ),
  );
  await assertSucceeds(
    setDoc(
      doc(owner, 'invitations', 'd'.repeat(64)),
      oldPayload({ expiresAt: Timestamp.fromMillis(Date.now() + 3600000) }),
    ),
  );
});
