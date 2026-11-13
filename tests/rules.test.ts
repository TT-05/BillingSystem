import { newPaymentId, requestPayment, resolvePayment } from '../src/services/payments';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { balances, splitEqual, splitPercentage } from '../src/domain/finance';
import type { FinancialData, FinancialRecord, Ledger } from '../src/domain/types';
import {
  acceptInvitation,
  createLedger,
  invite,
  leaveLedger,
  settings,
  writeFinancial,
} from '../src/services/ledger';
let env: RulesTestEnvironment;
let a: Firestore;
let b: Firestore;
let outsider: Firestore;
const token = 'a'.repeat(64);
const member = (uid: string) => ({ uid, displayName: uid.toUpperCase() });
const payload = (override: Partial<FinancialData> = {}): FinancialData => ({
  kind: 'expense',
  description: 'Groceries',
  amount: 9000,
  currency: 'CAD',
  date: '2026-11-11',
  payerId: 'a',
  receiverId: '',
  participants: ['a', 'b', 'c'],
  shares: { a: 3000, b: 3000, c: 3000 },
  weights: { a: 1, b: 1, c: 1 },
  splitMethod: 'equal',
  notes: '',
  deleted: false,
  settlementKey: '',
  ...override,
});
const write = (
  database = a,
  id = 'r1',
  data = payload(),
  version = 0,
  actor = 'a',
  action: 'create' | 'edit' | 'delete' | 'restore' | 'settle' = 'create',
) =>
  writeFinancial(database, {
    ledgerId: 'home',
    id,
    data,
    actorId: actor,
    expectedVersion: version,
    action,
  });
async function seed() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'ledgers', 'home'), {
      name: 'Home',
      currency: 'CAD',
      ownerId: 'a',
      memberIds: ['a', 'b', 'c'],
      members: { a: { name: 'Alice' }, b: { name: 'Bob' }, c: { name: 'Carol' } },
      revision: 1,
      joinToken: '',
      hasRecords: false,
      createdAt: Timestamp.now(),
    });
    await setDoc(doc(ctx.firestore(), 'ledgers', 'other'), {
      name: 'Private',
      currency: 'USD',
      ownerId: 'x',
      memberIds: ['x'],
      members: { x: { name: 'X' } },
      revision: 1,
      joinToken: '',
      hasRecords: false,
      createdAt: Timestamp.now(),
    });
  });
}
async function forged(
  database: Firestore,
  data: FinancialData = payload(),
  opts: {
    actor?: string;
    before?: FinancialData | null;
    version?: number;
    ledgerId?: string;
    withoutAudit?: boolean;
    at?: Timestamp;
  } = {},
) {
  const version = opts.version || 1;
  const at = opts.at || serverTimestamp();
  const batch = writeBatch(database);
  batch.set(doc(database, 'ledgers', 'home', 'records', 'fake'), {
    ledgerId: opts.ledgerId || 'home',
    data,
    version,
    createdBy: opts.actor || 'a',
    createdAt: at,
    updatedBy: opts.actor || 'a',
    updatedAt: at,
    action: 'create',
  });
  batch.update(doc(database, 'ledgers', 'home'), { revision: increment(1), hasRecords: true });
  if (!opts.withoutAudit)
    batch.set(doc(database, 'ledgers', 'home', 'audit', `fake_${version}`), {
      ledgerId: 'home',
      recordId: 'fake',
      version,
      actorId: opts.actor || 'a',
      at,
      action: 'create',
      before: opts.before || null,
      after: data,
    });
  return batch.commit();
}
beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-settle',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
  a = env
    .authenticatedContext('a', { email: 'alice@example.com', email_verified: true })
    .firestore() as unknown as Firestore;
  b = env
    .authenticatedContext('b', { email: 'bob@example.com', email_verified: true })
    .firestore() as unknown as Firestore;
  outsider = env
    .authenticatedContext('x', { email: 'x@example.com', email_verified: true })
    .firestore() as unknown as Firestore;
});
beforeEach(async () => {
  await env.clearFirestore();
  await seed();
});
afterAll(async () => {
  await env.cleanup();
});
describe('private ledgers and membership', () => {
  it('denies unauthenticated and nonmember reads; members can read', async () => {
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'ledgers', 'home')));
    await assertFails(getDoc(doc(outsider, 'ledgers', 'home')));
    await assertSucceeds(getDoc(doc(b, 'ledgers', 'home')));
  });
  it('creates an owner-only ledger using the actual service', async () => {
    const id = await createLedger(a, member('a'), 'Trip', 'CAD');
    expect((await getDoc(doc(a, 'ledgers', id))).data()?.ownerId).toBe('a');
  });
  it('rejects identity edits and owner escalation', async () => {
    await assertFails(
      setDoc(doc(a, 'users', 'b'), { name: 'Forged', updatedAt: serverTimestamp() }),
    );
    await assertFails(updateDoc(doc(b, 'ledgers', 'home'), { ownerId: 'b', revision: 2 }));
    await assertFails(
      updateDoc(doc(a, 'ledgers', 'home'), { memberIds: arrayUnion('x'), revision: 2 }),
    );
  });
  it('allows self-leave, preserves history names, denies owner leaving', async () => {
    await write();
    await assertSucceeds(leaveLedger(b, 'home', 'b'));
    await assertFails(getDoc(doc(b, 'ledgers', 'home')));
    expect((await getDoc(doc(a, 'ledgers', 'home'))).data()?.members.b.name).toBe('Bob');
    await assertFails(leaveLedger(a, 'home', 'a'));
  });
  it('only the owner changes settings and currency locks after records', async () => {
    const ledger = { ...(await getDoc(doc(a, 'ledgers', 'home'))).data(), id: 'home' } as Ledger;
    await assertFails(settings(b, ledger, 'Oops', 'CAD'));
    await write();
    await assertFails(
      updateDoc(doc(a, 'ledgers', 'home'), { currency: 'USD', revision: increment(1) }),
    );
  });
});
describe('atomic financial writes and audit integrity', () => {
  it('creates, edits, deletes and restores with exact audit preimages', async () => {
    await write();
    await write(
      b,
      'r1',
      payload({ amount: 12000, shares: { a: 4000, b: 4000, c: 4000 } }),
      1,
      'b',
      'edit',
    );
    const current = (
      await getDoc(doc(a, 'ledgers', 'home', 'records', 'r1'))
    ).data() as FinancialRecord;
    expect(balances([current], ['a', 'b', 'c'])).toEqual({ a: 8000, b: -4000, c: -4000 });
    const audit = (await getDoc(doc(a, 'ledgers', 'home', 'audit', 'r1_2'))).data();
    expect(audit?.actorId).toBe('b');
    expect(audit?.before.amount).toBe(9000);
    expect(audit?.after.amount).toBe(12000);
    expect(audit?.at.toMillis()).toBeGreaterThan(0);
    await write(a, 'r1', { ...current.data, deleted: true }, 2, 'a', 'delete');
    await write(a, 'r1', payload(), 3, 'a', 'restore');
    expect((await getDocs(collection(a, 'ledgers', 'home', 'audit'))).size).toBe(4);
  });
  it('denies nonmember financial reads/writes and cross-ledger references', async () => {
    await write();
    await assertFails(getDoc(doc(outsider, 'ledgers', 'home', 'records', 'r1')));
    await assertFails(forged(outsider));
    await assertFails(forged(a, payload({ payerId: 'x' })));
    await assertFails(forged(a, payload(), { ledgerId: 'other' }));
  });
  it.each([0, -1, 1.1, 1000000001])('rejects invalid amount %s', async (n) => {
    await assertFails(forged(a, payload({ amount: n })));
  });
  it('rejects wrong currency, mismatched sums, duplicate participants and wrong split math', async () => {
    await assertFails(forged(a, payload({ currency: 'USD' })));
    await assertFails(forged(a, payload({ shares: { a: 1, b: 1, c: 1 } })));
    await assertFails(forged(a, payload({ participants: ['a', 'b', 'b'] })));
    await assertFails(forged(a, payload({ shares: { a: 4000, b: 3000, c: 2000 } })));
  });
  it('validates exact and percentage allocations on the server, including 5 members', async () => {
    await write(
      a,
      'exact',
      payload({
        splitMethod: 'exact',
        participants: ['b', 'c'],
        shares: { b: 6000, c: 3000 },
        weights: { b: 6000, c: 3000 },
      }),
    );
    await write(
      a,
      'percent',
      payload({
        amount: 100,
        splitMethod: 'percentage',
        shares: { a: 33, b: 33, c: 34 },
        weights: { a: 3333, b: 3333, c: 3334 },
      }),
    );
    await assertFails(
      forged(
        a,
        payload({
          amount: 100,
          splitMethod: 'percentage',
          shares: { a: 34, b: 33, c: 33 },
          weights: { a: 3333, b: 3333, c: 3334 },
        }),
      ),
    );
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'ledgers', 'home'), {
        memberIds: ['a', 'b', 'c', 'd', 'e'],
        members: Object.fromEntries('abcde'.split('').map((id) => [id, { name: id }])),
      });
    });
    const ids = 'abcde'.split('');
    const weights = Object.fromEntries(ids.map((id) => [id, 2000]));
    await write(
      a,
      'five',
      payload({
        amount: 1000000000,
        participants: ids,
        weights,
        shares: splitPercentage(1000000000, weights),
        splitMethod: 'percentage',
      }),
    );
    await write(
      a,
      'equal5',
      payload({
        amount: 101,
        participants: ids,
        weights: Object.fromEntries(ids.map((id) => [id, 1])),
        shares: splitEqual(101, ids),
      }),
    );
  });
  it('rejects writes without matching audit, forged actor, false preimage or client timestamp', async () => {
    await assertFails(forged(a, payload(), { withoutAudit: true }));
    await assertFails(forged(a, payload(), { actor: 'b' }));
    await assertFails(forged(a, payload(), { before: payload() }));
    await assertFails(forged(a, payload(), { at: Timestamp.fromMillis(123) }));
  });
  it('denies standalone audit, alteration, audit deletion and hard record deletion', async () => {
    await write();
    const ref = doc(a, 'ledgers', 'home', 'audit', 'r1_1');
    await assertFails(updateDoc(ref, { actorId: 'b' }));
    await assertFails(deleteDoc(ref));
    await assertFails(deleteDoc(doc(a, 'ledgers', 'home', 'records', 'r1')));
    const value = (await getDoc(ref)).data();
    await assertFails(
      setDoc(doc(a, 'ledgers', 'home', 'audit', 'ghost_1'), { ...value, recordId: 'ghost' }),
    );
  });
  it('rejects stale writes without creating a history version', async () => {
    await write();
    await write(a, 'r1', payload({ description: 'Edited' }), 1, 'a', 'edit');
    await expect(write(b, 'r1', payload({ description: 'Stale' }), 1, 'b', 'edit')).rejects.toThrow(
      'changed while',
    );
    expect((await getDocs(collection(a, 'ledgers', 'home', 'audit'))).size).toBe(2);
  });
  it('handles concurrent edits: one succeeds, one gets a conflict', async () => {
    await write();
    const results = await Promise.allSettled([
      write(a, 'r1', payload({ description: 'Alice' }), 1, 'a', 'edit'),
      write(b, 'r1', payload({ description: 'Bob' }), 1, 'b', 'edit'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await getDocs(collection(a, 'ledgers', 'home', 'audit'))).size).toBe(2);
  });
  it('also rejects a malicious stale version submitted directly', async () => {
    await write();
    const record = (await getDoc(doc(a, 'ledgers', 'home', 'records', 'r1'))).data();
    const batch = writeBatch(a);
    batch.set(doc(a, 'ledgers', 'home', 'records', 'r1'), {
      ...record,
      data: payload({ description: 'Bypass' }),
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(a, 'ledgers', 'home'), { revision: increment(1) });
    await assertFails(batch.commit());
  });
  it('idempotent retries do not duplicate loans, and corrections remain audited', async () => {
    const p = payload({ kind: 'loan', participants: [], shares: {}, weights: {}, receiverId: 'b' });
    await write(a, 'loan', p);
    await write(a, 'loan', p);
    expect((await getDocs(collection(a, 'ledgers', 'home', 'records'))).size).toBe(1);
    await write(a, 'loan', { ...p, amount: 5000 }, 1, 'a', 'edit');
    expect((await getDocs(collection(a, 'ledgers', 'home', 'audit'))).size).toBe(2);
    expect(
      balances(
        (await getDocs(collection(a, 'ledgers', 'home', 'records'))).docs.map(
          (d) => d.data() as FinancialRecord,
        ),
        ['a', 'b', 'c'],
      ),
    ).toEqual({ a: 5000, b: -5000, c: 0 });
  });
  it('requires fresh balances for both debtor request and creditor confirmation', async () => {
    await write();
    const id = newPaymentId();
    const input = {
      id,
      ledgerId: 'home',
      payerId: 'b',
      receiverId: 'a',
      amount: 3000,
      actorId: 'b',
      expectedLedgerRevision: 1,
    };
    await expect(requestPayment(b, input)).rejects.toThrow('Balances changed');
    await requestPayment(b, { ...input, expectedLedgerRevision: 2 });
    await write(
      a,
      'r1',
      payload({ amount: 12000, shares: { a: 4000, b: 4000, c: 4000 } }),
      1,
      'a',
      'edit',
    );
    await expect(resolvePayment(a, 'home', id, 'a', 'confirmed')).rejects.toThrow(
      'Balances changed',
    );
  });
});
describe('settlement retries and membership bounds', () => {
  it('cannot replay a committed settlement or reopen it with its original revision', async () => {
    await write();
    const id = newPaymentId();
    const input = {
      id,
      ledgerId: 'home',
      payerId: 'b',
      receiverId: 'a',
      amount: 3000,
      actorId: 'b',
      expectedLedgerRevision: 2,
    };
    await requestPayment(b, input);
    await requestPayment(b, input);
    await resolvePayment(a, 'home', id, 'a', 'confirmed');
    await expect(resolvePayment(a, 'home', id, 'a', 'confirmed')).rejects.toThrow(
      'already been processed',
    );
    await expect(requestPayment(b, input)).rejects.toThrow('already been processed');
    expect((await getDocs(collection(a, 'ledgers', 'home', 'audit'))).size).toBe(2);
  });
  it('rejects a sixth historical member even with a valid targeted invitation', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'ledgers', 'home'), {
        members: {
          a: { name: 'a' },
          b: { name: 'b' },
          c: { name: 'c' },
          d: { name: 'd' },
          e: { name: 'e' },
        },
      });
      await setDoc(doc(ctx.firestore(), 'invitations', token), {
        ledgerId: 'home',
        ledgerName: 'Home',
        currency: 'CAD',
        email: 'x@example.com',
        createdBy: 'a',
        createdAt: Timestamp.now(),
        expiresAt: Timestamp.fromMillis(Date.now() + 3600000),
        usedBy: null,
        usedAt: null,
        revoked: false,
      });
    });
    await assertFails(acceptInvitation(outsider, token, { ...member('x'), emailVerified: true }));
  });
});
describe('secure invitations', () => {
  async function invitation(overrides: Record<string, unknown> = {}) {
    await env.withSecurityRulesDisabled((ctx) =>
      setDoc(doc(ctx.firestore(), 'invitations', token), {
        ledgerId: 'home',
        ledgerName: 'Home',
        currency: 'CAD',
        email: 'x@example.com',
        createdBy: 'a',
        createdAt: Timestamp.now(),
        expiresAt: Timestamp.fromMillis(Date.now() + 3600000),
        usedBy: null,
        usedAt: null,
        revoked: false,
        ...overrides,
      }),
    );
  }
  it('owner creates a random targeted invitation via actual service', async () => {
    const ledger = { ...(await getDoc(doc(a, 'ledgers', 'home'))).data(), id: 'home' } as Ledger;
    const id = await invite(a, ledger, 'x@example.com', 'a');
    expect(id).toMatch(/^[a-f0-9]{64}$/);
    await expect(invite(b, ledger, 'x@example.com', 'b')).rejects.toThrow('Only the ledger owner');
    await assertFails(getDoc(doc(b, 'invitations', id)));
  });
  it('verified intended recipient joins atomically and token cannot be replayed', async () => {
    await invitation();
    await assertSucceeds(
      acceptInvitation(outsider, token, { ...member('x'), emailVerified: true }),
    );
    expect((await getDoc(doc(outsider, 'ledgers', 'home'))).data()?.memberIds).toContain('x');
    await expect(
      acceptInvitation(outsider, token, { ...member('x'), emailVerified: true }),
    ).rejects.toThrow('already used');
  });
  it.each([
    { revoked: true },
    { expiresAt: Timestamp.fromMillis(1) },
    { usedBy: 'someone' },
    { email: 'different@example.com' },
  ])('rejects invitation outside constraints %j', async (override) => {
    await invitation(override);
    if (override.revoked || override.usedBy)
      await expect(
        acceptInvitation(outsider, token, { ...member('x'), emailVerified: true }),
      ).rejects.toThrow('revoked or already used');
    else
      await assertFails(acceptInvitation(outsider, token, { ...member('x'), emailVerified: true }));
  });
  it('rejects unverified email, membership without redemption, and standalone redemption', async () => {
    await invitation();
    const unverified = env
      .authenticatedContext('x', { email: 'x@example.com', email_verified: false })
      .firestore() as unknown as Firestore;
    await assertFails(acceptInvitation(unverified, token, { ...member('x'), emailVerified: true }));
    await assertFails(
      updateDoc(doc(outsider, 'ledgers', 'home'), {
        memberIds: arrayUnion('x'),
        members: {
          a: { name: 'Alice' },
          b: { name: 'Bob' },
          c: { name: 'Carol' },
          x: { name: 'X' },
        },
        revision: 2,
        joinToken: token,
      }),
    );
    await assertFails(
      updateDoc(doc(outsider, 'invitations', token), { usedBy: 'x', usedAt: serverTimestamp() }),
    );
  });
});

it('allows a former member to rejoin a ledger with five historical UIDs', async () => {
  await env.withSecurityRulesDisabled((ctx) =>
    updateDoc(doc(ctx.firestore(), 'ledgers', 'home'), {
      members: {
        a: { name: 'a' },
        b: { name: 'b' },
        c: { name: 'c' },
        d: { name: 'd' },
        e: { name: 'e' },
      },
    }),
  );
  await leaveLedger(b, 'home', 'b');
  const ledger = { ...(await getDoc(doc(a, 'ledgers', 'home'))).data(), id: 'home' } as Ledger;
  const invitation = await invite(a, ledger, 'bob@example.com', 'a');
  await acceptInvitation(b, invitation, { ...member('b'), emailVerified: true });
  expect((await getDoc(doc(b, 'ledgers', 'home'))).data()?.memberIds).toContain('b');
});

it('rejects a non-recommended transfer even when the UI has a fresh ledger revision', async () => {
  await write();
  await write(
    a,
    'r1',
    payload({ amount: 12000, shares: { a: 4000, b: 4000, c: 4000 } }),
    1,
    'a',
    'edit',
  );
  await expect(
    requestPayment(b, {
      id: newPaymentId(),
      ledgerId: 'home',
      payerId: 'b',
      receiverId: 'c',
      amount: 3000,
      actorId: 'b',
      expectedLedgerRevision: 3,
    }),
  ).rejects.toThrow('Balances changed');
  expect((await getDocs(collection(a, 'ledgers', 'home', 'records'))).size).toBe(1);
});
