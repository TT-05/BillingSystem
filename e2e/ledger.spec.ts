import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
const project = 'demo-settle';
const authUrl = 'http://127.0.0.1:9099';
async function register(page: Page, name: string, email: string) {
  await page.goto('/');
  await page.getByRole('button', { name: 'New here? Create an account' }).click();
  await page.getByLabel('Display name', { exact: true }).fill(name);
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('Roommates123!');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sharing starts with a space.' })).toBeVisible();
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
  await page.getByRole('button', { name: 'Refresh verification' }).click();
  await expect(page.getByText('Email verified. You can now accept invitations.')).toBeVisible();
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
  await page.getByRole('button', { name: 'Create your first ledger' }).click();
  await page.getByLabel('Ledger name', { exact: true }).fill('The Maple House');
  await page.getByRole('button', { name: 'Create ledger', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'A little clarity, together.' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Selected ledger' })).toContainText(
    'The Maple House',
  );
  await page.getByRole('button', { name: 'Group settings', exact: true }).click();
  await page.getByLabel('Their email address').fill(bob);
  await page.getByRole('button', { name: 'Create invitation', exact: true }).click();
  const invitationLink = await page
    .getByRole('textbox', { name: 'Invitation link', exact: true })
    .inputValue();
  const context = await browser.newContext();
  const second = await context.newPage();
  await register(second, 'Bob', bob);
  await verify(second, bob);
  await second.goto(invitationLink);
  await second.getByRole('button', { name: 'Accept invitation', exact: true }).click();
  await expect(second.getByRole('combobox', { name: 'Selected ledger' })).toContainText(
    'The Maple House',
  );
  await expect(page.getByText('2 active members · 5 historical members maximum')).toBeVisible();
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await page.getByRole('button', { name: 'Add expense', exact: true }).click();
  await page.getByLabel('Description', { exact: true }).fill('Sunday groceries');
  await page.getByLabel('Amount (CAD)', { exact: true }).fill('90.00');
  await page.getByRole('button', { name: 'Save transaction', exact: true }).click();
  await expect(page.getByText('Transaction saved and synchronized.')).toBeVisible();
  await expect(second.getByRole('button', { name: /Sunday groceries/ }).first()).toBeVisible();
  await page.getByRole('button', { name: 'View Sunday groceries', exact: true }).click();
  await page.getByRole('button', { name: 'Edit transaction', exact: true }).click();
  await page.getByLabel('Amount (CAD)', { exact: true }).fill('120.00');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await second.getByRole('button', { name: 'Balances & settlement', exact: true }).click();
  await expect(second.locator('.member-balance').filter({ hasText: 'Bob (you)' })).toContainText(
    '-$60.00',
  );
  await page.getByRole('button', { name: 'Balances & settlement', exact: true }).click();
  await page.getByRole('button', { name: 'Record repayment', exact: true }).click();
  await page.getByLabel('Description', { exact: true }).fill('Partial payback');
  await page.getByLabel('Amount (CAD)', { exact: true }).fill('20');
  await page.getByRole('combobox', { name: 'Paid by', exact: true }).selectOption({ label: 'Bob' });
  await page
    .getByRole('combobox', { name: 'Received by', exact: true })
    .selectOption({ label: 'Alice' });
  await page.getByRole('button', { name: 'Save transaction', exact: true }).click();
  await expect(second.locator('.member-balance').filter({ hasText: 'Bob (you)' })).toContainText(
    '-$40.00',
  );
  await page.getByRole('button', { name: 'Confirm paid', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(second.getByRole('heading', { name: 'All square.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'All square.' })).toBeVisible();
  await page.getByRole('button', { name: 'Activity history', exact: true }).click();
  await expect(page.locator('.timeline-event').filter({ hasText: 'edited' })).toContainText(
    '$90.00',
  );
  await expect(page.locator('.timeline-event').filter({ hasText: 'edited' })).toContainText(
    '$120.00',
  );
  await expect(page.getByText('confirmed payment for')).toBeVisible();
  // Delete and restore an expense: existing repayments remain and balances update on the other browser.
  await page.getByRole('button', { name: 'Expenses', exact: true }).click();
  await page.getByRole('button', { name: 'View Sunday groceries', exact: true }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByText('expense · Version 3 · Deleted', { exact: true })).toBeVisible();
  await expect(second.locator('.member-balance').filter({ hasText: 'Bob (you)' })).toContainText(
    '+$60.00',
  );
  await page.getByRole('button', { name: 'Restore transaction', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByText('expense · Version 4', { exact: true })).toBeVisible();
  await expect(second.getByRole('heading', { name: 'All square.' })).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  // Restore a prior immutable version as a new operation.
  await page.getByRole('button', { name: 'Activity history', exact: true }).click();
  await page
    .locator('.timeline-event')
    .filter({ hasText: 'created' })
    .filter({ hasText: 'Sunday groceries' })
    .getByRole('button', { name: 'Restore this version' })
    .click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(second.locator('.member-balance').filter({ hasText: 'Bob (you)' })).toContainText(
    '+$15.00',
  );
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: '/tmp/bills-overview.png', fullPage: true });
  await second.setViewportSize({ width: 390, height: 844 });
  await expect(second.getByRole('heading', { name: 'Make things even.' })).toBeVisible();
  await second.screenshot({ path: '/tmp/bills-mobile.png', fullPage: true });
  const layout = await second.evaluate(() => ({
    width: window.innerWidth,
    scroll: document.documentElement.scrollWidth,
    overflows: [...document.querySelectorAll('body *')]
      .filter((e) => e.getBoundingClientRect().right > window.innerWidth)
      .slice(0, 15)
      .map((e) => ({ tag: e.tagName, class: e.className, right: e.getBoundingClientRect().right })),
  }));
  expect(layout.scroll, JSON.stringify(layout)).toBeLessThanOrEqual(layout.width);
  // A third signed-in user cannot fetch this ledger or find it in the UI.
  const ledgerId = await page.getByRole('combobox', { name: 'Selected ledger' }).inputValue();
  const other = await browser.newContext();
  const stranger = await other.newPage();
  const outsiderEmail = `outsider${suffix}@example.com`;
  await register(stranger, 'Stranger', outsiderEmail);
  await expect(stranger.getByRole('combobox', { name: 'Selected ledger' })).not.toContainText(
    'The Maple House',
  );
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
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
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
  await page.getByRole('button', { name: 'Create your first ledger' }).click();
  await page.getByLabel('Ledger name', { exact: true }).fill('Shared apartment');
  await page.getByRole('button', { name: 'Create ledger', exact: true }).click();
  await page.getByRole('button', { name: 'Group settings', exact: true }).click();
  await page.getByLabel('Their email address').fill(b);
  await page.getByRole('button', { name: 'Create invitation', exact: true }).click();
  const link = await page
    .getByRole('textbox', { name: 'Invitation link', exact: true })
    .inputValue();
  const ctx = await browser.newContext();
  const friend = await ctx.newPage();
  await register(friend, 'Bob', b);
  await verify(friend, b);
  await friend.goto(link);
  await friend.getByRole('button', { name: 'Accept invitation', exact: true }).click();
  await expect(friend.getByRole('combobox', { name: 'Selected ledger' })).toContainText(
    'Shared apartment',
  );
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await page.getByRole('button', { name: 'Add expense', exact: true }).click();
  await page.getByLabel('Description', { exact: true }).fill('Exact groceries');
  await page.getByLabel('Amount (CAD)', { exact: true }).fill('100');
  await page.getByRole('combobox', { name: 'Split method', exact: true }).selectOption('exact');
  await page.getByLabel('Alice share', { exact: true }).fill('40');
  await page.getByLabel('Bob share', { exact: true }).fill('60');
  await page.getByRole('button', { name: 'Save transaction', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Add expense', exact: true }).click();
  await page.getByLabel('Description', { exact: true }).fill('Percentage tickets');
  await page.getByLabel('Amount (CAD)', { exact: true }).fill('100');
  await page
    .getByRole('combobox', { name: 'Split method', exact: true })
    .selectOption('percentage');
  await page.getByLabel('Alice percentage', { exact: true }).fill('25');
  await page.getByLabel('Bob percentage', { exact: true }).fill('75');
  await page.getByRole('button', { name: 'Save transaction', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Add expense', exact: true }).click();
  await page.getByLabel('Description', { exact: true }).fill('Only for Bob');
  await page.getByLabel('Amount (CAD)', { exact: true }).fill('100');
  await page.getByRole('checkbox', { name: /Alice/ }).uncheck();
  await page.getByRole('button', { name: 'Save transaction', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Balances & settlement', exact: true }).click();
  await expect(page.locator('.member-balance').filter({ hasText: 'Alice (you)' })).toContainText(
    '+$235.00',
  );
  await page.getByRole('button', { name: 'Record loan', exact: true }).click();
  await page.getByLabel('Description', { exact: true }).fill('Concert loan');
  await page.getByLabel('Amount (CAD)', { exact: true }).fill('50');
  await page.getByRole('button', { name: 'Save transaction', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Record repayment', exact: true }).click();
  await page.getByLabel('Description', { exact: true }).fill('Paid part back');
  await page.getByLabel('Amount (CAD)', { exact: true }).fill('30');
  await page.getByRole('combobox', { name: 'Paid by', exact: true }).selectOption({ label: 'Bob' });
  await page
    .getByRole('combobox', { name: 'Received by', exact: true })
    .selectOption({ label: 'Alice' });
  await page.getByRole('button', { name: 'Save transaction', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.member-balance').filter({ hasText: 'Alice (you)' })).toContainText(
    '+$255.00',
  );
  const original = await page.getByRole('combobox', { name: 'Selected ledger' }).inputValue();
  await page.getByRole('button', { name: 'Create a ledger', exact: true }).click();
  await page.getByLabel('Ledger name', { exact: true }).fill('Weekend USD');
  await page.getByRole('combobox', { name: 'Ledger currency', exact: true }).selectOption('USD');
  await page.getByRole('button', { name: 'Create ledger', exact: true }).click();
  await expect(page.locator('.personal-card')).toContainText('$0.00');
  await expect(page.locator('.currency-chip')).toHaveText('USD');
  await page.getByRole('combobox', { name: 'Selected ledger' }).selectOption(original);
  await expect(page.locator('.personal-card')).toContainText('$255.00');
  await expect(page.locator('.currency-chip')).toHaveText('CAD');
  await page.reload();
  await expect(page.locator('.personal-card')).toContainText('$255.00');
  await page.context().setOffline(true);
  await expect(page.getByText('Offline · changes not saved')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add expense', exact: true })).toBeDisabled();
  await page.context().setOffline(false);
  await expect(page.getByRole('button', { name: 'Add expense', exact: true })).toBeEnabled();
  await ctx.close();
});

test('profile, persistent login and password-reset flow with emulator email', async ({ page }) => {
  const email = `profile${Date.now()}@example.com`;
  await register(page, 'Original name', email);
  await page.getByRole('button', { name: /Account & profile/ }).click();
  await page.getByLabel('Display name', { exact: true }).fill('Updated name');
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(page.getByRole('button', { name: /Updated name/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: /Updated name/ })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByRole('button', { name: 'Forgot password?', exact: true }).click();
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'Send reset link', exact: true }).click();
  await expect(
    page.getByText('If an account exists, a reset link has been sent. Check your inbox.'),
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
  await page.getByRole('button', { name: 'Back to sign in', exact: true }).click();
  await page.getByLabel('Password', { exact: true }).fill('NewRoommates456!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sharing starts with a space.' })).toBeVisible();
});
