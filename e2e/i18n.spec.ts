import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

test('Chinese defaults independently of browser language; switching preserves form state and survives refresh and reopening', async ({
  browser,
}) => {
  const context = await browser.newContext({ locale: 'en-US' });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(page.getByRole('heading', { name: '欢迎回来。' })).toBeVisible();
  await page.getByLabel('邮箱地址', { exact: true }).fill('retain@example.com');
  const started = await page.evaluate(() => performance.timeOrigin);
  await page.getByRole('combobox', { name: '语言 / Language' }).selectOption('en');
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
  await expect(page.getByLabel('Email address', { exact: true })).toHaveValue('retain@example.com');
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(started);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
  const state = await context.storageState();
  await context.close();
  const reopened = await browser.newContext({ locale: 'zh-CN', storageState: state });
  const next = await reopened.newPage();
  await next.goto('/');
  await expect(next.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
  await next.getByRole('combobox', { name: '语言 / Language' }).selectOption('zh-CN');
  await next.reload();
  await expect(next.getByRole('heading', { name: '欢迎回来。' })).toBeVisible();
  await reopened.close();
});

test('registration, reset, Google cancellation and browser validation use the selected language', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  expect(
    await page
      .getByLabel('邮箱地址', { exact: true })
      .evaluate((el: HTMLInputElement) => el.validationMessage),
  ).toBe('此项为必填项。');
  await page.getByRole('button', { name: '还没有账户？注册' }).click();
  await expect(page.getByLabel('显示名称', { exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: '语言 / Language' }).selectOption('en');
  await expect(page.getByRole('heading', { name: 'Make yourself at home.' })).toBeVisible();
  await page.getByRole('button', { name: 'Already have an account? Sign in' }).click();
  await page.getByRole('button', { name: 'Forgot password?' }).click();
  await expect(page.getByRole('button', { name: 'Send reset link' })).toBeVisible();
  await page.getByRole('combobox', { name: '语言 / Language' }).selectOption('zh-CN');
  await expect(page.getByRole('button', { name: '发送重置链接' })).toBeVisible();
  await page.getByRole('button', { name: '返回登录' }).click();
  const promise = page.waitForEvent('popup');
  await page.getByRole('button', { name: '使用 Google 登录' }).click();
  const popup = await promise;
  await popup.waitForLoadState('domcontentloaded');
  await popup.close();
  await expect(page.getByRole('alert')).toContainText('Google 登录已取消');
  await page.getByRole('combobox', { name: '语言 / Language' }).selectOption('en');
  await expect(page.getByRole('alert')).toContainText('Google sign-in was cancelled');
});
async function google(page: Page, email: string, name: string, language: 'en' | 'zh-CN') {
  await page.goto('/');
  await page.getByRole('combobox', { name: '语言 / Language' }).selectOption(language);
  const promise = page.waitForEvent('popup');
  await page
    .getByRole('button', {
      name: language === 'en' ? 'Continue with Google' : '使用 Google 登录',
      exact: true,
    })
    .click();
  const widget = await promise;
  await widget.waitForLoadState('domcontentloaded');
  await widget.getByRole('button', { name: 'Add new account', exact: true }).click();
  await widget.locator('#email-input').fill(email);
  await widget.locator('#display-name-input').fill(name);
  await widget.locator('#sign-in').click();
  await expect(page.getByRole('button', { name: new RegExp(name + ' ') })).toBeVisible();
}
for (const language of ['zh-CN', 'en'] as const) {
  test(`two existing Google users create and accept a private single-use invitation (${language})`, async ({
    page,
    browser,
  }) => {
    const english = language === 'en';
    const label = (en: string, zh: string) => (english ? en : zh);
    const context = await browser.newContext();
    const friend = await context.newPage();
    const suffix = Date.now();
    const email = `invited-${suffix}@example.com`;
    await google(friend, email, 'Google Friend', language);
    await google(page, `owner-${suffix}@example.com`, 'Google Owner', language);
    await page
      .getByRole('button', {
        name: label('Create your first ledger', '创建第一个账本'),
        exact: true,
      })
      .click();
    await page
      .getByLabel(label('Ledger name', '账本名称'), { exact: true })
      .fill('Invitation ledger / 邀请账本');
    await page
      .getByRole('button', { name: label('Create ledger', '创建账本'), exact: true })
      .click();
    await page
      .getByRole('button', { name: label('Group settings', '账本设置'), exact: true })
      .click();
    // Reproduce the production-sensitive condition in a real browser; the fixed
    // implementation must not use this client clock to authorize creation.
    await page.evaluate(() => {
      const original = Date.now;
      Date.now = () => original() + 60000;
    });
    await page.getByLabel(label('Their email address', '受邀人的邮箱')).fill(email.toUpperCase());
    await page
      .getByRole('button', { name: label('Create invitation', '创建邀请'), exact: true })
      .click();
    const link = await page
      .getByRole('textbox', { name: label('Invitation link', '邀请链接'), exact: true })
      .inputValue();
    await friend.goto(link);
    await friend
      .getByRole('button', { name: label('Accept invitation', '接受邀请'), exact: true })
      .click();
    await expect(
      friend.getByRole('combobox', { name: label('Selected ledger', '当前账本') }),
    ).toContainText('Invitation ledger / 邀请账本');
    await expect(page.getByText(label('Accepted', '已接受'), { exact: true })).toBeVisible();
    await friend
      .getByRole('button', { name: label('Group settings', '账本设置'), exact: true })
      .click();
    await expect(
      friend.getByRole('button', { name: label('Create invitation', '创建邀请'), exact: true }),
    ).toHaveCount(0);
    await friend.goto(link);
    await expect(friend.getByRole('dialog')).toContainText(label('already used', '已使用'));
    await expect(
      friend.getByRole('button', { name: label('Accept invitation', '接受邀请'), exact: true }),
    ).toBeDisabled();
    await friend.getByRole('button', { name: label('Close', '关闭'), exact: true }).click();
    await page.getByLabel(label('Their email address', '受邀人的邮箱')).fill(email);
    await page
      .getByRole('button', { name: label('Create invitation', '创建邀请'), exact: true })
      .click();
    await expect(
      page.getByRole('textbox', { name: label('Invitation link', '邀请链接'), exact: true }),
    ).not.toHaveValue(link);
    const revoked = await page
      .getByRole('textbox', { name: label('Invitation link', '邀请链接'), exact: true })
      .inputValue();
    await page.getByRole('button', { name: label('Revoke', '撤销'), exact: true }).click();
    await friend.goto(revoked);
    await expect(friend.getByRole('dialog')).toContainText(label('revoked', '被撤销'));
    await expect(
      friend.getByRole('button', { name: label('Accept invitation', '接受邀请'), exact: true }),
    ).toBeDisabled();
    await context.close();
  });
}
