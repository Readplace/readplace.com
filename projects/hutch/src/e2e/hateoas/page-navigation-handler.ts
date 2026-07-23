import type { Page } from '@playwright/test'
import assert from 'node:assert'
import type { NavigationHandler, PageState, NavigationHandlerOptions, PageAction } from './navigation-handler.types'

export class PageNavigationHandler implements NavigationHandler {
	private actions: Map<string, PageAction>
	private successDetector: (_page: Page) => Promise<boolean>

	constructor(
		private page: Page,
		options: NavigationHandlerOptions,
		externalActions: Map<string, PageAction>,
	) {
		this.successDetector = options.successDetector
		this.actions = new Map()

		for (const [key, action] of externalActions) {
			assert(!this.actions.has(key), `Duplicate action key: ${key}`)
			this.actions.set(key, action)
		}
	}

	async detectCurrentState(): Promise<PageState> {
		await this.page.waitForLoadState('domcontentloaded')

		const isSuccessPage = await this.successDetector(this.page)
		if (isSuccessPage) {
			return {
				availableActions: ['complete'],
			}
		}

		const availableActions: string[] = []

		for (const [actionName, action] of this.actions) {
			if (await action.isAvailable(this.page)) {
				availableActions.push(actionName)
			}
		}

		return {
			availableActions,
		}
	}

	async executeAction(actionName: string): Promise<void> {
		const action = this.actions.get(actionName)
		assert(action, `Action '${actionName}' not found`)

		await action.execute(this.page)
	}
}
