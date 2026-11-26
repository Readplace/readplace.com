import { EventEmitter } from "node:events";
import type { ErrorRequestHandler, NextFunction, Request, Response } from "express";
import type { LogError } from "@packages/logger";
import { createViewerIdentityMiddleware } from "@packages/viewer-identity";
import { type AnalyticsEvent, SAVE_REFUSAL_CODES } from "@packages/web-analytics";
import { initObserveSaveRefusal } from "../../shared/save-refusal";
import { SAVE_LINK_FALLBACK_ACTION, initBodyTooLargeHandler } from "./body-too-large-handler";

type FakeJsonCalls = { status?: number; body?: unknown; type?: string };

function fakeResponse(): {
	res: Response;
	calls: FakeJsonCalls;
} {
	const calls: FakeJsonCalls = {};
	const fake = new EventEmitter() as Response & EventEmitter;
	Object.assign(fake, {
		status(s: number) { calls.status = s; fake.statusCode = s; return fake; },
		type(t: string) { calls.type = t; return fake; },
		json(body: unknown) { calls.body = body; return fake; },
	} satisfies Partial<Response>);
	return { res: fake, calls };
}

function fakeRequest(headers: Record<string, string>): Request {
	const fake = {
		query: {},
		headers,
		get(name: string): string | undefined { return headers[name.toLowerCase()]; },
		accepts(_type: string): string | false {
			const accept = headers.accept ?? "";
			return accept.includes("application/vnd.siren+json")
				? "application/vnd.siren+json"
				: false;
		},
	} as Partial<Request>;
	const req = fake as Request;
	createViewerIdentityMiddleware({ edgeSecret: "" })(req, {} as Response, () => {});
	return req;
}

const SIREN = { accept: "application/vnd.siren+json" };

const ROUTES: {
	name: string;
	init: (deps: { logError: LogError; maxBytes: number }) => ErrorRequestHandler;
}[] = [
	{
		name: "save-articles",
		init: (deps) => initBodyTooLargeHandler({
			...deps,
			logLabel: "save-articles",
			sirenError: {
				code: "save-articles-too-large",
				message: (label) => `Captured tab content was too large to upload in one request (over ${label})`,
			},
			refusalCode: SAVE_REFUSAL_CODES.tooLarge,
		}),
	},
	{
		name: "save-content",
		init: (deps) => initBodyTooLargeHandler({
			...deps,
			logLabel: "save-content",
			sirenError: {
				code: "content-too-large",
				message: (label) => `Content upload exceeded ${label}`,
				actions: [SAVE_LINK_FALLBACK_ACTION],
			},
		}),
	},
];

function tooBig(limit: number): Error {
	return Object.assign(new Error("too big"), { type: "entity.too.large", limit });
}

function refusalEvents(handler: ErrorRequestHandler): AnalyticsEvent[] {
	const events: AnalyticsEvent[] = [];
	const observe = initObserveSaveRefusal({
		recordUngatedAnalyticsEvent: (event) => events.push(event),
		now: () => new Date("2026-04-21T10:00:00.000Z"),
		salt: "test-salt",
		path: "/queue/save",
	});
	const req = fakeRequest(SIREN);
	const { res } = fakeResponse();
	observe(req, res, () => {});
	handler(tooBig(1024), req, res, jest.fn());
	res.emit("finish");
	return events;
}

describe("initBodyTooLargeHandler", () => {
	it("answers an oversized save-articles body with a Siren 422 and no actions", () => {
		const handler = ROUTES[0].init({ logError: () => {}, maxBytes: 1024 });
		const { res, calls } = fakeResponse();
		const next: NextFunction = jest.fn();

		handler(tooBig(1024), fakeRequest(SIREN), res, next);

		expect(calls.status).toBe(422);
		expect(calls.type).toBe("application/vnd.siren+json");
		expect(calls.body).toEqual({
			class: ["error"],
			properties: {
				code: "save-articles-too-large",
				message: "Captured tab content was too large to upload in one request (over 0 MB)",
			},
		});
		expect(next).not.toHaveBeenCalled();
	});

	it("answers an oversized save-content body with a Siren 422 carrying the save-article fallback action", () => {
		const handler = ROUTES[1].init({ logError: () => {}, maxBytes: 1024 });
		const { res, calls } = fakeResponse();
		const next: NextFunction = jest.fn();

		handler(tooBig(1024), fakeRequest(SIREN), res, next);

		expect(calls.status).toBe(422);
		expect(calls.type).toBe("application/vnd.siren+json");
		expect(calls.body).toEqual({
			class: ["error"],
			properties: { code: "content-too-large", message: "Content upload exceeded 0 MB" },
			actions: [
				{
					name: "save-article",
					title: "Save a link",
					href: "/queue",
					method: "POST",
					type: "application/json",
					fields: [{ name: "url", type: "url" }],
				},
			],
		});
		expect(next).not.toHaveBeenCalled();
	});

	it("tags the save-articles refusal as too large", () => {
		const events = refusalEvents(ROUTES[0].init({ logError: () => {}, maxBytes: 1024 }));

		expect(events).toEqual([expect.objectContaining({ status: 422, code: SAVE_REFUSAL_CODES.tooLarge })]);
	});

	it("leaves the save-content refusal untagged", () => {
		const events = refusalEvents(ROUTES[1].init({ logError: () => {}, maxBytes: 1024 }));

		expect(events).toEqual([expect.objectContaining({ status: 422, code: SAVE_REFUSAL_CODES.other })]);
	});

	describe.each(ROUTES)("on $name", ({ name, init }) => {
		it("forwards non-payload errors via next()", () => {
			const handler = init({ logError: () => {}, maxBytes: 1024 });
			const { res, calls } = fakeResponse();
			const next: NextFunction = jest.fn();
			const unrelatedError = new Error("not a payload");

			handler(unrelatedError, fakeRequest(SIREN), res, next);

			expect(next).toHaveBeenCalledWith(unrelatedError);
			expect(calls.status).toBeUndefined();
		});

		it("forwards payload errors whose limit does not match this handler's limit", () => {
			const handler = init({ logError: () => {}, maxBytes: 1024 });
			const { res, calls } = fakeResponse();
			const next: NextFunction = jest.fn();

			handler(tooBig(9999), fakeRequest(SIREN), res, next);

			expect(next).toHaveBeenCalled();
			expect(calls.status).toBeUndefined();
		});

		it("forwards entity.too.large when the client does not accept Siren so the next handler can render a non-Siren response", () => {
			const handler = init({ logError: () => {}, maxBytes: 1024 });
			const { res, calls } = fakeResponse();
			const next: NextFunction = jest.fn();

			handler(tooBig(1024), fakeRequest({ accept: "text/html" }), res, next);

			expect(next).toHaveBeenCalled();
			expect(calls.status).toBeUndefined();
		});

		it("logs the size violation through the injected logError so it lands on the alarm path", () => {
			const logged: { message: string; error?: Error }[] = [];
			const handler = init({ logError: (message, error) => { logged.push({ message, error }); }, maxBytes: 1024 });
			const { res } = fakeResponse();
			const err = tooBig(1024);

			handler(err, fakeRequest(SIREN), res, jest.fn());

			expect(logged).toHaveLength(1);
			expect(logged[0]?.message).toContain(`${name} request body exceeded`);
			expect(logged[0]?.error).toBe(err);
		});

		it("forwards null errors via next()", () => {
			const handler = init({ logError: () => {}, maxBytes: 1024 });
			const { res, calls } = fakeResponse();
			const next: NextFunction = jest.fn();

			handler(null, fakeRequest(SIREN), res, next);

			expect(next).toHaveBeenCalledWith(null);
			expect(calls.status).toBeUndefined();
		});

		it("forwards non-object errors via next()", () => {
			const handler = init({ logError: () => {}, maxBytes: 1024 });
			const { res, calls } = fakeResponse();
			const next: NextFunction = jest.fn();

			handler("string error", fakeRequest(SIREN), res, next);

			expect(next).toHaveBeenCalledWith("string error");
			expect(calls.status).toBeUndefined();
		});

		it("does not pass an Error to logError when the body-parser hands over a non-Error payload", () => {
			const logged: { message: string; error?: Error }[] = [];
			const handler = init({ logError: (message, error) => { logged.push({ message, error }); }, maxBytes: 1024 });
			const { res } = fakeResponse();

			handler({ type: "entity.too.large", limit: 1024 }, fakeRequest(SIREN), res, jest.fn());

			expect(logged).toHaveLength(1);
			expect(logged[0]?.error).toBeUndefined();
		});
	});
});
