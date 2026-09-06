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
 *
 * The error is unwound beyond `.stack`: a wrapped `fetch failed` keeps its
 * actionable reason (ECONNRESET, UND_ERR_HEADERS_TIMEOUT, a bare `spawn … ENOENT`
 * from a missing binary) only in `.cause` and `.code`, so a stack-only line
 * looks like an origin outage. Carrying `name`/`code`/`cause` makes the class of
 * failure queryable instead of buried.
 */
export function formatErrorLogLine(input: {
	message: string;
	url?: string;
	error?: Error;
	now: () => Date;
}): string {
	// JSON.stringify omits undefined values, so a line without an Error simply
	// carries no error keys rather than null ones.
	return JSON.stringify({
		level: "ERROR",
		timestamp: input.now().toISOString(),
		message: input.message,
		url: input.url,
		...serializeError(input.error),
	});
}

/** Top-level error fields for the envelope. `message` is left to the caller's
 * `message`; the error's own message rides in `.stack`'s first line. */
function serializeError(error: Error | undefined): Record<string, unknown> {
	if (!error) return {};
	const out: Record<string, unknown> = { name: error.name, stack: error.stack };
	if ("code" in error) out.code = error.code;
	if ("errno" in error) out.errno = error.errno;
	if ("syscall" in error) out.syscall = error.syscall;
	if (error.cause !== undefined) out.cause = serializeCause(error.cause);
	return out;
}

/** The immediate `.cause` — undici nests the real network error (with its
 * `code`) one level down under a bare `fetch failed`. One level is enough to
 * name the failure; deeper links stay in the nested stack. */
function serializeCause(cause: unknown): unknown {
	if (!(cause instanceof Error)) return String(cause);
	const out: Record<string, unknown> = { name: cause.name, message: cause.message, stack: cause.stack };
	if ("code" in cause) out.code = cause.code;
	return out;
}
