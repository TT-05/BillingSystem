import { describe, expect, it } from 'vitest';
import { balances, settlements } from '../src/domain/finance';
import { settlementSummary } from '../src/domain/settlementSummary';
import type { FinancialRecord } from '../src/domain/types';
describe('net recommendation receivables and payables', () => {
  it('shows zero amount and zero count for no debt', () => {
    expect(settlementSummary([], 'a')).toEqual({
      receivables: { amount: 0, count: 0 },
      payables: { amount: 0, count: 0 },
    });
  });
  it('counts distinct transfers rather than expense rows', () => {
    const plan = settlements({ a: 9000, b: -4000, c: -5000, d: 0 });
    expect(settlementSummary(plan, 'a')).toEqual({
      receivables: { amount: 9000, count: 2 },
      payables: { amount: 0, count: 0 },
    });
    expect(settlementSummary(plan, 'b').payables).toEqual({ amount: 4000, count: 1 });
    expect(settlementSummary(plan, 'd').receivables.count).toBe(0);
  });
  it('does not count offsetting debts before netting', () => {
    const record = (payerId: string, receiverId: string, amount: number) =>
      ({ data: { kind: 'loan', payerId, receiverId, amount, deleted: false } }) as FinancialRecord;
    const net = balances(
      [
        record('a', 'b', 10000),
        record('b', 'a', 7000),
        record('a', 'b', 1000),
        record('b', 'a', 4000),
      ],
      ['a', 'b'],
    );
    expect(settlementSummary(settlements(net), 'a')).toEqual({
      receivables: { amount: 0, count: 0 },
      payables: { amount: 0, count: 0 },
    });
  });
  it('deduplicates a repeated recommended pair', () => {
    const s = { payerId: 'b', receiverId: 'a', amount: 1100 };
    expect(settlementSummary([s, s], 'a').receivables).toEqual({ amount: 1100, count: 1 });
  });
  it('conserves totals and transfer counts over five members', () => {
    for (let n = 1; n < 200; n++) {
      const plan = settlements({ a: n * 100, b: -n * 35, c: -n * 45, d: n * 20, e: -n * 40 });
      const summaries = ['a', 'b', 'c', 'd', 'e'].map((uid) => settlementSummary(plan, uid));
      expect(summaries.reduce((s, x) => s + x.receivables.amount, 0)).toBe(
        summaries.reduce((s, x) => s + x.payables.amount, 0),
      );
      expect(summaries.reduce((s, x) => s + x.receivables.count, 0)).toBe(plan.length);
      expect(summaries.reduce((s, x) => s + x.payables.count, 0)).toBe(plan.length);
    }
  });
});
