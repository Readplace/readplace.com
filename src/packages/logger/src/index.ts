type LogMethod = (...args: unknown[]) => void;

export type ErrorDetails = { readonly error?: unknown; readonly [field: string]: unknown };

export type LogErrorLine = (message: string, details?: ErrorDetails) => void;

export type LogError = (message: string, error?: Error) => void;

export interface Logger {
	info: LogMethod;
	error: LogErrorLine;
	warn: LogMethod;
	debug: LogMethod;
}

export namespace Logger {
	export interface Typed<T> {
		info: (data: T) => void;
		error: (data: T) => void;
		warn: (data: T) => void;
		debug: (data: T) => void;
	}

	export function from(impl: Logger): Logger {
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

export const consoleLogger: Logger = {
	info: console.info,
	error: (message, details) =>
		console.error(details === undefined ? message : formatErrorDetailsLine({ message, details, now: () => new Date() })),
	warn: console.warn,
	debug: console.debug,
};

export const noopLogger: Logger & Logger.Typed<unknown> = {
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

function formatErrorDetailsLine(input: { message: string; details: ErrorDetails; now: () => Date }): string {
	const { error, ...rest } = input.details;
	return JSON.stringify({
		...rest,
		level: "ERROR",
		timestamp: input.now().toISOString(),
		message: input.message,
		...serializeError(error),
	});
}

/** Top-level error fields for the envelope. `message` is left to the caller's
 * `message`. */
function serializeError(error: unknown): Record<string, unknown> {
	if (error === undefined) return {};
	if (!(error instanceof Error)) return { thrown: describeThrown(error) };
	const out: Record<string, unknown> = { name: error.name, errorMessage: error.message, stack: error.stack };
	if ("code" in error) out.code = error.code;
	if ("errno" in error) out.errno = error.errno;
	if ("syscall" in error) out.syscall = error.syscall;
	if (error.cause !== undefined) out.cause = serializeCause(error.cause);
	return out;
}

function describeThrown(error: unknown): string {
	if (typeof error !== "object" || error === null) return String(error);
	try {
		return JSON.stringify(error);
	} catch {
		return String(error);
	}
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
