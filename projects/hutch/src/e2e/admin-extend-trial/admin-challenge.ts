import { type Page, expect } from '@playwright/test'
import { totpCodeAt } from '../../runtime/web/pages/admin/totp'
import { clickAndWaitForPageReload } from '../page-interactions'
import { E2E_ADMIN_TOTP_SECRET } from './admin-e2e-user'

export async function passAdminChallenge(page: Page, { baseURL }: { baseURL: string }): Promise<void> {
	await page.goto(`${baseURL}/admin/mfa`, { waitUntil: 'domcontentloaded' })
	await expect(page.locator('body.page-admin-mfa')).toHaveCount(1)
	await page.locator('input[name="code"]').fill(totpCodeAt({ secret: E2E_ADMIN_TOTP_SECRET, atMs: Date.now() }))
	await clickAndWaitForPageReload(page, page.locator('[data-test-form="admin-mfa"] button[type="submit"]'))
	await expect(page.locator('body.page-admin')).toHaveCount(1)
}
