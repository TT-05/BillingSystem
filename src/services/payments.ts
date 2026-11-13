import {
  collection,
  doc,
  getDocsFromServer,
  runTransaction,
  serverTimestamp,
  increment,
} from 'firebase/firestore';
import type { Firestore, Transaction, WithFieldValue } from 'firebase/firestore';
import { amount, balances, settlements } from '../domain/finance';
import type {
  FinancialData,
  FinancialRecord,
  Ledger,
  PaymentRequest,
  PaymentStatus,
} from '../domain/types';
import { localDateISO } from '../i18n/format';
export function newPaymentId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}
const STALE =
  'Balances changed. Cancel or reject this request and review the current settlement plan.';
const TERMINAL = 'This payment request has already been processed. Refresh its status.';
async function validateRecommendation(
  db: Firestore,
  ledger: Ledger,
  payerId: string,
  receiverId: string,
  value: number,
) {
  amount(value);
  if (
    payerId === receiverId ||
    !ledger.memberIds.includes(payerId) ||
    !ledger.memberIds.includes(receiverId)
  )
    throw new Error('Both payment participants must be active ledger members.');
  // Every financial write increments ledger.revision. The transaction reads the
  // ledger BEFORE this server-only query, so concurrent writes cause a retry.
  const records = await getDocsFromServer(collection(db, 'ledgers', ledger.id, 'records'));
  if (records.metadata.hasPendingWrites)
    throw new Error('Some changes are still syncing. Review the updated settlement plan.');
  const plan = settlements(
    balances(
      records.docs.map((r) => r.data() as FinancialRecord),
      Object.keys(ledger.members),
    ),
  );
  if (!plan.some((s) => s.payerId === payerId && s.receiverId === receiverId && s.amount >= value))
    throw new Error(STALE);
}
function audit(
  tx: Transaction,
  db: Firestore,
  lid: string,
  id: string,
  before: Omit<PaymentRequest, 'id'> | null,
  after: WithFieldValue<Omit<PaymentRequest, 'id'>>,
) {
  tx.set(doc(db, 'ledgers', lid, 'paymentAudit', id + '_' + after.version), {
    ledgerId: lid,
    requestId: id,
    version: after.version,
    actorId: after.updatedBy,
    at: after.updatedAt,
    before,
    after,
  });
}
export async function requestPayment(
  db: Firestore,
  input: {
    id: string;
    ledgerId: string;
    payerId: string;
    receiverId: string;
    amount: number;
    actorId: string;
    expectedLedgerRevision: number;
  },
) {
  if (!/^[a-f0-9]{64}$/.test(input.id)) throw new Error('Invalid payment request.');
  if (input.actorId !== input.payerId) throw new Error('Only the debtor can report a payment.');
  amount(input.amount);
  return runTransaction(db, async (tx) => {
    const ref = doc(db, 'ledgers', input.ledgerId, 'payments', input.id);
    const ledgerRef = doc(db, 'ledgers', input.ledgerId);
    const slotRef = doc(
      db,
      'ledgers',
      input.ledgerId,
      'paymentSlots',
      input.payerId,
      'creditors',
      input.receiverId,
    );
    const [current, ledgerSnap, slot] = await Promise.all([
      tx.get(ref),
      tx.get(ledgerRef),
      tx.get(slotRef),
    ]);
    if (current.exists()) {
      const d = current.data();
      if (
        d.status === 'pending' &&
        d.payerId === input.actorId &&
        d.receiverId === input.receiverId &&
        d.amount === input.amount &&
        d.ledgerRevision === input.expectedLedgerRevision
      )
        return input.id;
      throw new Error(TERMINAL);
    }
    const ledger = { ...ledgerSnap.data(), id: input.ledgerId } as Ledger;
    if (ledger.revision !== input.expectedLedgerRevision) throw new Error(STALE);
    if (slot.exists()) {
      const previous = await tx.get(
        doc(db, 'ledgers', input.ledgerId, 'payments', slot.data().requestId),
      );
      if (previous.data()?.status === 'pending')
        throw new Error(
          'A pending request already exists for this transfer. Review or cancel it first.',
        );
    }
    await validateRecommendation(db, ledger, input.payerId, input.receiverId, input.amount);
    const at = serverTimestamp();
    const request = {
      ledgerId: ledger.id,
      payerId: input.payerId,
      receiverId: input.receiverId,
      amount: input.amount,
      currency: ledger.currency,
      date: localDateISO(),
      ledgerRevision: ledger.revision,
      status: 'pending' as const,
      version: 1,
      createdBy: input.actorId,
      createdAt: at,
      updatedBy: input.actorId,
      updatedAt: at,
    };
    tx.set(ref, request);
    tx.set(slotRef, { requestId: input.id });
    audit(tx, db, ledger.id, input.id, null, request);
    return input.id;
  });
}
export async function resolvePayment(
  db: Firestore,
  ledgerId: string,
  id: string,
  actorId: string,
  status: Exclude<PaymentStatus, 'pending'>,
) {
  if (!['confirmed', 'rejected', 'cancelled'].includes(status))
    throw new Error('Invalid payment request.');
  await runTransaction(db, async (tx) => {
    const requestRef = doc(db, 'ledgers', ledgerId, 'payments', id);
    const ledgerRef = doc(db, 'ledgers', ledgerId);
    const [snapshot, ledgerSnap, record] = await Promise.all([
      tx.get(requestRef),
      tx.get(ledgerRef),
      tx.get(doc(db, 'ledgers', ledgerId, 'records', id)),
    ]);
    if (!snapshot.exists()) throw new Error('Payment request not found.');
    const before = snapshot.data() as Omit<PaymentRequest, 'id'>;
    if (before.status !== 'pending') throw new Error(TERMINAL);
    if (actorId !== (status === 'cancelled' ? before.payerId : before.receiverId))
      throw new Error('You cannot perform this payment action.');
    const ledger = { ...ledgerSnap.data(), id: ledgerId } as Ledger;
    if (!ledger.memberIds.includes(actorId))
      throw new Error('Both payment participants must be active ledger members.');
    if (status === 'confirmed') {
      if (ledger.revision !== before.ledgerRevision) throw new Error(STALE);
      if (record.exists()) throw new Error(TERMINAL);
      await validateRecommendation(db, ledger, before.payerId, before.receiverId, before.amount);
    }
    const at = serverTimestamp();
    const after = { ...before, status, version: 2, updatedBy: actorId, updatedAt: at };
    tx.update(requestRef, { status, version: 2, updatedBy: actorId, updatedAt: at });
    audit(tx, db, ledgerId, id, before, after);
    if (status === 'confirmed') {
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
      };
      tx.set(doc(db, 'ledgers', ledgerId, 'records', id), {
        ledgerId,
        data,
        version: 1,
        createdBy: actorId,
        createdAt: at,
        updatedBy: actorId,
        updatedAt: at,
        action: 'settle',
      });
      tx.set(doc(db, 'ledgers', ledgerId, 'audit', id + '_1'), {
        ledgerId,
        recordId: id,
        version: 1,
        actorId,
        at,
        action: 'settle',
        before: null,
        after: data,
      });
      tx.update(ledgerRef, { hasRecords: true, revision: increment(1) });
    }
  });
}
