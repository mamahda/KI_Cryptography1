import { expect, test } from '@playwright/test'

test.describe('Phase 0 Frontend Smoke E2E', () => {
  test('boots app in opt-in MSW mode, loads settings, and navigates routes', async ({ page }) => {
    await page.goto('/')

    await expect(
      page.getByRole('heading', { name: 'Platform Pendaftaran Schematics NIC' }),
    ).toBeVisible()
    await expect(page.getByTestId('settings-summary')).toContainText('2–4 members')
    await expect(page.getByTestId('settings-summary')).toContainText('100 MB')

    await page.getByRole('link', { name: 'Encryption Inspector' }).click()
    await expect(
      page.getByRole('heading', { name: 'Encryption & Integrity Inspector' }),
    ).toBeVisible()

    await page.goto('/admin/benchmarks')
    await expect(
      page.getByRole('heading', { name: 'Cipher Benchmark Dashboard' }),
    ).toBeVisible()
  })
})
