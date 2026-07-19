export type FlowAction<TDriver> = {
	execute: (driver: TDriver) => Promise<void>;
	isAvailable: (driver: TDriver) => Promise<boolean>;
};

export type FlowState = {
	activeView: string;
	availableActions: string[];
};

export type FlowStateHandler = {
	detectCurrentState(): Promise<FlowState>;
	executeAction(actionName: string): Promise<void>;
};

export type SuccessDetector<TDriver> = (driver: TDriver) => Promise<boolean>;

export type DriverNavigation<TDriver> = {
	navigateTo: (driver: TDriver, url: string) => Promise<void>;
	waitForStateChange: (
		driver: TDriver,
		previous: FlowState,
		detectCurrentState: () => Promise<FlowState>,
	) => Promise<void>;
};
