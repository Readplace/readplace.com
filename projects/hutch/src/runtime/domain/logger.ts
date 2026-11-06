import { Logger } from "@packages/logger";

export interface WebLogger {
	info: (message: string) => void;
	error: (message: string, error?: Error) => void;
}

interface LogLine {
	level: "INFO" | "ERROR";
	timestamp: string;
	message: string;
	stack?: string;
}

export const logger = (): WebLogger => {
	const sink = Logger.fromJSON<LogLine>();
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
