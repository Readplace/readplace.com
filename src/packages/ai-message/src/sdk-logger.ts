import type { ClientOptions } from "openai";

type LogMessage = (message: string, ...rest: unknown[]) => void;

export type DeepseekLogger = {
	info: LogMessage;
	warn: LogMessage;
	debug: LogMessage;
	error: (message: string, details?: { readonly error?: unknown; readonly [field: string]: unknown }) => void;
};

export function adaptSdkLogger(logger: DeepseekLogger): NonNullable<ClientOptions["logger"]> {
	return {
		info: logger.info,
		warn: logger.warn,
		debug: logger.debug,
		error: (message, ...rest) => logger.error(message, rest.length === 0 ? undefined : { sdk: rest }),
	};
}
