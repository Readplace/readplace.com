import { HutchLogger } from "@packages/hutch-logger";

export interface Logger {
	info: (message: string) => void;
	error: (message: string, error?: Error) => void;
}

interface LogLine {
	level: "INFO" | "ERROR";
	timestamp: string;
	message: string;
	stack?: string;
}

export const logger = (): Logger => {
	const sink = HutchLogger.fromJSON<LogLine>();
	return {
		info: (message: string) => {
			sink.info({
				level: "INFO",
				timestamp: new Date().toISOString(),
				message,
			});
		},
		error: (message: string, error?: Error) => {
			sink.error({
				level: "ERROR",
				timestamp: new Date().toISOString(),
				message,
				stack: error?.stack,
			});
		},
	};
};
