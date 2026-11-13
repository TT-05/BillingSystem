import type { Settlement } from './types';
// The plan is already netted by the unchanged settlement algorithm. Count its
// distinct transfers, never expense records or gross bilateral debts.
export function settlementSummary(plan: Settlement[], uid: string) {
  const receivables = { amount: 0, count: 0 };
  const payables = { amount: 0, count: 0 };
  const seen = new Set<string>();
  for (const transfer of plan) {
    const key = JSON.stringify([transfer.payerId, transfer.receiverId]);
    if (seen.has(key)) continue;
    seen.add(key);
    const bucket =
      transfer.receiverId === uid ? receivables : transfer.payerId === uid ? payables : null;
    if (bucket) {
      bucket.amount += transfer.amount;
      bucket.count++;
    }
  }
  return { receivables, payables };
}
