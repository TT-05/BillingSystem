import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
async function openGoogle(page: Page, button = 'Continue with Google') {
  const popup = page.waitForEvent('popup');
  await page.getByRole('button', { name: button, exact: true }).click();
  const widget = await popup;
  await expect(widget).toHaveURL(/^http:\/\/127\.0\.0\.1:9099\/emulator\/auth\/handler/);
  await widget.waitForLoadState('domcontentloaded');
  return widget;
}
async function newGoogleAccount(widget: Page, email: string, name: string) {
  await widget.getByRole('button', { name: 'Add new account', exact: true }).click();
  await widget.locator('#email-input').fill(email);
  await widget.locator('#display-name-input').fill(name);
  await widget.locator('#sign-in').click();
}
async function passwordAccount(page: Page, email: string) {
  await page.goto('/');
  await page.getByRole('button', { name: 'New here? Create an account' }).click();
  await page.getByLabel('Display name', { exact: true }).fill('Existing owner');
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('OriginalPassword123!');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sharing starts with a space.' })).toBeVisible();
}
test('Google popup creates a real emulator profile and retains its ledger after signing in again', async ({
  page,
}) => {
  const email = `google-${Date.now()}@example.com`;
  await page.goto('/');
  await newGoogleAccount(await openGoogle(page), email, 'Google Friend');
  await expect(page.getByRole('button', { name: /Google Friend Account & profile/ })).toBeVisible();
  await page.getByRole('button', { name: 'Create your first ledger', exact: true }).click();
  await page.getByLabel('Ledger name', { exact: true }).fill('Google shared ledger');
  await page.getByRole('button', { name: 'Create ledger', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Selected ledger' })).not.toHaveValue('');
  const ledger = await page.getByRole('combobox', { name: 'Selected ledger' }).inputValue();
  await page.getByRole('button', { name: /Google Friend Account & profile/ }).click();
  await page.getByLabel('Display name', { exact: true }).fill('Chosen profile name');
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  const widget = await openGoogle(page);
  await widget.locator('[data-id-token]').filter({ hasText: email }).click();
  await expect(
    page.getByRole('button', { name: /Chosen profile name Account & profile/ }),
  ).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Selected ledger' })).toHaveValue(ledger);
  await page.getByRole('button', { name: /Chosen profile name Account & profile/ }).click();
  await expect(page.getByRole('button', { name: 'Google connected', exact: true })).toBeDisabled();
});
test('explicit linking keeps the password account and its existing ledger accessible through Google', async ({
  page,
}) => {
  const email = `linked-${Date.now()}@example.com`;
  await passwordAccount(page, email);
  await page.getByRole('button', { name: 'Create your first ledger', exact: true }).click();
  await page.getByLabel('Ledger name', { exact: true }).fill('Keep existing history');
  await page.getByRole('button', { name: 'Create ledger', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Selected ledger' })).not.toHaveValue('');
  const ledger = await page.getByRole('combobox', { name: 'Selected ledger' }).inputValue();
  await page.getByRole('button', { name: /Existing owner Account & profile/ }).click();
  await newGoogleAccount(await openGoogle(page, 'Link Google account'), email, 'Provider name');
  await expect(
    page.getByText(
      'Google connected. Both sign-in methods use the same account and ledger history.',
    ),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  const widget = await openGoogle(page);
  await widget.locator('[data-id-token]').filter({ hasText: email }).click();
  await expect(page.getByRole('combobox', { name: 'Selected ledger' })).toHaveValue(ledger);
  await expect(
    page.getByRole('button', { name: /Existing owner Account & profile/ }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('OriginalPassword123!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Selected ledger' })).toHaveValue(ledger);
});
test('closing a Google popup leaves email/password sign-in usable', async ({ page }) => {
  await page.goto('/');
  const widget = await openGoogle(page);
  await widget.close();
  await expect(page.getByRole('alert')).toContainText('cancelled');
  await expect(
    page.getByRole('button', { name: 'Continue with Google', exact: true }),
  ).toBeEnabled();
  await expect(page.getByLabel('Email address', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();
});
