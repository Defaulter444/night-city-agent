import { test, expect } from '@playwright/test';
test.beforeEach(async ({ page }) => { await page.goto('/'); });
test('message survives reload and is not interpreted as HTML', async ({ page }) => {
  const text = '<img src=x onerror=alert(1)> Привет';
  await page.getByLabel('Сообщение', { exact: true }).fill(text);
  await page.getByRole('button', { name: 'Отправить', exact: true }).click();
  await expect(page.locator('.message.self')).toHaveText(text);
  await expect(page.locator('.message.self img')).toHaveCount(0);
  await page.reload(); await expect(page.locator('.message.self')).toHaveText(text);
});
test('empty message shows validation', async ({ page }) => {
  await page.getByRole('button', { name: 'Отправить', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Введите сообщение');
});
test('reveals node', async ({ page }) => {
  await page.getByRole('button', { name: 'СЕТЬ', exact: true }).click();
  await page.getByRole('button', { name: 'Раскрыть узел', exact: true }).click();
  await expect(page.locator('#net-node')).toContainText('ФАЙЛ / ДОСТУПЕН');
});
test('clearing preserves unrelated storage', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('campaign-test', 'keep'));
  await page.getByRole('button', { name: 'Очистить только данные стенда', exact: true }).click();
  expect(await page.evaluate(() => localStorage.getItem('campaign-test'))).toBe('keep');
});
test('reduced motion and viewport', async ({ page }) => {
  await page.emulateMedia({ reducedMotion:'reduce' });
  await page.locator('#motion').selectOption('cinematic');
  await page.getByRole('button', { name: 'Штаб', exact: true }).click();
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});
test('no page errors and screenshot', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.reload();
  await page.screenshot({ path: testInfo.outputPath('workbench.png'), fullPage:true });
  expect(errors).toEqual([]);
});
