import type { DriverNavigation, FlowState, FlowStateHandler } from "./flow-state-handler.types";

function stateChanged(previous: FlowState, current: FlowState): boolean {
	if (current.activeView !== previous.activeView) return true;
	if (current.availableActions.length !== previous.availableActions.length)
		return true;
	return current.availableActions.some(
		(action, i) => action !== previous.availableActions[i],
	);
}

function pickAction(
	current: FlowState,
	previousActions: string[],
): string {
	const newActions = current.availableActions.filter(
		(a) => !previousActions.includes(a),
	);
	return newActions.length > 0 ? newActions[0] : current.availableActions[0];
}

export class FlowRunner<TDriver> {
	constructor(
		private driver: TDriver,
		private stateHandler: FlowStateHandler,
		private navigation: DriverNavigation<TDriver>,
	) {}

	async run(
		startUrl: string,
		config: { maxSteps: number },
	): Promise<{ success: boolean; currentState: FlowState; error?: string }> {
		await this.navigation.navigateTo(this.driver, startUrl);

		let previousActions: string[] = [];

		for (let step = 0; step < config.maxSteps; step++) {
			const state = await this.stateHandler.detectCurrentState();

			if (state.availableActions.includes("complete")) {
				return { success: true, currentState: state };
			}

			if (state.availableActions.length === 0) {
				return {
					success: false,
					currentState: state,
					error: `No available actions at step ${step}. Active view: ${state.activeView}`,
				};
			}

			const actionName = pickAction(state, previousActions);
			previousActions = state.availableActions;
			await this.stateHandler.executeAction(actionName);

			await this.navigation.waitForStateChange(
				this.driver,
				state,
				() => this.stateHandler.detectCurrentState(),
			);
		}

		const finalState = await this.stateHandler.detectCurrentState();
		return {
			success: false,
			currentState: finalState,
			error: `Max steps (${config.maxSteps}) exceeded`,
		};
	}
}

export { stateChanged, pickAction };
