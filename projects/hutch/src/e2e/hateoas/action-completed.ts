import type { NavigationHandler } from './navigation-handler.types'

export type OnActionComplete = (actionName: string) => Promise<void>

export function withActionCompleted(
	inner: NavigationHandler,
	onActionComplete: OnActionComplete,
): NavigationHandler {
	return {
		detectCurrentState: () => inner.detectCurrentState(),
		executeAction: async (actionName) => {
			await inner.executeAction(actionName)
			await onActionComplete(actionName)
		},
	}
}
