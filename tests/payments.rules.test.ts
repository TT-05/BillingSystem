import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertFails, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
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
import { balances } from '../src/domain/finance';
import type { FinancialData, FinancialRecord, PaymentRequest } from '../src/domain/types';
import { newPaymentId, requestPayment, resolvePayment } from '../src/services/payments';
import { writeFinancial } from '../src/services/ledger';
let env: RulesTestEnvironment;
let a: Firestore;
let b: Firestore;
let c: Firestore;
let outside: Firestore;
const expense = (amount = 10000): FinancialData => ({
  kind: 'expense',
  description: 'Dinner',
  amount,
  currency: 'CAD',
  date: '2026-11-12',
  payerId: 'a',
  receiverId: '',
  participants: ['b'],
  shares: { b: amount },
  weights: { b: 1 },
  splitMethod: 'equal',
  notes: '',
  deleted: false,
  settlementKey: '',
});
const proposed = (id = newPaymentId(), amount = 10000) => ({
  id,
  ledgerId: 'home',
  payerId: 'b',
  receiverId: 'a',
  amount,
  actorId: 'b',
  expectedLedgerRevision: 2,
});
const raw = (extra: Record<string, unknown> = {}) => ({
  ledgerId: 'home',
  payerId: 'b',
  receiverId: 'a',
  amount: 10000,
  currency: 'CAD',
  date: '2026-11-12',
  ledgerRevision: 2,
  status: 'pending',
  version: 1,
  createdBy: 'b',
  createdAt: serverTimestamp(),
  updatedBy: 'b',
  updatedAt: serverTimestamp(),
  ...extra,
});
async function rawCreate(
  db: Firestore,
  id: string,
  extra: Record<string, unknown> = {},
  audit = true,
  slot = true,
) {
  const d = raw(extra);
  const batch = writeBatch(db);
  batch.set(doc(db, 'ledgers', 'home', 'payments', id), d);
  if (audit)
    batch.set(doc(db, 'ledgers', 'home', 'paymentAudit', id + '_1'), {
      ledgerId: 'home',
      requestId: id,
      version: 1,
      actorId: d.updatedBy,
      at: serverTimestamp(),
      before: null,
      after: d,
    });
  if (slot)
    batch.set(
      doc(
        db,
        'ledgers',
        'home',
        'paymentSlots',
        String(d.payerId),
        'creditors',
        String(d.receiverId),
      ),
      { requestId: id },
    );
  return batch.commit();
}
async function fullConfirmation(
  db: Firestore,
  id: string,
  actor: string,
  patch: Partial<FinancialData> = {},
  omit: 'none' | 'paymentAudit' | 'financialAudit' = 'none',
) {
  const before = (await getDoc(doc(db, 'ledgers', 'home', 'payments', id))).data()!;
  const after = {
    ...before,
    status: 'confirmed',
    version: 2,
    updatedBy: actor,
    updatedAt: serverTimestamp(),
  };
  const data: FinancialData = {
    kind: 'repayment',
    description: 'Settlement payment',
    amount: before.amount,
    currency: before.currency,
    date: before.date,
    payerId: before.payerId,
    receiverId: before.receiverId,
    participants: [],
    shares: {},
    weights: {},
    splitMethod: 'equal',
    notes: 'Confirmed from settlement recommendation',
    deleted: false,
    settlementKey: id,
    ...patch,
  };
  const batch = writeBatch(db);
  batch.update(doc(db, 'ledgers', 'home', 'payments', id), after);
  if (omit !== 'paymentAudit')
    batch.set(doc(db, 'ledgers', 'home', 'paymentAudit', id + '_2'), {
      ledgerId: 'home',
      requestId: id,
      version: 2,
      actorId: actor,
      at: serverTimestamp(),
      before,
      after,
    });
  batch.set(doc(db, 'ledgers', 'home', 'records', id), {
    ledgerId: 'home',
    data,
    version: 1,
    action: 'settle',
    createdBy: actor,
    createdAt: serverTimestamp(),
    updatedBy: actor,
    updatedAt: serverTimestamp(),
  });
  if (omit !== 'financialAudit')
    batch.set(doc(db, 'ledgers', 'home', 'audit', id + '_1'), {
      ledgerId: 'home',
      recordId: id,
      version: 1,
      actorId: actor,
      at: serverTimestamp(),
      action: 'settle',
      before: null,
      after: data,
    });
  batch.update(doc(db, 'ledgers', 'home'), { hasRecords: true, revision: increment(1) });
  return batch.commit();
}
async function request() {
  const input = proposed();
  await requestPayment(b, input);
  return input.id;
}
async function net() {
  return balances(
    (await getDocs(collection(a, 'ledgers', 'home', 'records'))).docs.map(
      (d) => d.data() as FinancialRecord,
    ),
    ['a', 'b', 'c'],
  );
}
beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-settle',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
  const ctx = (id: string) =>
    env
      .authenticatedContext(id, { email: id + '@example.com', email_verified: true })
      .firestore() as unknown as Firestore;
  a = ctx('a');
  b = ctx('b');
  c = ctx('c');
  outside = ctx('outsider');
});
beforeEach(async () => {
  await env.clearFirestore();
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
  });
  await writeFinancial(a, {
    ledgerId: 'home',
    id: 'expense',
    data: expense(),
    actorId: 'a',
    expectedVersion: 0,
    action: 'create',
  });
});
afterAll(async () => {
  await env.cleanup();
});
describe('two-party confirmation, financial effect, immutable atomic histories', () => {
  it('keeps pending money out of balances and confirms exactly once with five atomic writes', async () => {
    const id = await request();
    expect(await net()).toEqual({ a: 10000, b: -10000, c: 0 });
    expect((await getDoc(doc(a, 'ledgers', 'home'))).data()?.revision).toBe(2);
    await resolvePayment(a, 'home', id, 'a', 'confirmed');
    expect(await net()).toEqual({ a: 0, b: 0, c: 0 });
    const record = (await getDoc(doc(a, 'ledgers', 'home', 'records', id))).data()!;
    expect(record.data).toMatchObject({
      kind: 'repayment',
      payerId: 'b',
      receiverId: 'a',
      amount: 10000,
      settlementKey: id,
    });
    expect(record.createdBy).toBe('a');
    const p = (await getDoc(doc(b, 'ledgers', 'home', 'payments', id))).data()!;
    expect(p).toMatchObject({ status: 'confirmed', version: 2, createdBy: 'b', updatedBy: 'a' });
    expect(p.createdAt.toMillis()).toBeGreaterThan(0);
    expect(p.updatedAt.toMillis()).toBeGreaterThanOrEqual(p.createdAt.toMillis());
    for (const version of [1, 2])
      expect(
        (await getDoc(doc(b, 'ledgers', 'home', 'paymentAudit', id + '_' + version))).exists(),
      ).toBe(true);
    expect((await getDoc(doc(a, 'ledgers', 'home', 'audit', id + '_1'))).data()?.actorId).toBe('a');
    await expect(resolvePayment(a, 'home', id, 'a', 'confirmed')).rejects.toThrow(
      'already been processed',
    );
    expect((await getDocs(collection(a, 'ledgers', 'home', 'records'))).size).toBe(2);
  });
  it('supports partial payments and leaves the remaining recommendation intact', async () => {
    const input = proposed(newPaymentId(), 3000);
    await requestPayment(b, input);
    await resolvePayment(a, 'home', input.id, 'a', 'confirmed');
    expect(await net()).toEqual({ a: 7000, b: -7000, c: 0 });
  });
  it.each(['rejected', 'cancelled'] as const)(
    '%s has no financial effect and is terminal',
    async (status) => {
      const id = await request();
      await resolvePayment(
        status === 'cancelled' ? b : a,
        'home',
        id,
        status === 'cancelled' ? 'b' : 'a',
        status,
      );
      expect(await net()).toEqual({ a: 10000, b: -10000, c: 0 });
      expect((await getDoc(doc(a, 'ledgers', 'home', 'records', id))).exists()).toBe(false);
      await expect(resolvePayment(a, 'home', id, 'a', 'confirmed')).rejects.toThrow(
        'already been processed',
      );
      await requestPayment(b, proposed());
    },
  );
  it('retries initiation idempotently, but prevents another pending request for the same pair', async () => {
    const input = proposed();
    await requestPayment(b, input);
    await requestPayment(b, input);
    await expect(requestPayment(b, proposed())).rejects.toThrow('pending request already exists');
    expect((await getDocs(collection(a, 'ledgers', 'home', 'payments'))).size).toBe(1);
    await assertFails(rawCreate(b, newPaymentId()));
  });
  it('allows only one of simultaneous duplicate initiations', async () => {
    const results = await Promise.allSettled([
      requestPayment(b, proposed()),
      requestPayment(b, proposed()),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await getDocs(collection(a, 'ledgers', 'home', 'payments'))).size).toBe(1);
  });
  it('allows only one simultaneous creditor confirmation', async () => {
    const id = await request();
    const results = await Promise.allSettled([
      resolvePayment(a, 'home', id, 'a', 'confirmed'),
      resolvePayment(a, 'home', id, 'a', 'confirmed'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await net()).toEqual({ a: 0, b: 0, c: 0 });
    expect((await getDocs(collection(a, 'ledgers', 'home', 'paymentAudit'))).size).toBe(2);
    expect((await getDocs(collection(a, 'ledgers', 'home', 'audit'))).size).toBe(2);
  });
  it('serializes cancellation/confirmation and rejection/confirmation races', async () => {
    for (const alternative of ['cancelled', 'rejected'] as const) {
      if (alternative === 'rejected') {
        await writeFinancial(a, {
          ledgerId: 'home',
          id: 'expense',
          data: expense(20000),
          actorId: 'a',
          expectedVersion: 1,
          action: 'edit',
        });
      }
      const revision = (await getDoc(doc(a, 'ledgers', 'home'))).data()!.revision;
      const input = { ...proposed(), expectedLedgerRevision: revision, amount: 10000 };
      await requestPayment(b, input);
      const results = await Promise.allSettled([
        resolvePayment(a, 'home', input.id, 'a', 'confirmed'),
        resolvePayment(
          alternative === 'cancelled' ? b : a,
          'home',
          input.id,
          alternative === 'cancelled' ? 'b' : 'a',
          alternative,
        ),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const status = (await getDoc(doc(a, 'ledgers', 'home', 'payments', input.id))).data()!.status;
      expect((await getDoc(doc(a, 'ledgers', 'home', 'records', input.id))).exists()).toBe(
        status === 'confirmed',
      );
    }
  });
  it('rejects stale initiation and confirmation after financial changes; cancellation remains possible', async () => {
    const id = await request();
    await writeFinancial(a, {
      ledgerId: 'home',
      id: 'expense',
      data: expense(11000),
      actorId: 'a',
      expectedVersion: 1,
      action: 'edit',
    });
    await expect(resolvePayment(a, 'home', id, 'a', 'confirmed')).rejects.toThrow(
      'Balances changed',
    );
    await expect(requestPayment(b, proposed())).rejects.toThrow('Balances changed');
    expect(await net()).toEqual({ a: 11000, b: -11000, c: 0 });
    await resolvePayment(b, 'home', id, 'b', 'cancelled');
  });
  it('rejects an amount above the recommendation and a pair which is not recommended', async () => {
    await expect(requestPayment(b, proposed(newPaymentId(), 10001))).rejects.toThrow(
      'Balances changed',
    );
    await expect(requestPayment(b, { ...proposed(), receiverId: 'c' })).rejects.toThrow(
      'Balances changed',
    );
    await expect(requestPayment(a, { ...proposed(), actorId: 'a' })).rejects.toThrow(
      'Only the debtor',
    );
  });
  it('makes confirmed and legacy repayments read-only, without changing historical data', async () => {
    const id = await request();
    await resolvePayment(a, 'home', id, 'a', 'confirmed');
    const original = (await getDoc(doc(a, 'ledgers', 'home', 'records', id))).data()!;
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'ledgers', 'home', 'records', 'legacy'), {
        ...original,
        data: { ...original.data, settlementKey: '' },
      });
    });
    for (const rid of [id, 'legacy']) {
      const batch = writeBatch(a);
      const data = { ...original.data, deleted: true };
      batch.update(doc(a, 'ledgers', 'home', 'records', rid), {
        data,
        version: 2,
        action: 'delete',
        updatedBy: 'a',
        updatedAt: serverTimestamp(),
      });
      batch.set(doc(a, 'ledgers', 'home', 'audit', rid + '_2'), {
        ledgerId: 'home',
        recordId: rid,
        version: 2,
        actorId: 'a',
        at: serverTimestamp(),
        action: 'delete',
        before: original.data,
        after: data,
      });
      batch.update(doc(a, 'ledgers', 'home'), { revision: increment(1), hasRecords: true });
      await assertFails(batch.commit());
      await assertFails(deleteDoc(doc(a, 'ledgers', 'home', 'records', rid)));
    }
    expect((await getDoc(doc(a, 'ledgers', 'home', 'records', id))).data()).toEqual(original);
  });
});
describe('direct Rules enforcement against forged clients', () => {
  it.each([
    { amount: 0 },
    { amount: -1 },
    { amount: 100.5 },
    { amount: 1000000001 },
    { currency: 'USD' },
    { payerId: 'a' },
    { receiverId: 'b' },
    { receiverId: 'outsider' },
    { createdBy: 'a' },
    { createdAt: Timestamp.fromMillis(1) },
    { updatedBy: 'a' },
    { updatedAt: Timestamp.fromMillis(1) },
    { ledgerRevision: 1 },
    { status: 'confirmed' },
    { version: 2 },
    { extra: 'forged' },
    { ledgerId: 'elsewhere' },
  ])('rejects malformed or spoofed request %j', async (extra) => {
    await assertFails(rawCreate(b, newPaymentId(), extra));
  });
  it('requires initial audit and duplicate lock, and cannot create a lock alone', async () => {
    await assertFails(rawCreate(b, newPaymentId(), {}, false));
    await assertFails(rawCreate(b, newPaymentId(), {}, true, false));
    await assertFails(
      setDoc(doc(b, 'ledgers', 'home', 'paymentSlots', 'b', 'creditors', 'a'), {
        requestId: newPaymentId(),
      }),
    );
  });
  it('denies outsiders/anonymous access to requests, locks and audit', async () => {
    const id = await request();
    for (const db of [outside, env.unauthenticatedContext().firestore() as unknown as Firestore])
      for (const path of [
        ['payments', id],
        ['paymentAudit', id + '_1'],
        ['paymentSlots', 'b', 'creditors', 'a'],
      ])
        await assertFails(getDoc(doc(db, 'ledgers', 'home', ...path)));
    await assertFails(rawCreate(outside, newPaymentId()));
  });
  it.each([
    ['b', 'confirmed'],
    ['b', 'rejected'],
    ['a', 'cancelled'],
    ['c', 'confirmed'],
    ['c', 'rejected'],
    ['c', 'cancelled'],
  ] as const)(
    'rejects unauthorized actor %s action %s even with a forged paired audit',
    async (actor, status) => {
      const id = await request();
      const db = actor === 'a' ? a : actor === 'b' ? b : c;
      const before = (await getDoc(doc(db, 'ledgers', 'home', 'payments', id))).data()!;
      const after = {
        ...before,
        status,
        version: 2,
        updatedBy: actor,
        updatedAt: serverTimestamp(),
      };
      const batch = writeBatch(db);
      batch.update(doc(db, 'ledgers', 'home', 'payments', id), after);
      batch.set(doc(db, 'ledgers', 'home', 'paymentAudit', id + '_2'), {
        ledgerId: 'home',
        requestId: id,
        version: 2,
        actorId: actor,
        at: serverTimestamp(),
        before,
        after,
      });
      await assertFails(batch.commit());
    },
  );
  it('cannot confirm without the repayment, cannot update amount/parties, and cannot tamper with history', async () => {
    const id = await request();
    const before = (await getDoc(doc(a, 'ledgers', 'home', 'payments', id))).data()!;
    for (const extra of [{}, { amount: 1 }, { payerId: 'c' }, { receiverId: 'c' }]) {
      const after = {
        ...before,
        ...extra,
        status: 'confirmed',
        version: 2,
        updatedBy: 'a',
        updatedAt: serverTimestamp(),
      };
      const batch = writeBatch(a);
      batch.update(doc(a, 'ledgers', 'home', 'payments', id), after);
      batch.set(doc(a, 'ledgers', 'home', 'paymentAudit', id + '_2'), {
        ledgerId: 'home',
        requestId: id,
        version: 2,
        actorId: 'a',
        at: serverTimestamp(),
        before,
        after,
      });
      await assertFails(batch.commit());
    }
    await assertFails(
      updateDoc(doc(b, 'ledgers', 'home', 'paymentAudit', id + '_1'), { actorId: 'a' }),
    );
    await assertFails(deleteDoc(doc(b, 'ledgers', 'home', 'paymentAudit', id + '_1')));
    await assertFails(deleteDoc(doc(b, 'ledgers', 'home', 'payments', id)));
  });
  it('blocks the old one-sided repayment service', async () => {
    await expect(
      writeFinancial(b, {
        ledgerId: 'home',
        id: 'old',
        data: {
          ...expense(),
          kind: 'repayment',
          payerId: 'b',
          receiverId: 'a',
          participants: [],
          shares: {},
          weights: {},
        },
        actorId: 'b',
        expectedVersion: 0,
        action: 'create',
      }),
    ).rejects.toThrow('creditor');
  });
  it('rejects stale creditor confirmation even when bypassing client checks', async () => {
    const id = await request();
    await updateDoc(doc(a, 'ledgers', 'home'), { revision: increment(1) });
    const before = (await getDoc(doc(a, 'ledgers', 'home', 'payments', id))).data() as Omit<
      PaymentRequest,
      'id'
    >;
    const after = {
      ...before,
      status: 'confirmed',
      version: 2,
      updatedBy: 'a',
      updatedAt: serverTimestamp(),
    };
    const data = {
      ...expense(),
      kind: 'repayment',
      payerId: 'b',
      receiverId: 'a',
      participants: [],
      shares: {},
      weights: {},
      settlementKey: id,
    };
    const batch = writeBatch(a);
    batch.update(doc(a, 'ledgers', 'home', 'payments', id), after);
    batch.set(doc(a, 'ledgers', 'home', 'paymentAudit', id + '_2'), {
      ledgerId: 'home',
      requestId: id,
      version: 2,
      actorId: 'a',
      at: serverTimestamp(),
      before,
      after,
    });
    batch.set(doc(a, 'ledgers', 'home', 'records', id), {
      ledgerId: 'home',
      data,
      version: 1,
      action: 'settle',
      createdBy: 'a',
      createdAt: serverTimestamp(),
      updatedBy: 'a',
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(a, 'ledgers', 'home', 'audit', id + '_1'), {
      ledgerId: 'home',
      recordId: id,
      version: 1,
      actorId: 'a',
      at: serverTimestamp(),
      before: null,
      after: data,
      action: 'settle',
    });
    batch.update(doc(a, 'ledgers', 'home'), { hasRecords: true, revision: increment(1) });
    await assertFails(batch.commit());
  });
});

describe('complete forged packets and concurrent ledger changes', () => {
  it('accepts the designated creditor packet, then rejects replay at the Rules layer', async () => {
    const id = await request();
    await fullConfirmation(a, id, 'a');
    await assertFails(fullConfirmation(a, id, 'a'));
    expect(await net()).toEqual({ a: 0, b: 0, c: 0 });
  });
  it.each(['b', 'c'])(
    'denies a complete packet signed by %s instead of the creditor',
    async (actor) => {
      const id = await request();
      await assertFails(fullConfirmation(actor === 'b' ? b : c, id, actor));
      expect(await net()).toEqual({ a: 10000, b: -10000, c: 0 });
    },
  );
  it.each([
    { amount: 1 },
    { amount: 10001 },
    { payerId: 'c' },
    { receiverId: 'c' },
    { currency: 'USD' },
    { settlementKey: 'forged' },
    { deleted: true },
    { kind: 'loan' },
  ] as Partial<FinancialData>[])(
    'cannot substitute effective repayment fields %j',
    async (patch) => {
      const id = await request();
      await assertFails(fullConfirmation(a, id, 'a', patch));
    },
  );
  it.each(['paymentAudit', 'financialAudit'] as const)(
    'requires the atomic %s event',
    async (omit) => {
      const id = await request();
      await assertFails(fullConfirmation(a, id, 'a', {}, omit));
      expect((await getDoc(doc(a, 'ledgers', 'home', 'payments', id))).data()?.status).toBe(
        'pending',
      );
    },
  );
  it('blocks a one-sided legacy packet even when its financial audit and ledger revision are correct', async () => {
    const id = newPaymentId();
    const data = {
      ...expense(),
      kind: 'repayment',
      payerId: 'b',
      receiverId: 'a',
      participants: [],
      shares: {},
      weights: {},
    };
    const batch = writeBatch(b);
    batch.set(doc(b, 'ledgers', 'home', 'records', id), {
      ledgerId: 'home',
      data,
      version: 1,
      action: 'create',
      createdBy: 'b',
      createdAt: serverTimestamp(),
      updatedBy: 'b',
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(b, 'ledgers', 'home', 'audit', id + '_1'), {
      ledgerId: 'home',
      recordId: id,
      version: 1,
      actorId: 'b',
      at: serverTimestamp(),
      action: 'create',
      before: null,
      after: data,
    });
    batch.update(doc(b, 'ledgers', 'home'), { revision: increment(1), hasRecords: true });
    await assertFails(batch.commit());
  });
  it('serializes an expense edit racing with confirmation without losing money', async () => {
    const id = await request();
    const [confirmation, edit] = await Promise.allSettled([
      resolvePayment(a, 'home', id, 'a', 'confirmed'),
      writeFinancial(a, {
        ledgerId: 'home',
        id: 'expense',
        data: expense(11000),
        actorId: 'a',
        expectedVersion: 1,
        action: 'edit',
      }),
    ]);
    expect(edit.status).toBe('fulfilled');
    const expected = confirmation.status === 'fulfilled' ? 1000 : 11000;
    expect(await net()).toEqual({ a: expected, b: -expected, c: 0 });
  });
});
