import assert from "node:assert/strict";
import { createServer } from "node:http";
import request from "supertest";
import { z } from "zod";
import { GmailAccountEmailSchema } from "@packages/domain/gmail";
import { GMAIL_SCOPES } from "@packages/provider-contracts/gmail-oauth";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import type { TestAppFixture } from "@packages/web-test-harness";
import { initInMemoryGmailIntegration } from "@packages/test-fixtures/providers/gmail-integration";
import { initInMemoryInboxAddress } from "@packages/test-fixtures/providers/inbox-address";
import { createTestApp } from "../../../test-app";

const LayerSchema = z.object({ name: z.string(), handle: z.unknown(), route: z.unknown() });
const RouteSchema = z.object({
	path: z.string(),
	methods: z.record(z.string(), z.boolean()),
	stack: z.array(z.object({ name: z.string() })),
});

function nestedStackOf(handle: unknown): unknown[] | undefined {
	if (typeof handle !== "function") return undefined;
	const stack: unknown = Reflect.get(handle, "stack");
	return Array.isArray(stack) ? stack : undefined;
}

function flatten(stack: unknown[]): string[] {
	return stack.flatMap((entry) => {
		const layer = LayerSchema.parse(entry);
		const route = RouteSchema.safeParse(layer.route);
		if (route.success) {
			const methods = Object.keys(route.data.methods).map((m) => m.toUpperCase()).join(",");
			return [`${methods} ${route.data.path} ${route.data.stack.map((l) => l.name).join(",")}`];
		}
		const nested = nestedStackOf(layer.handle);
		return nested ? flatten(nested) : [`use ${layer.name}`];
	});
}

async function mountedAppOf(fixture: TestAppFixture): Promise<unknown> {
	const { app } = createTestApp(fixture);
	let mounted: unknown;
	const server = createServer((req, res) => {
		res.on("finish", () => {
			mounted = Reflect.get(req, "app");
		});
		app(req, res);
	});
	await request(server).get("/queue");
	assert.notEqual(mounted, app, "the request must have been answered by the mounted app");
	return mounted;
}

async function readlistRouteOrder(fixture: TestAppFixture): Promise<string[]> {
	const topLevel = nestedStackOf(Reflect.get(Object(await mountedAppOf(fixture)), "router"));
	assert(topLevel, "the app router must expose its stack");
	const readlistRouter = topLevel
		.map((layer) => flatten([layer]))
		.find((entries) =>
			entries.some((entry) => entry.startsWith("GET /:id/read ")) &&
			entries.some((entry) => entry.startsWith("POST /save-content ")),
		);
	assert(readlistRouter, "the readlist router must be mounted");
	return readlistRouter;
}

describe("readlist route order", () => {
	it("mounts the readlist routes in this order", async () => {
		const order = await readlistRouteOrder(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		expect(order).toEqual([
			"GET /:id/read noindexMiddleware,<anonymous>",
			"GET /:id/media/:file noindexMiddleware,<anonymous>",
			"GET /:id/enclosure noindexMiddleware,<anonymous>",
			"GET /:id/view noindexMiddleware,<anonymous>,<anonymous>",
			"GET /:id/view noindexMiddleware,<anonymous>",
			"POST /save-articles <anonymous>",
			"POST / <anonymous>",
			"POST /save <anonymous>",
			"POST /save-content <anonymous>",
			"POST /:id/issue-links <anonymous>",
			"use <anonymous>",
			"use <anonymous>",
			"POST /:id/highlights flagOn,requireNotLocked,<anonymous>,urlencodedParser,<anonymous>",
			"POST /:id/highlights/:highlightId/delete flagOn,requireNotLocked,<anonymous>,urlencodedParser,<anonymous>",
			"GET /queues/:slug/preferences <anonymous>",
			"POST /queues/:slug/preferences requireNotLocked,<anonymous>,<anonymous>",
			"POST /queues/:slug/preferences/overrides/:id/delete requireNotLocked,<anonymous>,<anonymous>",
			"POST /queues/:slug/preferences/inboxes requireNotLocked,<anonymous>,<anonymous>",
			"GET / <anonymous>",
			"GET /counts <anonymous>",
			"POST /filters <anonymous>",
			"POST /dismiss-onboarding <anonymous>",
			"POST /keep-offer/dismiss <anonymous>",
			"POST /onboarding/email/done <anonymous>",
			"POST / requireNotLocked,<anonymous>,jsonParser,<anonymous>",
			"POST /save-articles requireNotLocked,<anonymous>,rawParser,<anonymous>,<anonymous>",
			"POST /save-content requireNotLocked,<anonymous>,rawParser,<anonymous>,<anonymous>",
			"POST /save requireNotLocked,<anonymous>,<anonymous>",
			"POST /queues requireNotLocked,<anonymous>,<anonymous>",
			"POST /queues/:slug/rename requireNotLocked,<anonymous>,<anonymous>",
			"POST /queues/:slug/delete requireNotLocked,<anonymous>,<anonymous>",
			"GET /:id/summary <anonymous>",
			"GET /:id/reader <anonymous>",
			"GET /:id/related <anonymous>",
			"POST /:id/related-dismiss <anonymous>",
			"POST /:id/issue-links requireNotLocked,<anonymous>,<anonymous>",
			"GET /:id/topic-reads <anonymous>",
			"POST /:id/topic-reads requireNotLocked,<anonymous>,<anonymous>",
			"POST /:id/summary-toggle <anonymous>",
			"GET /:id/card <anonymous>",
			"POST /:id/status <anonymous>",
			"POST /:id/delete <anonymous>",
			"POST /:id/assign requireNotLocked,<anonymous>,jsonParser,<anonymous>",
			"POST /:id/create-and-assign requireNotLocked,<anonymous>,<anonymous>",
			"POST /:id/unassign <anonymous>",
			"POST /:id/move requireNotLocked,<anonymous>,<anonymous>",
			"POST /:id/remove-my-version <anonymous>",
		]);
	});

	it("mounts the Gmail dismiss route among the readlist routes when Gmail is connected", async () => {
		const gmail = initInMemoryGmailIntegration({
			grant: { ok: true, grant: { refreshToken: "refresh", accessToken: "access", grantedScope: GMAIL_SCOPES } },
			addresses: initInMemoryInboxAddress({ now: () => new Date() }),
			accountEmail: { ok: true, value: GmailAccountEmailSchema.parse("reader@gmail.com") },
		});
		const order = await readlistRouteOrder({ ...createDefaultTestAppFixture(TEST_APP_ORIGIN), gmailIntegration: gmail.bundle });
		expect(order).toEqual([
			"GET /:id/read noindexMiddleware,<anonymous>",
			"GET /:id/media/:file noindexMiddleware,<anonymous>",
			"GET /:id/enclosure noindexMiddleware,<anonymous>",
			"GET /:id/view noindexMiddleware,<anonymous>,<anonymous>",
			"GET /:id/view noindexMiddleware,<anonymous>",
			"POST /save-articles <anonymous>",
			"POST / <anonymous>",
			"POST /save <anonymous>",
			"POST /save-content <anonymous>",
			"POST /:id/issue-links <anonymous>",
			"use <anonymous>",
			"use <anonymous>",
			"POST /:id/highlights flagOn,requireNotLocked,<anonymous>,urlencodedParser,<anonymous>",
			"POST /:id/highlights/:highlightId/delete flagOn,requireNotLocked,<anonymous>,urlencodedParser,<anonymous>",
			"GET /queues/:slug/preferences/gmail/senders <anonymous>",
			"POST /queues/:slug/preferences/gmail/discovery requireNotLocked,<anonymous>,<anonymous>",
			"POST /queues/:slug/preferences/gmail requireNotLocked,<anonymous>,<anonymous>",
			"GET /queues/:slug/preferences <anonymous>",
			"POST /queues/:slug/preferences requireNotLocked,<anonymous>,<anonymous>",
			"POST /queues/:slug/preferences/overrides/:id/delete requireNotLocked,<anonymous>,<anonymous>",
			"POST /queues/:slug/preferences/inboxes requireNotLocked,<anonymous>,<anonymous>",
			"GET / <anonymous>",
			"GET /counts <anonymous>",
			"POST /filters <anonymous>",
			"POST /dismiss-onboarding <anonymous>",
			"POST /keep-offer/dismiss <anonymous>",
			"POST /onboarding/email/done <anonymous>",
			"POST /onboarding/gmail/dismiss requireNotLocked,<anonymous>,<anonymous>,<anonymous>",
			"POST / requireNotLocked,<anonymous>,jsonParser,<anonymous>",
			"POST /save-articles requireNotLocked,<anonymous>,rawParser,<anonymous>,<anonymous>",
			"POST /save-content requireNotLocked,<anonymous>,rawParser,<anonymous>,<anonymous>",
			"POST /save requireNotLocked,<anonymous>,<anonymous>",
			"POST /queues requireNotLocked,<anonymous>,<anonymous>",
			"POST /queues/:slug/rename requireNotLocked,<anonymous>,<anonymous>",
			"POST /queues/:slug/delete requireNotLocked,<anonymous>,<anonymous>",
			"GET /:id/summary <anonymous>",
			"GET /:id/reader <anonymous>",
			"GET /:id/related <anonymous>",
			"POST /:id/related-dismiss <anonymous>",
			"POST /:id/issue-links requireNotLocked,<anonymous>,<anonymous>",
			"GET /:id/topic-reads <anonymous>",
			"POST /:id/topic-reads requireNotLocked,<anonymous>,<anonymous>",
			"POST /:id/summary-toggle <anonymous>",
			"GET /:id/card <anonymous>",
			"POST /:id/status <anonymous>",
			"POST /:id/delete <anonymous>",
			"POST /:id/assign requireNotLocked,<anonymous>,jsonParser,<anonymous>",
			"POST /:id/create-and-assign requireNotLocked,<anonymous>,<anonymous>",
			"POST /:id/unassign <anonymous>",
			"POST /:id/move requireNotLocked,<anonymous>,<anonymous>",
			"POST /:id/remove-my-version <anonymous>",
		]);
	});
});
