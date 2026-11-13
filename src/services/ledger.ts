import { balances, canonical, settlements } from '../domain/finance';
import {
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocsFromServer,
  increment,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import type {
  Action,
  Currency,
  FinancialData,
  FinancialRecord,
  Invitation,
  Ledger,
} from '../domain/types';
export async function saveProfile(db: Firestore, user: Pick<User, 'uid' | 'displayName'>) {
  await setDoc(doc(db, 'users', user.uid), {
    name: user.displayName?.trim() || 'Member',
    updatedAt: serverTimestamp(),
  });
}
export async function createLedger(
  db: Firestore,
  user: Pick<User, 'uid' | 'displayName'>,
  name: string,
  currency: Currency,
) {
  const ref = doc(collection(db, 'ledgers'));
  await setDoc(ref, {
    name: name.trim(),
    currency,
    ownerId: user.uid,
    memberIds: [user.uid],
    members: { [user.uid]: { name: user.displayName || 'Member' } },
    createdAt: serverTimestamp(),
    revision: 1,
    joinToken: '',
    hasRecords: false,
  });
  return ref.id;
}
export async function settings(db: Firestore, ledger: Ledger, name: string, currency: Currency) {
  await runTransaction(db, async (tx) => {
    const ref = doc(db, 'ledgers', ledger.id);
    const current = await tx.get(ref);
    if (current.data()?.revision !== ledger.revision)
      throw new Error('Group settings changed. Please review and try again.');
    tx.update(ref, { name: name.trim(), currency, revision: ledger.revision + 1 });
  });
}
export async function leaveLedger(db: Firestore, id: string, uid: string) {
  await updateDoc(doc(db, 'ledgers', id), { memberIds: arrayRemove(uid), revision: increment(1) });
}
export async function invite(db: Firestore, ledger: Ledger, email: string, uid: string) {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  await setDoc(doc(db, 'invitations', token), {
    ledgerId: ledger.id,
    ledgerName: ledger.name,
    currency: ledger.currency,
    email: email.trim().toLowerCase(),
    createdBy: uid,
    createdAt: serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000),
    usedBy: null,
    usedAt: null,
    revoked: false,
  });
  return token;
}
export async function acceptInvitation(
  db: Firestore,
  token: string,
  user: Pick<User, 'uid' | 'displayName' | 'emailVerified'>,
) {
  if (!user.emailVerified)
    throw new Error(
      'Verify your email before accepting this invitation, then click Refresh verification.',
    );
  const ref = doc(db, 'invitations', token);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Invitation not found.');
  const invitation = snap.data() as Invitation;
  const batch = writeBatch(db);
  batch.update(ref, { usedBy: user.uid, usedAt: serverTimestamp() });
  batch.update(doc(db, 'ledgers', invitation.ledgerId), {
    memberIds: arrayUnion(user.uid),
    [`members.${user.uid}`]: { name: user.displayName || 'Member' },
    joinToken: token,
    revision: increment(1),
  });
  await batch.commit();
  return invitation.ledgerId;
}
export async function revokeInvitation(db: Firestore, token: string) {
  await updateDoc(doc(db, 'invitations', token), { revoked: true });
}
export interface WriteInput {
  ledgerId: string;
  id: string;
  data: FinancialData;
  actorId: string;
  expectedVersion: number;
  action: Action;
  expectedLedgerRevision?: number;
}
// A stable id is generated once when a form opens, so retrying an uncertain submission is idempotent.
export async function writeFinancial(db: Firestore, input: WriteInput): Promise<void> {
  const { ledgerId, id, data, actorId, expectedVersion, action } = input;
  await runTransaction(db, async (tx) => {
    const ref = doc(db, 'ledgers', ledgerId, 'records', id);
    const old = await tx.get(ref);
    const ledgerRef = doc(db, 'ledgers', ledgerId);
    const ledger = await tx.get(ledgerRef);
    const existing = old.exists() ? (old.data() as FinancialRecord) : null;
    if (
      existing &&
      existing.version === expectedVersion + 1 &&
      existing.updatedBy === actorId &&
      canonical(existing.data) === canonical(data) &&
      existing.action === action
    )
      return;
    if (
      input.expectedLedgerRevision !== undefined &&
      ledger.data()?.revision !== input.expectedLedgerRevision
    )
      throw new Error('Balances changed. Review the updated settlement plan before confirming.');
    if ((existing?.version || 0) !== expectedVersion)
      throw new Error(
        'This record changed while you were editing. Close the form and open the latest version. Your changes were not saved.',
      );
    if (action === 'settle') {
      if (input.expectedLedgerRevision === undefined)
        throw new Error('Review the current settlement plan before confirming.');
      // This query is deliberately server-only. It is guarded by the ledger document
      // read above: every financial write must increment that revision under Rules.
      // A concurrent write aborts this transaction, including collection phantoms.
      const source = await getDocsFromServer(collection(db, 'ledgers', ledgerId, 'records'));
      if (source.metadata.hasPendingWrites)
        throw new Error('Some changes are still syncing. Review the updated settlement plan.');
      const net = balances(
        source.docs.map((d) => d.data() as FinancialRecord),
        Object.keys(ledger.data()!.members),
      );
      const currentPlan = settlements(net);
      if (
        !currentPlan.some(
          (s) =>
            s.payerId === data.payerId &&
            s.receiverId === data.receiverId &&
            s.amount === data.amount,
        )
      )
        throw new Error('Balances changed. Review the updated settlement plan before confirming.');
    }
    const version = expectedVersion + 1;
    const at = serverTimestamp();
    const record = {
      ledgerId,
      data,
      version,
      createdBy: existing?.createdBy || actorId,
      createdAt: existing?.createdAt || at,
      updatedBy: actorId,
      updatedAt: at,
      action,
    };
    tx.set(ref, record);
    tx.set(doc(db, 'ledgers', ledgerId, 'audit', `${id}_${version}`), {
      ledgerId,
      recordId: id,
      version,
      actorId,
      at,
      action,
      before: existing?.data || null,
      after: data,
    });
    tx.update(ledgerRef, { hasRecords: true, revision: increment(1) });
  });
}
export function newRecordId(db: Firestore, ledgerId: string): string {
  return doc(collection(db, 'ledgers', ledgerId, 'records')).id;
}
