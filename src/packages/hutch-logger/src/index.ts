type LogMethod = (...args: unknown[]) => void;

export interface HutchLogger {
	info: LogMethod;
	error: LogMethod;
	warn: LogMethod;
	debug: LogMethod;
}

export namespace HutchLogger {
	export interface Typed<T> {
		info: (data: T) => void;
		error: (data: T) => void;
		warn: (data: T) => void;
		debug: (data: T) => void;
	}

	export function from(impl: HutchLogger): HutchLogger {
		return impl;
	}

	export function fromJSON<T>(): Typed<T> {
		return {
			info: (data: T) => console.log(JSON.stringify(data)),
			error: (data: T) => console.error(JSON.stringify(data)),
			warn: (data: T) => console.warn(JSON.stringify(data)),
			debug: (data: T) => console.debug(JSON.stringify(data)),
		};
	}
}

export const consoleLogger: HutchLogger = {
	info: console.info,
	error: console.error,
	warn: console.warn,
	debug: console.debug,
};

export const noopLogger: HutchLogger = {
	info: () => {},
	error: () => {},
	warn: () => {},
	debug: () => {},
};


/**
 * The one wire shape an operator-facing error line takes.
 *
 * It must be a single argument of pure JSON, not `logger.error(msg, data)`.
 * Two arguments make Node print `<msg> { … }`, which is not valid JSON, and
 * CloudWatch Logs Insights only discovers queryable fields when the stored
 * message is pure JSON — so a two-argument call renders on the errors dashboard
 * with every column blank but the timestamp. The `level` field matters for the
 * same reason: a Lambda's own ERROR tag lives in the log preamble, which is
 * stripped before the line reaches the errors funnel.
 *
 * `now` is injected so this is testable without freezing the clock globally;
 * composition roots pass `() => new Date()`.
 */
export function formatErrorLogLine(input: {
	message: string;
	error?: Error;
	now: () => Date;
}): string {
	// JSON.stringify omits undefined values, so a line without an Error simply
	// carries no `stack` key rather than a null one.
	return JSON.stringify({
		level: "ERROR",
		timestamp: input.now().toISOString(),
		message: input.message,
		stack: input.error?.stack,
	});
}
