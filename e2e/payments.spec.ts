import { test, expect } from '@playwright/test';
import { googleUser, createAndInvite, expense, report, respond } from './paymentHelpers';
test('two Google users see correct summaries and receipt/reject/cancel/history, with stale and replay protection', async ({
  page,
  browser,
}) => {
  const ctx = await browser.newContext();
  const debtor = await ctx.newPage();
  const suffix = Date.now();
  const email = `payer-${suffix}@example.com`;
  await googleUser(page, `receiver-${suffix}@example.com`, 'Alice');
  await googleUser(debtor, email, 'Bob');
  await createAndInvite(page, debtor, email);
  await expect(page.getByTestId('receivables')).toContainText('$0.00');
  await expect(page.getByTestId('receivables')).toContainText('0 outstanding payments');
  await expect(page.getByTestId('payables')).toContainText('$0.00');
  await expense(page);
  await expect(page.getByTestId('receivables')).toContainText('$50.00');
  await expect(page.getByTestId('receivables')).toContainText('1 outstanding payment');
  await expect(debtor.getByTestId('payables')).toContainText('$50.00');
  await expect(debtor.getByTestId('receivables')).toContainText('$0.00');
  await page.getByRole('button', { name: 'Balances & settlement', exact: true }).click();
  await debtor.getByRole('button', { name: 'Balances & settlement', exact: true }).click();
  await expect(page.getByRole('button', { name: "I've Paid", exact: true })).toHaveCount(0);
  await report(debtor, '20');
  await expect(debtor.locator('.payment-request[data-status=pending]')).toContainText(
    'Pending confirmation',
  );
  await expect(debtor.getByRole('button', { name: 'Confirm Receipt', exact: true })).toHaveCount(0);
  await expect(debtor.getByRole('button', { name: "I've Paid", exact: true })).toBeDisabled();
  await expect(page.locator('.member-balance').filter({ hasText: 'Alice (you)' })).toContainText(
    '+$50.00',
  );
  await respond(page, 'Reject');
  await expect(debtor.locator('.payment-request[data-status=rejected]')).toHaveCount(1);
  await expect(page.locator('.member-balance').filter({ hasText: 'Alice (you)' })).toContainText(
    '+$50.00',
  );
  await report(debtor, '20');
  await respond(debtor, 'Cancel request');
  await expect(page.locator('.payment-request[data-status=cancelled]')).toHaveCount(1);
  await report(debtor, '20');
  await respond(page, 'Confirm Receipt');
  await expect(debtor.locator('.member-balance').filter({ hasText: 'Bob (you)' })).toContainText(
    '-$30.00',
  );
  await expect(debtor.locator('.payment-request[data-status=confirmed]')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Confirm Receipt', exact: true })).toHaveCount(0);
  await debtor
    .locator('.payment-request[data-status=confirmed]')
    .getByRole('button', { name: 'Payment history', exact: true })
    .click();
  await expect(debtor.getByRole('dialog')).toContainText('Pending confirmation');
  await expect(debtor.getByRole('dialog')).toContainText('Confirmed');
  await expect(debtor.getByRole('dialog')).toContainText('By Alice');
  await expect(debtor.getByRole('dialog')).toContainText('By Bob');
  await debtor.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('button', { name: 'Expenses', exact: true }).click();
  await page.getByRole('button', { name: 'View Settlement payment', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit transaction', exact: true })).toHaveCount(0);
  await expect(page.getByRole('dialog')).toContainText('Confirmed repayments are read-only');
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await report(debtor);
  await page.getByRole('button', { name: 'View Shared dinner / 晚餐', exact: true }).click();
  await page.getByRole('button', { name: 'Edit transaction', exact: true }).click();
  await page.getByLabel('Amount (CAD)', { exact: true }).fill('120');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('button', { name: 'Balances & settlement', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Confirm Receipt', exact: true })).toBeDisabled();
  await expect(debtor.locator('.payment-request[data-status=pending]')).toContainText(
    'Balances changed',
  );
  await respond(debtor, 'Cancel request');
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(page.getByTestId('receivables')).toContainText('$40.00');
  await page.getByRole('combobox', { name: '语言 / Language' }).selectOption('zh-CN');
  await expect(page.getByTestId('receivables')).toContainText('待收款');
  await expect(page.getByTestId('payables')).toContainText('待付款');
  await expect(page.locator('.payment-request[data-status=confirmed]')).toContainText('已确认');
  await page.reload();
  await expect(page.getByTestId('receivables')).toContainText('CA$40.00');
  await ctx.close();
});

test('a blocked desktop Google popup falls back to a complete redirect sign-in', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.open = () => null;
  });
  await googleUser(page, `blocked-popup-${Date.now()}@example.com`, 'Fallback Friend', true);
  await expect(
    page.getByRole('button', { name: /Fallback Friend Account & profile/ }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('button', { name: /Fallback Friend Account & profile/ }),
  ).toBeVisible();
});
