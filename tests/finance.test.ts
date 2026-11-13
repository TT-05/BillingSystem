import { describe, expect, it } from 'vitest';
import {
  balances,
  canonical,
  changedFields,
  MAX_AMOUNT,
  parseMoney,
  parsePercent,
  settlements,
  splitEqual,
  splitExact,
  splitPercentage,
} from '../src/domain/finance';
import type { FinancialData } from '../src/domain/types';
function expense(amount: number, payerId: string, ids: string[]): { data: FinancialData } {
  return {
    data: {
      kind: 'expense',
      description: 'Test',
      amount,
      currency: 'CAD',
      date: '2026-11-11',
      payerId,
      receiverId: '',
      participants: ids,
      shares: splitEqual(amount, ids),
      weights: Object.fromEntries(ids.map((id) => [id, 1])),
      splitMethod: 'equal',
      notes: '',
      deleted: false,
      settlementKey: '',
    },
  };
}
function transfer(kind: 'loan' | 'repayment', payerId: string, receiverId: string, amount: number) {
  return {
    data: {
      ...expense(amount, payerId, [receiverId]).data,
      kind,
      receiverId,
      participants: [],
      shares: {},
      weights: {},
    },
  };
}
describe('integer money and splits', () => {
  it('parses each supported two-decimal currency without float math', () => {
    expect(parseMoney('100.01')).toBe(10001);
    expect(parseMoney('0.1')).toBe(10);
    expect(parseMoney('10000000')).toBe(MAX_AMOUNT);
  });
  it.each([
    '',
    '0',
    '-1',
    '1.001',
    '1e3',
    'NaN',
    'Infinity',
    '10000000.01',
    '999999999999',
    '0x10',
  ])('rejects invalid money %s', (v) => expect(() => parseMoney(v)).toThrow());
  it('splits equally, allocating remainder to sorted UIDs', () => {
    expect(splitEqual(100, ['c', 'a', 'b'])).toEqual({ a: 34, b: 33, c: 33 });
    expect(splitEqual(1, ['b', 'a'])).toEqual({ a: 1, b: 0 });
  });
  it('supports exact unequal amounts and zero shares', () => {
    expect(splitExact(10000, { b: 6000, c: 4000 })).toEqual({ b: 6000, c: 4000 });
    expect(splitExact(1, { a: 0, b: 1 })).toEqual({ a: 0, b: 1 });
  });
  it('rejects invalid exact splits', () => {
    expect(() => splitExact(100, { a: 99 })).toThrow();
    expect(() => splitExact(100, { a: 100.5, b: -0.5 })).toThrow();
    expect(() => splitEqual(100, [])).toThrow();
    expect(() => splitEqual(100, ['a', 'a'])).toThrow();
  });
  it('floors percentage shares and assigns remainder to the final sorted UID', () => {
    expect(parsePercent('33.33')).toBe(3333);
    expect(splitPercentage(100, { a: 3333, b: 3333, c: 3334 })).toEqual({ a: 33, b: 33, c: 34 });
    expect(splitPercentage(1, { a: 5000, b: 5000 })).toEqual({ a: 0, b: 1 });
  });
  it('rejects invalid percentages', () => {
    expect(() => splitPercentage(100, { a: 9999 })).toThrow();
    expect(() => parsePercent('100.01')).toThrow();
    expect(() => parsePercent('1.111')).toThrow();
  });
  it('conserves cents for large amounts and every remainder', () => {
    for (let n = 1; n <= 5; n++) {
      const ids = Array.from({ length: n }, (_, i) => String(i));
      for (let total = 1; total < 200; total++)
        expect(Object.values(splitEqual(total, ids)).reduce((a, b) => a + b, 0)).toBe(total);
    }
    expect(
      Object.values(splitPercentage(MAX_AMOUNT, { a: 3333, b: 6667 })).reduce((a, b) => a + b, 0),
    ).toBe(MAX_AMOUNT);
  });
});
describe('ledger accounting', () => {
  it('handles excluded payer', () =>
    expect(balances([expense(10000, 'a', ['b'])], ['a', 'b'])).toEqual({ a: 10000, b: -10000 }));
  it('matches the three-person shared expense example', () => {
    const net = balances(
      [
        expense(12000, 'a', ['a', 'b', 'c']),
        expense(9000, 'b', ['a', 'b', 'c']),
        expense(6000, 'c', ['a', 'b', 'c']),
      ],
      ['a', 'b', 'c'],
    );
    expect(net).toEqual({ a: 3000, b: 0, c: -3000 });
    expect(settlements(net)).toEqual([{ payerId: 'c', receiverId: 'a', amount: 3000 }]);
  });
  it('offsets debt cycles', () => {
    const net = balances(
      [expense(5000, 'a', ['b']), expense(3000, 'b', ['c']), expense(2000, 'c', ['a'])],
      ['a', 'b', 'c'],
    );
    expect(net).toEqual({ a: 3000, b: -2000, c: -1000 });
    expect(settlements(net)).toEqual([
      { payerId: 'b', receiverId: 'a', amount: 2000 },
      { payerId: 'c', receiverId: 'a', amount: 1000 },
    ]);
  });
  it('accounts for direct loans and partial and multiple repayments', () => {
    const loan = transfer('loan', 'a', 'b', 10000);
    expect(balances([loan, transfer('repayment', 'b', 'a', 3000)], ['a', 'b'])).toEqual({
      a: 7000,
      b: -7000,
    });
    expect(
      balances(
        [loan, transfer('repayment', 'b', 'a', 3000), transfer('repayment', 'b', 'a', 7000)],
        ['a', 'b'],
      ),
    ).toEqual({ a: 0, b: 0 });
  });
  it('recalculates edits, deletes, restores and repayment corrections', () => {
    const old = expense(9000, 'a', ['a', 'b', 'c']);
    expect(balances([old], ['a', 'b', 'c']).a).toBe(6000);
    const edited = expense(12000, 'a', ['a', 'b', 'c']);
    expect(balances([edited], ['a', 'b', 'c']).a).toBe(8000);
    expect(balances([{ data: { ...edited.data, deleted: true } }], ['a', 'b', 'c']).a).toBe(0);
    expect(balances([old], ['a', 'b', 'c']).a).toBe(6000);
    const corrected = transfer('repayment', 'b', 'a', 1000);
    expect(balances([old, corrected], ['a', 'b', 'c'])).toEqual({ a: 5000, b: -2000, c: -3000 });
  });
  it('handles zero balances deterministically', () => {
    expect(settlements({ a: 0, b: 0 })).toEqual([]);
    expect(balances([], ['a', 'b'])).toEqual({ a: 0, b: 0 });
    expect(settlements({ z: 100, a: 100, b: -100, c: -100 })).toEqual([
      { payerId: 'b', receiverId: 'a', amount: 100 },
      { payerId: 'c', receiverId: 'z', amount: 100 },
    ]);
  });
  it('every recommended plan reconciles the source balances', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const net = { a: seed * 123, b: -seed * 83, c: -seed * 40 };
      const result = { ...net };
      for (const s of settlements(net)) {
        result[s.payerId as keyof typeof result] += s.amount;
        result[s.receiverId as keyof typeof result] -= s.amount;
      }
      expect(Object.values(result)).toEqual([0, 0, 0]);
    }
  });
  it('rejects invalid or cross-ledger source data', () => {
    expect(() => settlements({ a: 1 })).toThrow();
    expect(() => balances([expense(100, 'unknown', ['a'])], ['a'])).toThrow();
    expect(() => splitEqual(1.5, ['a'])).toThrow();
  });
});

describe('submission identity and precision boundaries', () => {
  it('compares Firestore maps independent of key insertion order', () => {
    expect(canonical({ b: { y: 1, x: 2 }, a: [3, 4] })).toBe(
      canonical({ a: [3, 4], b: { x: 2, y: 1 } }),
    );
    expect(canonical({ a: [3, 4] })).not.toBe(canonical({ a: [4, 3] }));
  });
  it('allows explicit zero shares but never malformed zero input', () => {
    expect(parseMoney('0.0', true)).toBe(0);
    expect(() => parseMoney('0e3', true)).toThrow();
    expect(() => parseMoney('0.000', true)).toThrow();
  });
  it('allocates percentage remainder once for a five-person tiny expense', () => {
    const result = splitPercentage(3, { e: 2000, d: 2000, c: 2000, b: 2000, a: 2000 });
    expect(result).toEqual({ a: 0, b: 0, c: 0, d: 0, e: 3 });
    expect(Object.values(result).reduce((a, b) => a + b, 0)).toBe(3);
  });
  it('rejects a split larger than the supported five-member boundary', () =>
    expect(() => splitEqual(100, ['a', 'b', 'c', 'd', 'e', 'f'])).toThrow());
});

it('highlights actual changes without treating map insertion order as an edit', () => {
  const before = expense(100, 'a', ['a', 'b']).data;
  const after = { ...before, shares: { b: 50, a: 50 }, notes: 'A note' };
  expect(changedFields(before, after)).toEqual(['notes']);
});
