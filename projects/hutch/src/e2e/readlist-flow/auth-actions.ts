import type { PageAction } from '../hateoas/navigation-handler.types'
import type { AuthActionKey } from './action-catalog'
import type { PasswordResetProgress } from './password-reset-actions'
import { isOnPage, clickAndWaitForPageReload } from '../page-interactions'

export type AuthData = {
	email: string
	password: string
}

export type AuthProgress = {
	accountCreated: boolean
	loggedOut: boolean
	loggedIn: boolean
}

export function createAuthActions(
	data: AuthData,
	progress: AuthProgress,
	passwordResetProgress: PasswordResetProgress,
): Record<AuthActionKey, PageAction> {
	return {
		'submit-signup-form': {
			isAvailable: async (page) => {
				if (progress.accountCreated) return false
				return isOnPage(page, 'page-signup')
			},
			execute: async (page) => {
				await page.locator('#email').fill(data.email)
				await page.locator('#password').fill(data.password)
				await page.locator('input[name="loadedAt"]').evaluate(
					(el: HTMLInputElement) => { el.value = String(Date.now() - 5000) },
				)
				await clickAndWaitForPageReload(
					page,
					page.locator('[data-test-action="signup"]'),
				)
				await page.waitForSelector('body.page-readlist')
				progress.accountCreated = true
			},
		},

		'click-logout': {
			isAvailable: async (page) => {
				if (!progress.accountCreated) return false
				if (progress.loggedOut) return false
				return isOnPage(page, 'page-readlist')
			},
			execute: async (page) => {
				const userMenu = page.locator('.nav__user-summary')
				if (await userMenu.isVisible()) await userMenu.click()
				await clickAndWaitForPageReload(
					page,
					page.locator('[data-test-nav-item="logout"]'),
				)
				await page.waitForSelector('body.page-home')
				progress.loggedOut = true
			},
		},

		'navigate-to-login': {
			isAvailable: async (page) => {
				if (!progress.loggedOut) return false
				if (progress.loggedIn) return false
				if (!passwordResetProgress.loggedInWithNewPassword) return false
				return isOnPage(page, 'page-home')
			},
			execute: async (page) => {
				await page.locator('[data-test-nav-item="login"]').click()
				await page.waitForSelector('body.page-login')
			},
		},

		'submit-login-form': {
			isAvailable: async (page) => {
				if (!progress.loggedOut) return false
				if (progress.loggedIn) return false
				if (!passwordResetProgress.loggedInWithNewPassword) return false
				return isOnPage(page, 'page-login')
			},
			execute: async (page) => {
				await page.locator('#email').fill(data.email)
				await page.locator('#password').fill(data.password)
				await clickAndWaitForPageReload(
					page,
					page.locator('[data-test-form="login"] button[type="submit"]'),
				)
				await page.waitForSelector('body.page-readlist')
				progress.loggedIn = true
			},
		},
	}
}
