import { EventEmitter } from "node:events";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import { createViewerIdentityMiddleware } from "@packages/viewer-identity";
import { ANALYTICS_EVENTS, type AnalyticsEvent, type RecordUngatedEvent, SAVE_REFUSAL_CODES, type SaveRefusalCode, type SaveRefusedEvent } from "@packages/web-analytics";
import { initObserveSaveRefusal, tagSaveRefusal } from "./save-refusal";

function fakeReq(): Request {
	const headers: Record<string, string | undefined> = {};
	const req = {
		query: {},
		headers,
		get(name: string): string | undefined {
			return headers[name.toLowerCase()];
		},
	} as Request;
	createViewerIdentityMiddleware({ edgeSecret: "" })(req, {} as Response, () => {});
	return req;
}

function observe(status: number, tag?: SaveRefusalCode): AnalyticsEvent[] {
	const events: AnalyticsEvent[] = [];
	const recordUngatedAnalyticsEvent: RecordUngatedEvent<AnalyticsEvent> = (e) => events.push(e);
	const res = new EventEmitter() as Response & EventEmitter;
	res.statusCode = status;
	if (tag) tagSaveRefusal(res, tag);
	const middleware = initObserveSaveRefusal({
		recordUngatedAnalyticsEvent,
		now: () => new Date("2026-04-21T10:00:00.000Z"),
		salt: "test-salt",
		path: "/queue/save-articles",
	});
	let nextCalled = false;
	middleware(fakeReq(), res, () => {
		nextCalled = true;
	});
	assert.equal(nextCalled, true, "the observer must pass the request through");
	res.emit("finish");
	return events;
}

function refusal(status: number, tag?: SaveRefusalCode): SaveRefusedEvent {
	const events = observe(status, tag);
	const first = events[0];
	assert(first !== undefined && first.event === ANALYTICS_EVENTS.saveRefused, "a refusal must emit save_refused");
	return first;
}

describe("initObserveSaveRefusal", () => {
	it("emits nothing for a successful response", () => {
		assert.deepEqual(observe(200), []);
	});

	it("maps the shared-gate statuses to a refusal code", () => {
		assert.equal(refusal(401).code, SAVE_REFUSAL_CODES.unauthenticated);
		assert.equal(refusal(402).code, SAVE_REFUSAL_CODES.noWriteAccess);
		assert.equal(refusal(403).code, SAVE_REFUSAL_CODES.locked);
		assert.equal(refusal(429).code, SAVE_REFUSAL_CODES.rateLimited);
	});

	it("prefers a tagged code over the status", () => {
		assert.equal(refusal(422, SAVE_REFUSAL_CODES.tooManyPages).code, SAVE_REFUSAL_CODES.tooManyPages);
	});

	it("falls back to other for an untagged status it does not map", () => {
		assert.equal(refusal(500).code, SAVE_REFUSAL_CODES.other);
	});
});
