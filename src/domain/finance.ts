import type { Currency, FinancialData, FinancialRecord, Settlement, SplitMethod } from './types';
export const MAX_AMOUNT = 1_000_000_000; // 10 million currency units; products with basis points are safe integers.
export function amount(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_AMOUNT)
    throw new Error('Enter a positive amount, up to 10,000,000.00.');
  return value;
}
export function parseMoney(text: string, allowZero = false): number {
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(text.trim()))
    throw new Error('Use a positive amount with at most two decimal places.');
  const [whole, fraction = ''] = text.trim().split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return allowZero && cents === 0 ? 0 : amount(cents);
}
export function parsePercent(text: string): number {
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(text.trim()))
    throw new Error('Percentages need at most two decimal places.');
  const [whole, fraction = ''] = text.trim().split('.');
  const n = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (n > 10000) throw new Error('Each percentage must be between 0 and 100.');
  return n;
}
function idsOf(ids: string[]): string[] {
  if (ids.length < 1 || ids.length > 5 || new Set(ids).size !== ids.length || ids.some((x) => !x))
    throw new Error('Select 1–5 different participants.');
  return [...ids].sort();
}
export function splitEqual(total: number, ids: string[]): Record<string, number> {
  amount(total);
  const sorted = idsOf(ids);
  const base = Math.floor(total / sorted.length);
  const remainder = total % sorted.length;
  return Object.fromEntries(sorted.map((uid, i) => [uid, base + (i < remainder ? 1 : 0)]));
}
export function splitExact(total: number, values: Record<string, number>): Record<string, number> {
  amount(total);
  const ids = idsOf(Object.keys(values));
  if (
    ids.some((id) => !Number.isSafeInteger(values[id]) || values[id] < 0) ||
    ids.reduce((s, id) => s + values[id], 0) !== total
  )
    throw new Error('Exact shares must add up to the expense amount.');
  return Object.fromEntries(ids.map((id) => [id, values[id]]));
}
export function splitPercentage(
  total: number,
  bps: Record<string, number>,
): Record<string, number> {
  amount(total);
  const ids = idsOf(Object.keys(bps));
  if (
    ids.some((id) => !Number.isSafeInteger(bps[id]) || bps[id] < 0) ||
    ids.reduce((s, id) => s + bps[id], 0) !== 10000
  )
    throw new Error('Percentages must add up to 100%.');
  const shares = Object.fromEntries(ids.map((id) => [id, Math.floor((total * bps[id]) / 10000)]));
  const remainder = total - Object.values(shares).reduce((sum, value) => sum + value, 0);
  shares[ids[ids.length - 1]] += remainder;
  return shares;
}
export function split(
  total: number,
  ids: string[],
  method: SplitMethod,
  weights: Record<string, number>,
): Record<string, number> {
  return method === 'equal'
    ? splitEqual(total, ids)
    : method === 'exact'
      ? splitExact(total, weights)
      : splitPercentage(total, weights);
}
export function balances(
  records: Pick<FinancialRecord, 'data'>[],
  memberIds: string[],
): Record<string, number> {
  const result = Object.fromEntries(memberIds.map((id) => [id, 0]));
  const add = (id: string, delta: number) => {
    if (!(id in result)) throw new Error('Unknown member in financial record.');
    result[id] += delta;
    if (!Number.isSafeInteger(result[id])) throw new Error('Balance exceeds safe integer range.');
  };
  for (const { data: d } of records) {
    if (d.deleted) continue;
    amount(d.amount);
    if (d.kind === 'expense') {
      splitExact(d.amount, d.shares);
      add(d.payerId, d.amount);
      Object.entries(d.shares).forEach(([uid, share]) => add(uid, -share));
    } else if (d.kind === 'loan') {
      add(d.payerId, d.amount);
      add(d.receiverId, -d.amount);
    } else {
      add(d.payerId, d.amount);
      add(d.receiverId, -d.amount);
    }
  }
  if (Object.values(result).reduce((a, b) => a + b, 0) !== 0)
    throw new Error('Ledger does not reconcile.');
  return result;
}
// A loan: payer lends to receiver. A repayment: payer owes money and pays receiver.
// Both movements increase payer's net balance. No new expense is created.
export function settlements(net: Record<string, number>): Settlement[] {
  if (
    Object.values(net).some((v) => !Number.isSafeInteger(v)) ||
    Object.values(net).reduce((a, b) => a + b, 0) !== 0
  )
    throw new Error('Balances must reconcile to zero.');
  const order = (a: [string, number], b: [string, number]) =>
    b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  const creditors = Object.entries(net)
    .filter(([, v]) => v > 0)
    .sort(order);
  const debtors = Object.entries(net)
    .filter(([, v]) => v < 0)
    .map(([id, v]): [string, number] => [id, -v])
    .sort(order);
  const result: Settlement[] = [];
  let i = 0,
    j = 0;
  while (i < debtors.length && j < creditors.length) {
    const n = Math.min(debtors[i][1], creditors[j][1]);
    result.push({ payerId: debtors[i][0], receiverId: creditors[j][0], amount: n });
    debtors[i][1] -= n;
    creditors[j][1] -= n;
    if (!debtors[i][1]) i++;
    if (!creditors[j][1]) j++;
  }
  return result;
}
export function money(cents: number, currency: Currency): string {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
  }).format(cents / 100);
}
export function inputMoney(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}
export function changedFields(before: FinancialData | null, after: FinancialData): string[] {
  return Object.keys(after).filter(
    (k) =>
      canonical(before?.[k as keyof FinancialData]) !== canonical(after[k as keyof FinancialData]),
  );
}

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, v]) => JSON.stringify(key) + ':' + canonical(v))
        .join(',') +
      '}'
    );
  return JSON.stringify(value) ?? 'null';
}
