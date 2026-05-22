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
    'navigate-to-signup': {
      isAvailable: async (page) => {
        if (progress.accountCreated) return false
        if (await isOnPage(page, 'page-home')) return true
        return isOnPage(page, 'page-login')
      },
      execute: async (page) => {
        await page.locator('a[href^="/signup"]').first().click()
      },
    },

    'submit-signup-form': {
      isAvailable: async (page) => {
        if (progress.accountCreated) return false
        return isOnPage(page, 'page-signup')
      },
      execute: async (page) => {
        await page.locator('#email').fill(data.email)
        await page.locator('#password').fill(data.password)
        await page.locator('#confirmPassword').fill(data.password)
        await page.locator('input[name="loadedAt"]').evaluate(
          (el) => { (el as HTMLInputElement).value = String(Date.now() - 5000) },
        )
        await clickAndWaitForPageReload(
          page,
          page.locator('[data-test-action="signup-trial"]'),
        )

        const onQueue = await isOnPage(page, 'page-queue')
        if (onQueue) {
          progress.accountCreated = true
          return
        }

        // Account already exists in persistent storage — navigate to login.
        // Match href with a prefix: the signup page propagates any ?return=
        // query through the "Sign in" link when signup was reached via /save,
        // so an exact-match locator misses it.
        const error = page.locator('[data-test-global-error]')
        if (await error.isVisible()) {
          await page.locator('.auth-card__footer a[href^="/login"]').click()
          progress.accountCreated = true
          progress.loggedOut = true
        }
      },
    },

    'click-logout': {
      isAvailable: async (page) => {
        if (!progress.accountCreated) return false
        if (progress.loggedOut) return false
        return isOnPage(page, 'page-queue')
      },
      execute: async (page) => {
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
        await page.locator('[data-test-nav-item="signup"]').click()
        await page.waitForSelector('[data-test-action="sign-in"]')

        await page.locator('[data-test-action="sign-in"]').click()
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
        await page.waitForSelector('body.page-queue')
        progress.loggedIn = true
      },
    },
  }
}
