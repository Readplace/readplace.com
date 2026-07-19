import type { ElementQueries } from "./element-queries.types";
import {
	EXTENSION_VIEW_IDS,
	SERVER_PAGES,
	TRANSITIONING_VIEW,
} from "./extension-views";
import type {
	FlowAction,
	FlowState,
	FlowStateHandler,
	SuccessDetector,
} from "./flow-state-handler.types";

export class ExtensionStateHandler<TDriver> implements FlowStateHandler {
	constructor(
		private driver: TDriver,
		private successDetector: SuccessDetector<TDriver>,
		private actions: Map<string, FlowAction<TDriver>>,
		private elementQueries: ElementQueries<TDriver>,
	) {}

	async detectCurrentState(): Promise<FlowState> {
		const activeView = await this.getActiveView();

		const isSuccess = await this.successDetector(this.driver);
		if (isSuccess) {
			return { activeView, availableActions: ["complete"] };
		}

		const availableActions: string[] = [];
		for (const [actionName, action] of this.actions) {
			if (await action.isAvailable(this.driver)) {
				availableActions.push(actionName);
			}
		}

		return { activeView, availableActions };
	}

	async executeAction(actionName: string): Promise<void> {
		const action = this.actions.get(actionName);
		if (!action) throw new Error(`Action '${actionName}' not found`);
		await action.execute(this.driver);
	}

	private async getActiveView(): Promise<string> {
		const isWindowClosed =
			await this.elementQueries.isWindowClosed(this.driver);
		if (isWindowClosed) return "tab-closed";

		for (const { className, view } of SERVER_PAGES) {
			if (await this.elementQueries.hasBodyClass(this.driver, className)) {
				return view;
			}
		}

		for (const viewId of EXTENSION_VIEW_IDS) {
			if (
				await this.elementQueries.findVisibleViewById(
					this.driver,
					viewId,
				)
			) {
				return viewId;
			}
		}

		return TRANSITIONING_VIEW;
	}
}
