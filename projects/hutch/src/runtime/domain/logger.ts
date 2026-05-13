export interface Logger {
	info: (message: string) => void;
	error: (message: string, error?: Error) => void;
}

export const logger = (): Logger => ({
	info: (message: string) => {
		console.log(
			JSON.stringify({
				level: "INFO",
				timestamp: new Date().toISOString(),
				message,
			}),
		);
	},
	error: (message: string, error?: Error) => {
		console.error(
			JSON.stringify({
				level: "ERROR",
				timestamp: new Date().toISOString(),
				message,
				stack: error?.stack,
			}),
		);
	},
});
