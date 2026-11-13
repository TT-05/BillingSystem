import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  arrayUnion,
  doc,
  getDoc,
  getDocs,
  collection,
  increment,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import {
  acceptInvitation,
  createLedger,
  invite,
  leaveLedger,
  revokeInvitation,
} from '../src/services/ledger';
import type { Ledger } from '../src/domain/types';
let env: RulesTestEnvironment;
let owner: Firestore;
let recipient: Firestore;
let outsider: Firestore;
let unverified: Firestore;
let ledger: Ledger;
const target = { uid: 'google-recipient', displayName: 'Google Friend', emailVerified: true };
const raw = (extra: Record<string, unknown> = {}) => ({
  ledgerId: ledger.id,
  ledgerName: ledger.name,
  currency: ledger.currency,
  email: 'friend@example.com',
  createdBy: 'google-owner',
  createdAt: serverTimestamp(),
  usedBy: null,
  usedAt: null,
  revoked: false,
  ...extra,
});
const newToken = () =>
  crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-settle',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
  const ctx = (uid: string, email: string, verified = true) =>
    env
      .authenticatedContext(uid, {
        email,
        email_verified: verified,
        firebase: { sign_in_provider: 'google.com' },
      })
      .firestore() as unknown as Firestore;
  owner = ctx('google-owner', 'owner@example.com');
  recipient = ctx(target.uid, 'Friend@Example.COM');
  outsider = ctx('outsider', 'outsider@example.com');
  unverified = ctx('unverified', 'friend@example.com', false);
});
beforeEach(async () => {
  await env.clearFirestore();
  const id = await createLedger(
    owner,
    { uid: 'google-owner', displayName: 'Owner' },
    'Home',
    'CAD',
  );
  ledger = { id, ...(await getDoc(doc(owner, 'ledgers', id))).data() } as Ledger;
});
afterAll(async () => {
  vi.restoreAllMocks();
  await env.cleanup();
});
describe('invitation authorization, server expiry and Google email regression', () => {
  it('reproduces deployed seven-day boundary rejection with a clock ahead by one minute', async () => {
    await assertFails(
      setDoc(
        doc(owner, 'invitations', newToken()),
        raw({ expiresAt: Timestamp.fromMillis(Date.now() + 7 * 86400000 + 60000) }),
      ),
    );
  });
  it.each([86400000, -86400000])(
    'creates with server time despite client clock skew %i',
    async (skew) => {
      const real = Date.now();
      const clock = vi.spyOn(Date, 'now').mockReturnValue(real + skew);
      let token: string;
      try {
        token = await invite(owner, ledger, '  Friend@Example.COM  ', 'google-owner');
      } finally {
        clock.mockRestore();
      }
      const data = (await getDoc(doc(owner, 'invitations', token!))).data()!;
      expect(data.email).toBe('friend@example.com');
      expect(data.expiresAt).toBeUndefined();
      expect(Math.abs(data.createdAt.toMillis() - real)).toBeLessThan(30000);
      await assertSucceeds(acceptInvitation(recipient, token!, target));
    },
  );
  it('uses fresh owner-authorized metadata when the UI ledger snapshot is stale', async () => {
    await updateDoc(doc(owner, 'ledgers', ledger.id), {
      name: 'Renamed',
      currency: 'USD',
      revision: increment(1),
    });
    const token = await invite(owner, ledger, 'friend@example.com', 'google-owner');
    expect((await getDoc(doc(owner, 'invitations', token))).data()).toMatchObject({
      ledgerName: 'Renamed',
      currency: 'USD',
    });
  });
  it('allows only the verified invited Google identity, atomically and once', async () => {
    const token = await invite(owner, ledger, 'friend@example.com', 'google-owner');
    await assertFails(getDoc(doc(outsider, 'invitations', token)));
    await assertFails(getDocs(collection(recipient, 'invitations')));
    await expect(
      acceptInvitation(unverified, token, { ...target, uid: 'unverified', emailVerified: false }),
    ).rejects.toThrow('Verify');
    await assertFails(acceptInvitation(unverified, token, { ...target, uid: 'unverified' }));
    await assertFails(
      updateDoc(doc(recipient, 'invitations', token), {
        usedBy: target.uid,
        usedAt: serverTimestamp(),
      }),
    );
    await assertSucceeds(acceptInvitation(recipient, token, target));
    const joined = (await getDoc(doc(recipient, 'ledgers', ledger.id))).data()!;
    expect(joined.memberIds).toEqual(['google-owner', target.uid]);
    expect(joined.members[target.uid].name).toBe('Google Friend');
    await expect(acceptInvitation(recipient, token, target)).rejects.toThrow('already used');
    expect((await getDoc(doc(owner, 'invitations', token))).data()?.usedBy).toBe(target.uid);
    // Bypass the service guard and replay after leaving: Rules must reject it too.
    await leaveLedger(recipient, ledger.id, target.uid);
    const replay = writeBatch(recipient);
    replay.update(doc(recipient, 'invitations', token), {
      usedBy: target.uid,
      usedAt: serverTimestamp(),
    });
    replay.update(doc(recipient, 'ledgers', ledger.id), {
      memberIds: arrayUnion(target.uid),
      [`members.${target.uid}`]: { name: 'Friend' },
      joinToken: token,
      revision: increment(1),
    });
    await assertFails(replay.commit());
  });
  it('rejects non-owner creation and invitation forgery by a joined member', async () => {
    const token = await invite(owner, ledger, 'friend@example.com', 'google-owner');
    await acceptInvitation(recipient, token, target);
    await expect(invite(recipient, ledger, 'other@example.com', target.uid)).rejects.toThrow(
      'Only the ledger owner',
    );
    await assertFails(
      setDoc(doc(recipient, 'invitations', newToken()), raw({ createdBy: target.uid })),
    );
    await assertFails(setDoc(doc(outsider, 'invitations', newToken()), raw()));
    await assertFails(
      setDoc(
        doc(
          env.unauthenticatedContext().firestore() as unknown as Firestore,
          'invitations',
          newToken(),
        ),
        raw(),
      ),
    );
  });
  it.each([
    { createdBy: 'outsider' },
    { ledgerName: 'Forged' },
    { currency: 'USD' },
    { createdAt: Timestamp.fromMillis(1) },
    { email: 'Friend@Example.COM' },
    { email: 'broken' },
    { usedBy: 'outsider' },
    { revoked: true },
    { extra: 'hidden' },
    { expiresAt: Timestamp.fromMillis(1) },
  ])('rejects malformed invitation %j', async (override) => {
    await assertFails(setDoc(doc(owner, 'invitations', newToken()), raw(override)));
  });
  it.each(['createdAt', 'expiresAt', 'email', 'createdBy', 'ledgerId'])(
    'prevents owners from rewriting invitation identity or expiry: %s',
    async (field) => {
      const token = await invite(owner, ledger, 'friend@example.com', 'google-owner');
      await assertFails(
        updateDoc(doc(owner, 'invitations', token), {
          [field]: field.endsWith('At')
            ? Timestamp.fromMillis(Date.now() + 86400000)
            : 'forged@example.com',
        }),
      );
    },
  );
  it('retains legacy explicit expiry without extending old or revoked tokens', async () => {
    const legacy = newToken();
    await setDoc(
      doc(owner, 'invitations', legacy),
      raw({ expiresAt: Timestamp.fromMillis(Date.now() + 3600000) }),
    );
    await assertSucceeds(acceptInvitation(recipient, legacy, target));
    const revoked = await invite(owner, ledger, 'friend@example.com', 'google-owner');
    await revokeInvitation(owner, revoked);
    await expect(acceptInvitation(recipient, revoked, target)).rejects.toThrow('revoked');
    await assertFails(updateDoc(doc(recipient, 'invitations', revoked), { revoked: false }));
  });
  it('rejects expired server-time and legacy tokens while leaving membership unchanged', async () => {
    for (const legacy of [false, true]) {
      const token = newToken();
      await env.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(
          doc(ctx.firestore(), 'invitations', token),
          raw({
            createdAt: Timestamp.fromMillis(Date.now() - 8 * 86400000),
            ...(legacy ? { expiresAt: Timestamp.fromMillis(Date.now() - 1) } : {}),
          }),
        );
      });
      await assertFails(acceptInvitation(recipient, token, target));
    }
    expect((await getDoc(doc(owner, 'ledgers', ledger.id))).data()?.memberIds).toEqual([
      'google-owner',
    ]);
  });
  it('rejects joining without consuming the token or changing another member name', async () => {
    const token = await invite(owner, ledger, 'friend@example.com', 'google-owner');
    await assertFails(
      updateDoc(doc(recipient, 'ledgers', ledger.id), {
        memberIds: arrayUnion(target.uid),
        [`members.${target.uid}`]: { name: 'Friend' },
        joinToken: token,
        revision: increment(1),
      }),
    );
    const batch = writeBatch(recipient);
    batch.update(doc(recipient, 'invitations', token), {
      usedBy: target.uid,
      usedAt: serverTimestamp(),
    });
    batch.update(doc(recipient, 'ledgers', ledger.id), {
      memberIds: arrayUnion(target.uid),
      [`members.${target.uid}`]: { name: 'Friend' },
      'members.google-owner': { name: 'Forged' },
      joinToken: token,
      revision: increment(1),
    });
    await assertFails(batch.commit());
  });
});
