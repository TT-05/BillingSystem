import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
export async function googleUser(page: Page, email: string, name: string, redirect = false) {
  await page.addInitScript(() => {
    if (!localStorage.getItem('settle-language')) localStorage.setItem('settle-language', 'en');
  });
  await page.goto('/');
  const popup = redirect ? null : page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Continue with Google', exact: true }).click();
  const widget = popup ? await popup : page;
  await expect(widget).toHaveURL(/^http:\/\/127\.0\.0\.1:5173\/emulator\/auth\/handler/);
  await widget.waitForLoadState('domcontentloaded');
  await widget.getByRole('button', { name: 'Add new account', exact: true }).click();
  await widget.locator('#email-input').fill(email);
  await widget.locator('#display-name-input').fill(name);
  await widget.locator('#sign-in').click();
  await expect(page.getByRole('heading', { name: 'Sharing starts with a space.' })).toBeVisible();
}
export async function createAndInvite(owner: Page, debtor: Page, email: string) {
  await owner.getByRole('button', { name: 'Create your first ledger', exact: true }).click();
  await owner.getByLabel('Ledger name', { exact: true }).fill('Shared payment ledger');
  await owner.getByRole('button', { name: 'Create ledger', exact: true }).click();
  await owner.getByRole('button', { name: 'Group settings', exact: true }).click();
  await owner.getByLabel('Their email address').fill(email);
  await owner.getByRole('button', { name: 'Create invitation', exact: true }).click();
  const link = await owner
    .getByRole('textbox', { name: 'Invitation link', exact: true })
    .inputValue();
  await debtor.goto(link);
  await debtor.getByRole('button', { name: 'Accept invitation', exact: true }).click();
  await expect(debtor.getByRole('combobox', { name: 'Selected ledger' })).toContainText(
    'Shared payment ledger',
  );
  await owner.getByRole('button', { name: 'Overview', exact: true }).click();
}
export async function expense(owner: Page, total = '100') {
  await owner.getByRole('button', { name: 'Add expense', exact: true }).click();
  await owner.getByLabel('Description', { exact: true }).fill('Shared dinner / 晚餐');
  await owner.getByLabel('Amount (CAD)', { exact: true }).fill(total);
  await owner.getByRole('button', { name: 'Save transaction', exact: true }).click();
  await expect(owner.getByRole('dialog')).toHaveCount(0);
}
export async function report(debtor: Page, total?: string) {
  await debtor.getByRole('button', { name: "I've Paid", exact: true }).click();
  if (total) await debtor.getByLabel('Amount (CAD)', { exact: true }).fill(total);
  await debtor.getByRole('button', { name: 'Send for confirmation', exact: true }).click();
  await expect(debtor.getByRole('dialog')).toHaveCount(0);
}
export async function respond(page: Page, action: 'Confirm Receipt' | 'Reject' | 'Cancel request') {
  await page.getByRole('button', { name: action, exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
