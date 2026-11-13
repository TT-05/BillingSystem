import { bindAuthLanguage } from '../src/i18n/authLanguage';
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import en from '../src/i18n/locales/en.json';
import zh from '../src/i18n/locales/zh-CN.json';
import i18n, { initialLanguage, t } from '../src/i18n';
import { financialText, ledgerDate, localDateISO, money, percent } from '../src/i18n/format';
import { invitationExpiresAt, INVITATION_LIFETIME_MS } from '../src/domain/invitations';
import { Timestamp } from 'firebase/firestore';
import {
  balances,
  splitEqual,
  splitExact,
  splitPercentage,
  settlements,
} from '../src/domain/finance';
import type { FinancialData, FinancialRecord, Invitation } from '../src/domain/types';
afterEach(async () => {
  await i18n.changeLanguage('zh-CN');
});
describe('complete bundled translations and language preferences', () => {
  it('defaults to Chinese for new/invalid/storage-blocked sessions without browser detection', () => {
    for (const value of [null, 'en-US', 'zh', 'invalid', 'zh-CN'])
      expect(initialLanguage({ getItem: () => value })).toBe('zh-CN');
    expect(initialLanguage({ getItem: () => 'en' })).toBe('en');
    expect(
      initialLanguage({
        getItem: () => {
          throw Error('blocked');
        },
      }),
    ).toBe('zh-CN');
    expect(initialLanguage()).toBe('zh-CN');
  });
  it('has matching nonempty keys and matching interpolation parameters for both languages', () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
    for (const [key, value] of Object.entries(en)) {
      const translated = (zh as Record<string, string>)[key];
      expect(translated, key).toBeTruthy();
      expect(translated.match(/\{\{[^}]+\}\}/g)?.sort() ?? [], key).toEqual(
        value.match(/\{\{[^}]+\}\}/g)?.sort() ?? [],
      );
    }
  });
  it('includes all literal translation calls in the interface', () => {
    // Dynamic keys are covered by the enum, audit-field, and validation checks below.
    const files = [
      'src/App.tsx',
      'src/components/Auth.tsx',
      'src/components/Dialog.tsx',
      'src/components/Profile.tsx',
      'src/components/GroupSettings.tsx',
      'src/components/InvitationDialog.tsx',
      'src/components/LedgerForm.tsx',
      'src/components/RecordForm.tsx',
      'src/components/Payments.tsx',
    ];
    for (const file of files)
      for (const match of readFileSync(file, 'utf8').matchAll(/\bt\(\s*'([^'\n]*)'\s*[,)]/g))
        expect(Object.hasOwn(en, match[1]), `${file}: ${match[1]}`).toBe(true);
  });
  it('switches static and dynamic messages immediately', async () => {
    expect(t('Sign in')).toBe('登录');
    await i18n.changeLanguage('en');
    expect(t('Sign in')).toBe('Sign in');
    expect(t('Loan to {{value0}}', { value0: '李 Alice' })).toBe('Loan to 李 Alice');
    await i18n.changeLanguage('zh-CN');
    expect(t('Loan to {{value0}}', { value0: '李 Alice' })).toBe('借款给 李 Alice');
  });
  it('updates Firebase email/OAuth locale with the selected UI language', async () => {
    const auth = { languageCode: null as string | null };
    const stop = bindAuthLanguage(auth);
    expect(auth.languageCode).toBe('zh-CN');
    await i18n.changeLanguage('en');
    expect(auth.languageCode).toBe('en');
    stop();
    await i18n.changeLanguage('zh-CN');
    expect(auth.languageCode).toBe('en');
  });
  it('formats dates, percentages and money without switching ledger currency or calendar day', async () => {
    const date = '2026-01-02';
    const local = new Date(2026, 0, 2, 23, 59);
    expect(localDateISO(local)).toBe(date);
    for (const language of ['zh-CN', 'en']) {
      await i18n.changeLanguage(language);
      for (const currency of ['CAD', 'USD', 'CNY'] as const)
        expect(money(123456, currency)).toBe(
          new Intl.NumberFormat(language === 'en' ? 'en-CA' : 'zh-CN', {
            style: 'currency',
            currency,
          }).format(1234.56),
        );
      expect(ledgerDate(date)).toContain('2026');
      expect(percent(1234)).toContain('12.34');
    }
  });
  it('localizes only system settlement copy while preserving user-entered content', async () => {
    const data = {
      description: 'Settlement payment',
      notes: 'Confirmed from settlement recommendation',
      settlementKey: 'settle_1',
    } as FinancialData;
    expect(financialText(data, 'description')).toBe('结算还款');
    expect(financialText({ ...data, settlementKey: '' }, 'description')).toBe('Settlement payment');
    expect(financialText({ ...data, notes: '我的 notes' }, 'notes')).toBe('我的 notes');
    await i18n.changeLanguage('en');
    expect(financialText(data, 'description')).toBe('Settlement payment');
  });
  it('covers every finance validation message without changing internal exceptions', () => {
    for (const match of readFileSync('src/domain/finance.ts', 'utf8').matchAll(
      /throw new Error\('([^']+)'\)/g,
    ))
      expect(Object.hasOwn(zh, match[1]), match[1]).toBe(true);
  });
  it('does not change minor-unit allocation, balances or settlement outcomes between locales', async () => {
    let expected: unknown;
    for (const language of ['zh-CN', 'en']) {
      await i18n.changeLanguage(language);
      const equal = splitEqual(10001, ['b', 'a', 'c']);
      const exact = splitExact(10001, { a: 3333, b: 3334, c: 3334 });
      const percentage = splitPercentage(10001, { a: 3333, b: 3333, c: 3334 });
      const net = balances(
        [
          {
            data: {
              kind: 'expense',
              deleted: false,
              amount: 10001,
              payerId: 'a',
              participants: ['a', 'b', 'c'],
              shares: equal,
            },
          } as FinancialRecord,
        ],
        ['a', 'b', 'c'],
      );
      const actual = { equal, exact, percentage, net, plan: settlements(net) };
      if (expected) expect(actual).toEqual(expected);
      else expected = actual;
      expect(Object.values(net).reduce((a, b) => a + b, 0)).toBe(0);
    }
  });
  it('derives new invitation expiry from server time and preserves legacy expiry', () => {
    const createdAt = Timestamp.fromMillis(100000);
    expect(invitationExpiresAt({ createdAt } as Invitation).toMillis()).toBe(
      100000 + INVITATION_LIFETIME_MS,
    );
    const expiresAt = Timestamp.fromMillis(200000);
    expect(invitationExpiresAt({ createdAt, expiresAt } as Invitation)).toBe(expiresAt);
  });
});
