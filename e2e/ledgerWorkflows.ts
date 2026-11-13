import zh from '../src/i18n/locales/zh-CN.json' with { type: 'json' };
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
export function ledgerWorkflows(language: 'en' | 'zh-CN') {
  const extras: Record<string, string> = {
    'View Sunday groceries': '查看 Sunday groceries',
    'Bob (you)': 'Bob （你）',
    'Alice (you)': 'Alice （你）',
    'Amount (CAD)': '金额 (CAD)',
    'Alice share': 'Alice 分摊金额',
    'Bob share': 'Bob 分摊金额',
    'Alice percentage': 'Alice 百分比',
    'Bob percentage': 'Bob 百分比',
    '2 active members · 5 historical members maximum': '2 位在册成员 · 历史成员最多 5 位',
    'expense · Version 3 · Deleted': '支出 · 版本 3 · 已删除',
    'expense · Version 4': '支出 · 版本 4',
    '-$60.00': '-CA$60.00',
    '-$40.00': '-CA$40.00',
    '+$60.00': '+CA$60.00',
    '+$15.00': '+CA$15.00',
    '+$235.00': '+CA$235.00',
    '+$255.00': '+CA$255.00',
    '$255.00': 'CA$255.00',
    '$235.00': 'CA$235.00',
    '$90.00': 'CA$90.00',
    '$120.00': 'CA$120.00',
    created: '创建了',
    edited: '编辑了',
    'confirmed payment for': '确认付款：',
  };
  const text = (value: string) =>
    language === 'en' ? value : (extras[value] ?? (zh as Record<string, string>)[value] ?? value);

  const project = 'demo-settle';
  const authUrl = 'http://127.0.0.1:9099';
  async function register(page: Page, name: string, email: string) {
    await page.addInitScript((selectedLanguage) => {
      if (!localStorage.getItem('settle-language'))
        localStorage.setItem('settle-language', selectedLanguage);
    }, language);
    await page.goto('/');
    await page.getByRole('button', { name: text('New here? Create an account') }).click();
    await page.getByLabel(text('Display name'), { exact: true }).fill(name);
    await page.getByLabel(text('Email address')).fill(email);
    await page.getByLabel(text('Password'), { exact: true }).fill('Roommates123!');
    await page.getByRole('button', { name: text('Create account'), exact: true }).click();
    await expect(
      page.getByRole('heading', { name: text('Sharing starts with a space.') }),
    ).toBeVisible();
  }
  async function verify(page: Page, email: string) {
    await expect
      .poll(async () => {
        const result = await fetch(`${authUrl}/emulator/v1/projects/${project}/oobCodes`);
        const data = (await result.json()) as {
          oobCodes: { email: string; oobCode: string; requestType: string }[];
        };
        return data.oobCodes.find((x) => x.email === email && x.requestType === 'VERIFY_EMAIL')
          ?.oobCode;
      })
      .toBeTruthy();
    const result = await fetch(`${authUrl}/emulator/v1/projects/${project}/oobCodes`);
    const data = (await result.json()) as {
      oobCodes: { email: string; oobCode: string; requestType: string }[];
    };
    const code = data.oobCodes.find(
      (x) => x.email === email && x.requestType === 'VERIFY_EMAIL',
    )!.oobCode;
    const confirmed = await fetch(
      `${authUrl}/identitytoolkit.googleapis.com/v1/accounts:update?key=demo-settle-key`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oobCode: code }),
      },
    );
    expect(confirmed.ok).toBeTruthy();
    await page.getByRole('button', { name: text('Refresh verification') }).click();
    await expect(
      page.getByText(text('Email verified. You can now accept invitations.')),
    ).toBeVisible();
  }
  test('two friends share, edit, repay, restore and see real-time audited balances', async ({
    page,
    browser,
  }) => {
    const suffix = Date.now();
    const alice = `alice${suffix}@example.com`,
      bob = `bob${suffix}@example.com`;
    await register(page, 'Alice', alice);
    await verify(page, alice);
    await page.getByRole('button', { name: text('Create your first ledger') }).click();
    await page.getByLabel(text('Ledger name'), { exact: true }).fill('The Maple House');
    await page.getByRole('button', { name: text('Create ledger'), exact: true }).click();
    await expect(
      page.getByRole('heading', { name: text('A little clarity, together.') }),
    ).toBeVisible();
    await expect(page.getByRole('combobox', { name: text('Selected ledger') })).toContainText(
      'The Maple House',
    );
    await page.getByRole('button', { name: text('Group settings'), exact: true }).click();
    await page.getByLabel(text('Their email address')).fill(bob);
    await page.getByRole('button', { name: text('Create invitation'), exact: true }).click();
    const invitationLink = await page
      .getByRole('textbox', { name: text('Invitation link'), exact: true })
      .inputValue();
    const context = await browser.newContext();
    const second = await context.newPage();
    await register(second, 'Bob', bob);
    await verify(second, bob);
    await second.goto(invitationLink);
    await second.getByRole('button', { name: text('Accept invitation'), exact: true }).click();
    await expect(second.getByRole('combobox', { name: text('Selected ledger') })).toContainText(
      'The Maple House',
    );
    await expect(
      page.getByText(text('2 active members · 5 historical members maximum')),
    ).toBeVisible();
    await page.getByRole('button', { name: text('Overview'), exact: true }).click();
    await page.getByRole('button', { name: text('Add expense'), exact: true }).click();
    await page.getByLabel(text('Description'), { exact: true }).fill('Sunday groceries');
    await page.getByLabel(text('Amount (CAD)'), { exact: true }).fill('90.00');
    const expenseDialog = page.getByRole('dialog');
    await expenseDialog
      .getByRole('combobox', { name: '语言 / Language' })
      .selectOption(language === 'en' ? 'zh-CN' : 'en');
    await expect(
      expenseDialog.getByLabel(language === 'en' ? '描述' : 'Description', { exact: true }),
    ).toHaveValue('Sunday groceries');
    await expect(
      expenseDialog.getByLabel(language === 'en' ? '金额 (CAD)' : 'Amount (CAD)', { exact: true }),
    ).toHaveValue('90.00');
    await expenseDialog.getByRole('combobox', { name: '语言 / Language' }).selectOption(language);

    await page.getByRole('button', { name: text('Save transaction'), exact: true }).click();
    await expect(page.getByText(text('Transaction saved and synchronized.'))).toBeVisible();
    await expect(second.getByRole('button', { name: /Sunday groceries/ }).first()).toBeVisible();
    await page.getByRole('button', { name: text('View Sunday groceries'), exact: true }).click();
    await page.getByRole('button', { name: text('Edit transaction'), exact: true }).click();
    await page.getByLabel(text('Amount (CAD)'), { exact: true }).fill('120.00');
    await page.getByRole('button', { name: text('Save changes'), exact: true }).click();
    await page.getByRole('button', { name: text('Close dialog'), exact: true }).click();
    await second.getByRole('button', { name: text('Balances & settlement'), exact: true }).click();
    await expect(
      second.locator('.member-balance').filter({ hasText: text('Bob (you)') }),
    ).toContainText(text('-$60.00'));
    await page.getByRole('button', { name: text('Balances & settlement'), exact: true }).click();
    await expect(page.getByRole('button', { name: text("I've Paid"), exact: true })).toHaveCount(0);
    await second.getByRole('button', { name: text("I've Paid"), exact: true }).click();
    await second.getByLabel(text('Amount (CAD)'), { exact: true }).fill('20');
    await second.getByRole('button', { name: text('Send for confirmation'), exact: true }).click();
    await expect(
      second.locator('.member-balance').filter({ hasText: text('Bob (you)') }),
    ).toContainText(text('-$60.00'));
    await page.getByRole('button', { name: text('Confirm Receipt'), exact: true }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: text('Confirm'), exact: true })
      .click();
    await expect(
      second.locator('.member-balance').filter({ hasText: text('Bob (you)') }),
    ).toContainText(text('-$40.00'));
    await second.getByRole('button', { name: text("I've Paid"), exact: true }).click();
    await second.getByRole('button', { name: text('Send for confirmation'), exact: true }).click();
    await page.getByRole('button', { name: text('Confirm Receipt'), exact: true }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: text('Confirm'), exact: true })
      .click();
    await expect(second.getByRole('heading', { name: text('All square.') })).toBeVisible();
    await expect(page.getByRole('heading', { name: text('All square.') })).toBeVisible();
    await page.getByRole('button', { name: text('Activity history'), exact: true }).click();
    await expect(page.locator('.timeline-event').filter({ hasText: text('edited') })).toContainText(
      text('$90.00'),
    );
    await expect(page.locator('.timeline-event').filter({ hasText: text('edited') })).toContainText(
      text('$120.00'),
    );
    await expect(page.getByText(text('confirmed payment for')).first()).toBeVisible();
    // Delete and restore an expense: existing repayments remain and balances update on the other browser.
    await page.getByRole('button', { name: text('Expenses'), exact: true }).click();
    await page.getByRole('button', { name: text('View Sunday groceries'), exact: true }).click();
    await page.getByRole('button', { name: text('Delete'), exact: true }).click();
    await page.getByRole('button', { name: text('Confirm'), exact: true }).click();
    await expect(
      page.getByText(text('expense · Version 3 · Deleted'), { exact: true }),
    ).toBeVisible();
    await expect(
      second.locator('.member-balance').filter({ hasText: text('Bob (you)') }),
    ).toContainText(text('+$60.00'));
    await page.getByRole('button', { name: text('Restore transaction'), exact: true }).click();
    await page.getByRole('button', { name: text('Confirm'), exact: true }).click();
    await expect(page.getByText(text('expense · Version 4'), { exact: true })).toBeVisible();
    await expect(second.getByRole('heading', { name: text('All square.') })).toBeVisible();
    await page.getByRole('button', { name: text('Close dialog'), exact: true }).click();
    // Restore a prior immutable version as a new operation.
    await page.getByRole('button', { name: text('Activity history'), exact: true }).click();
    await page
      .locator('.timeline-event')
      .filter({ hasText: text('created') })
      .filter({ hasText: text('Sunday groceries') })
      .getByRole('button', { name: text('Restore this version') })
      .click();
    await page.getByRole('button', { name: text('Confirm'), exact: true }).click();
    await expect(
      second.locator('.member-balance').filter({ hasText: text('Bob (you)') }),
    ).toContainText(text('+$15.00'));
    await page.getByRole('button', { name: text('Expenses'), exact: true }).click();
    await page
      .getByRole('textbox', { name: text('Search transactions') })
      .fill(text('Settlement payment'));
    await expect(page.locator('.transaction-button strong')).toHaveText([
      text('Settlement payment'),
      text('Settlement payment'),
    ]);
    await page.getByRole('textbox', { name: text('Search transactions') }).fill('');
    await page.getByRole('button', { name: text('Overview'), exact: true }).click();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: `/tmp/bills-overview-${language}.png`, fullPage: true });
    await second.setViewportSize({ width: 390, height: 844 });
    await expect(second.getByRole('heading', { name: text('Make things even.') })).toBeVisible();
    await second.screenshot({ path: `/tmp/bills-mobile-${language}.png`, fullPage: true });
    const layout = await second.evaluate(() => ({
      width: window.innerWidth,
      scroll: document.documentElement.scrollWidth,
      overflows: [...document.querySelectorAll('body *')]
        .filter((e) => e.getBoundingClientRect().right > window.innerWidth)
        .slice(0, 15)
        .map((e) => ({
          tag: e.tagName,
          class: e.className,
          right: e.getBoundingClientRect().right,
        })),
    }));
    expect(layout.scroll, JSON.stringify(layout)).toBeLessThanOrEqual(layout.width);
    // A third signed-in user cannot fetch this ledger or find it in the UI.
    const ledgerId = await page
      .getByRole('combobox', { name: text('Selected ledger') })
      .inputValue();
    const other = await browser.newContext();
    const stranger = await other.newPage();
    const outsiderEmail = `outsider${suffix}@example.com`;
    await register(stranger, 'Stranger', outsiderEmail);
    await expect(
      stranger.getByRole('combobox', { name: text('Selected ledger') }),
    ).not.toContainText('The Maple House');
    const signed = await fetch(
      `${authUrl}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-settle-key`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: outsiderEmail,
          password: 'Roommates123!',
          returnSecureToken: true,
        }),
      },
    );
    const identity = (await signed.json()) as { idToken: string };
    const denied = await fetch(
      `http://127.0.0.1:8080/v1/projects/${project}/databases/(default)/documents/ledgers/${ledgerId}`,
      { headers: { Authorization: `Bearer ${identity.idToken}` } },
    );
    expect(denied.status).toBe(403);
    await page.getByRole('button', { name: text('Sign out'), exact: true }).click();
    await expect(page.getByRole('heading', { name: text('Welcome back.') })).toBeVisible();
    await context.close();
    await other.close();
  });

  test('exact and percentage forms, excluded payer, loans, ledger isolation and offline state', async ({
    page,
    browser,
  }) => {
    const suffix = Date.now();
    const a = `split-a${suffix}@example.com`,
      b = `split-b${suffix}@example.com`;
    await register(page, 'Alice', a);
    await page.getByRole('button', { name: text('Create your first ledger') }).click();
    await page.getByLabel(text('Ledger name'), { exact: true }).fill('Shared apartment');
    await page.getByRole('button', { name: text('Create ledger'), exact: true }).click();
    await page.getByRole('button', { name: text('Group settings'), exact: true }).click();
    await page.getByLabel(text('Their email address')).fill(b);
    await page.getByRole('button', { name: text('Create invitation'), exact: true }).click();
    const link = await page
      .getByRole('textbox', { name: text('Invitation link'), exact: true })
      .inputValue();
    const ctx = await browser.newContext();
    const friend = await ctx.newPage();
    await register(friend, 'Bob', b);
    await verify(friend, b);
    await friend.goto(link);
    await friend.getByRole('button', { name: text('Accept invitation'), exact: true }).click();
    await expect(friend.getByRole('combobox', { name: text('Selected ledger') })).toContainText(
      'Shared apartment',
    );
    await page.getByRole('button', { name: text('Overview'), exact: true }).click();
    await page.getByRole('button', { name: text('Add expense'), exact: true }).click();
    await page.getByLabel(text('Description'), { exact: true }).fill('Exact groceries');
    await page.getByLabel(text('Amount (CAD)'), { exact: true }).fill('100');
    await page
      .getByRole('combobox', { name: text('Split method'), exact: true })
      .selectOption('exact');
    await page.getByLabel(text('Alice share'), { exact: true }).fill('40');
    await page.getByLabel(text('Bob share'), { exact: true }).fill('60');
    await page.getByRole('button', { name: text('Save transaction'), exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: text('Add expense'), exact: true }).click();
    await page.getByLabel(text('Description'), { exact: true }).fill('Percentage tickets');
    await page.getByLabel(text('Amount (CAD)'), { exact: true }).fill('100');
    await page
      .getByRole('combobox', { name: text('Split method'), exact: true })
      .selectOption('percentage');
    await page.getByLabel(text('Alice percentage'), { exact: true }).fill('25');
    await page.getByLabel(text('Bob percentage'), { exact: true }).fill('75');
    await page.getByRole('button', { name: text('Save transaction'), exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: text('Add expense'), exact: true }).click();
    await page.getByLabel(text('Description'), { exact: true }).fill('Only for Bob');
    await page.getByLabel(text('Amount (CAD)'), { exact: true }).fill('100');
    await page.getByRole('checkbox', { name: /Alice/ }).uncheck();
    await page.getByRole('button', { name: text('Save transaction'), exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: text('Balances & settlement'), exact: true }).click();
    await expect(
      page.locator('.member-balance').filter({ hasText: text('Alice (you)') }),
    ).toContainText(text('+$235.00'));
    await page.getByRole('button', { name: text('Record loan'), exact: true }).click();
    await page.getByLabel(text('Description'), { exact: true }).fill('Concert loan');
    await page.getByLabel(text('Amount (CAD)'), { exact: true }).fill('50');
    await page.getByRole('button', { name: text('Save transaction'), exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await friend.getByRole('button', { name: text('Balances & settlement'), exact: true }).click();
    await friend.getByRole('button', { name: text("I've Paid"), exact: true }).click();
    await friend.getByLabel(text('Amount (CAD)'), { exact: true }).fill('30');
    await friend.getByRole('button', { name: text('Send for confirmation'), exact: true }).click();
    await page.getByRole('button', { name: text('Confirm Receipt'), exact: true }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: text('Confirm'), exact: true })
      .click();
    await expect(
      page.locator('.member-balance').filter({ hasText: text('Alice (you)') }),
    ).toContainText(text('+$255.00'));
    const original = await page
      .getByRole('combobox', { name: text('Selected ledger') })
      .inputValue();
    await page.getByRole('button', { name: text('Create a ledger'), exact: true }).click();
    await page.getByLabel(text('Ledger name'), { exact: true }).fill('Weekend USD');
    await page
      .getByRole('combobox', { name: text('Ledger currency'), exact: true })
      .selectOption('USD');
    await page.getByRole('button', { name: text('Create ledger'), exact: true }).click();
    await expect(page.getByTestId('receivables')).toContainText(text('$0.00'));
    await expect(page.locator('.currency-chip')).toHaveText('USD');
    await page.getByRole('combobox', { name: text('Selected ledger') }).selectOption(original);
    await expect(page.getByTestId('receivables')).toContainText(text('$255.00'));
    await expect(page.getByTestId('payables')).toContainText(text('$0.00'));
    await expect(page.locator('.currency-chip')).toHaveText('CAD');
    await page.reload();
    await expect(page.getByTestId('receivables')).toContainText(text('$255.00'));
    await expect(page.getByTestId('payables')).toContainText(text('$0.00'));
    await page.context().setOffline(true);
    await expect(page.getByText(text('Offline · changes not saved'))).toBeVisible();
    await expect(
      page.getByRole('button', { name: text('Add expense'), exact: true }),
    ).toBeDisabled();
    await page.context().setOffline(false);
    await expect(
      page.getByRole('button', { name: text('Add expense'), exact: true }),
    ).toBeEnabled();
    await ctx.close();
  });

  test('profile, persistent login and password-reset flow with emulator email', async ({
    page,
  }) => {
    const email = `profile${Date.now()}@example.com`;
    await register(page, 'Original name', email);
    await page.getByRole('button', { name: new RegExp(text('Account & profile')) }).click();
    await page.getByLabel(text('Display name'), { exact: true }).fill('Updated name');
    await page.getByRole('button', { name: text('Save profile'), exact: true }).click();
    await expect(page.getByRole('button', { name: /Updated name/ })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: /Updated name/ })).toBeVisible();
    await page.getByRole('button', { name: text('Sign out'), exact: true }).click();
    await page.getByRole('button', { name: text('Forgot password?'), exact: true }).click();
    await page.getByLabel(text('Email address')).fill(email);
    await page.getByRole('button', { name: text('Send reset link'), exact: true }).click();
    await expect(
      page.getByText(text('If an account exists, a reset link has been sent. Check your inbox.')),
    ).toBeVisible();
    const response = await fetch(`${authUrl}/emulator/v1/projects/${project}/oobCodes`);
    const data = (await response.json()) as {
      oobCodes: { email: string; oobCode: string; requestType: string }[];
    };
    const code = data.oobCodes.find(
      (x) => x.email === email && x.requestType === 'PASSWORD_RESET',
    )!.oobCode;
    const reset = await fetch(
      `${authUrl}/identitytoolkit.googleapis.com/v1/accounts:resetPassword?key=demo-settle-key`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oobCode: code, newPassword: 'NewRoommates456!' }),
      },
    );
    expect(reset.ok).toBeTruthy();
    await page.getByRole('button', { name: text('Back to sign in'), exact: true }).click();
    await page.getByLabel(text('Password'), { exact: true }).fill('NewRoommates456!');
    await page.getByRole('button', { name: text('Sign in'), exact: true }).click();
    await expect(
      page.getByRole('heading', { name: text('Sharing starts with a space.') }),
    ).toBeVisible();
  });
}
