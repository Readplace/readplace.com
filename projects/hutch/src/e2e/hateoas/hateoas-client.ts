import type { Page } from '@playwright/test'
import type { NavigationHandler, PageState } from './navigation-handler.types'
import assert from 'node:assert'

export interface NavigationConfig {
	maxNavigations: number
}

interface NavigationResult {
	success: boolean
	currentState: PageState
}

export class HATEOASClient {
	constructor(
		private page: Page,
		private navigationHandler: NavigationHandler,
	) {}

	async navigate(startUrl: string, config: NavigationConfig): Promise<NavigationResult> {
		await this.page.goto(startUrl)

		let navigationCount = 0

		while (navigationCount < config.maxNavigations) {
			const currentState = await this.navigationHandler.detectCurrentState()

			if (currentState.availableActions.includes('complete')) {
				return {
					success: true,
					currentState,
				}
			}

			assert(currentState.availableActions.length > 0, `No available actions at ${this.page.url()} — flow is stuck`)

			const action = currentState.availableActions[0]
			await this.navigationHandler.executeAction(action)

			navigationCount++
		}

		assert(false, `Reached max navigations (${config.maxNavigations}) without completing the flow`)
	}
}
