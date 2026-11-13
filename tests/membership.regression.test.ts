import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, Timestamp, updateDoc } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { leaveLedger, writeFinancial } from '../src/services/ledger';
import { splitEqual } from '../src/domain/finance';
let env: RulesTestEnvironment;
let owner: Firestore;
let member: Firestore;
const ledgerPath = ['ledgers', 'membership-regression'] as const;
const names = {
  a: { name: 'Alice' },
  b: { name: 'Bob' },
  c: { name: 'Carol' },
  d: { name: 'Dan' },
  e: { name: 'Eve' },
};
beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-settle',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
  owner = env
    .authenticatedContext('a', { email: 'alice@example.com', email_verified: true })
    .firestore() as unknown as Firestore;
  member = env
    .authenticatedContext('b', { email: 'bob@example.com', email_verified: true })
    .firestore() as unknown as Firestore;
});
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled((ctx) =>
    setDoc(doc(ctx.firestore(), ...ledgerPath), {
      name: 'Regression ledger',
      currency: 'CAD',
      ownerId: 'a',
      memberIds: ['a', 'b', 'c'],
      members: names,
      revision: 1,
      joinToken: '',
      hasRecords: false,
      createdAt: Timestamp.now(),
    }),
  );
});
afterAll(async () => {
  await env.cleanup();
});
describe('membership update authorization regressions', () => {
  it.each([
    { name: 'duplicate remaining UIDs (previously accepted)', ids: ['a', 'a', 'c'] },
    {
      name: 'over-five duplicate active list (previously accepted)',
      ids: ['a', 'c', 'a', 'c', 'a', 'c'],
    },
    { name: 'remove the owner', ids: ['c'] },
    { name: 'remove another member instead of self', ids: ['a', 'b'] },
    { name: 'add an uninvited UID', ids: ['a', 'c', 'x'] },
    { name: 'swap in an inactive historical member', ids: ['a', 'd'] },
    { name: 'empty active membership', ids: [] },
    { name: 'map instead of a UID list', ids: { a: true, c: true } },
  ])('rejects $name without changing ledger state', async ({ ids }) => {
    await assertFails(updateDoc(doc(member, ...ledgerPath), { memberIds: ids, revision: 2 }));
    const unchanged = (await getDoc(doc(owner, ...ledgerPath))).data();
    expect(unchanged?.memberIds).toEqual(['a', 'b', 'c']);
    expect(unchanged?.members).toEqual(names);
    expect(unchanged?.revision).toBe(1);
  });
  it('does not allow leaving to erase historical UIDs or change ownership', async () => {
    await assertFails(
      updateDoc(doc(member, ...ledgerPath), {
        memberIds: ['a', 'c'],
        members: { a: names.a, c: names.c },
        revision: 2,
      }),
    );
    await assertFails(
      updateDoc(doc(member, ...ledgerPath), { memberIds: ['a', 'c'], ownerId: 'c', revision: 2 }),
    );
    await assertFails(
      updateDoc(doc(member, ...ledgerPath), {
        memberIds: ['a', 'c'],
        members: { ...names, f: { name: 'Sixth' } },
        revision: 2,
      }),
    );
    expect((await getDoc(doc(owner, ...ledgerPath))).data()?.members).toEqual(names);
  });
  it('does not let the owner or a nonmember use the self-leave path', async () => {
    await assertFails(leaveLedger(owner, 'membership-regression', 'a'));
    const outsider = env.authenticatedContext('x').firestore() as unknown as Firestore;
    await assertFails(
      updateDoc(doc(outsider, ...ledgerPath), { memberIds: ['a', 'c'], revision: 2 }),
    );
  });
  it('preserves a legitimate five-member leave, historical references and immutable finance/audit records', async () => {
    const ids = Object.keys(names);
    await env.withSecurityRulesDisabled((ctx) =>
      updateDoc(doc(ctx.firestore(), ...ledgerPath), { memberIds: ids }),
    );
    const shares = splitEqual(12000, ids);
    await writeFinancial(owner, {
      ledgerId: 'membership-regression',
      id: 'original-expense',
      actorId: 'a',
      expectedVersion: 0,
      action: 'create',
      data: {
        kind: 'expense',
        description: 'Shared expense',
        amount: 12000,
        currency: 'CAD',
        date: '2026-11-12',
        payerId: 'a',
        receiverId: '',
        participants: ids,
        shares,
        weights: Object.fromEntries(ids.map((id) => [id, 1])),
        splitMethod: 'equal',
        notes: '',
        deleted: false,
        settlementKey: '',
      },
    });
    const recordRef = doc(owner, ...ledgerPath, 'records', 'original-expense');
    const auditRef = doc(owner, ...ledgerPath, 'audit', 'original-expense_1');
    const recordBefore = (await getDoc(recordRef)).data(),
      auditBefore = (await getDoc(auditRef)).data();
    await assertSucceeds(leaveLedger(member, 'membership-regression', 'b'));
    const remaining = (await getDoc(doc(owner, ...ledgerPath))).data();
    expect(remaining?.memberIds).toEqual(['a', 'c', 'd', 'e']);
    expect(remaining?.members).toEqual(names);
    expect(remaining?.ownerId).toBe('a');
    expect(remaining?.revision).toBe(3);
    expect((await getDoc(recordRef)).data()).toEqual(recordBefore);
    expect((await getDoc(auditRef)).data()).toEqual(auditBefore);
    await assertFails(getDoc(doc(member, ...ledgerPath)));
    await assertFails(getDoc(doc(member, ...ledgerPath, 'records', 'original-expense')));
    await assertFails(getDoc(doc(member, ...ledgerPath, 'audit', 'original-expense_1')));
  });
});
