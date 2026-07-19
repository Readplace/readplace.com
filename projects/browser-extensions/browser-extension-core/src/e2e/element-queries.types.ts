export type ElementQueries<TDriver> = {
	findVisibleViewById: (
		driver: TDriver,
		viewId: string,
	) => Promise<boolean>;
	hasBodyClass: (driver: TDriver, className: string) => Promise<boolean>;
	isWindowClosed: (driver: TDriver) => Promise<boolean>;
};
