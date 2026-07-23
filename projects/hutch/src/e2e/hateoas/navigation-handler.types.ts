import type { Page } from '@playwright/test'

export type PageState = {
	availableActions: string[]
}

export type NavigationHandlerOptions = {
	successDetector: (page: Page) => Promise<boolean>
}

export type PageAction = {
	execute: (page: Page) => Promise<void>
	isAvailable: (page: Page) => Promise<boolean>
}

export type NavigationHandler = {
	detectCurrentState(): Promise<PageState>
	executeAction(actionName: string): Promise<void>
}
