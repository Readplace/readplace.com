import express, { type Request, type RequestHandler } from "express";
import request from "supertest";
import { useLoopbackServer } from "@packages/web-test-harness";
import { authenticatedUserIdFrom, type AuthenticatedUserId } from "@packages/domain/user";
import { initInMemorySubscriptionProviders } from "@packages/test-fixtures/providers/subscription-providers";
import { createViewerIdentityMiddleware } from "@packages/viewer-identity";
import type { AnalyticsEvent } from "@packages/web-analytics";
import { SIREN_MEDIA_TYPE } from "../api/siren";
import { initObserveSaveRefusal } from "../shared/save-refusal";
import { initRequireWriteAccess } from "./require-write-access.middleware";

const serve = useLoopbackServer();

const TEST_USER_ID = authenticatedUserIdFrom("11112222333344445555666677778888");
const NOW = new Date("2026-05-23T12:00:00.000Z");
const ONE_DAY_MS = 86_400_000;

function buildApp(userId: AuthenticatedUserId, now: Date = NOW) {
	const providers = initInMemorySubscriptionProviders({ now: () => now });
	const requireWriteAccess = initRequireWriteAccess({
		findSubscriptionByUserId: providers.findByUserId,
		now: () => now,
	});

	const app = express();
	const attachUser: RequestHandler = (req: Request, _res, next) => {
		req.userId = userId;
		next();
	};
	app.post("/protected", attachUser, requireWriteAccess, (_req, res) => {
		res.status(200).type("text/plain").send("ok");
	});
	return { app, providers };
}

function buildObservedApp() {
	const providers = initInMemorySubscriptionProviders({ now: () => NOW });
	const events: AnalyticsEvent[] = [];
	const app = express();
	app.use(createViewerIdentityMiddleware({ edgeSecret: "" }));
	app.post(
		"/protected",
		initObserveSaveRefusal({
			recordUngatedAnalyticsEvent: (event) => {
				events.push(event);
			},
			now: () => NOW,
			salt: "test-salt",
			path: "/protected",
		}),
		(req: Request, _res, next) => {
			req.userId = TEST_USER_ID;
			next();
		},
		initRequireWriteAccess({ findSubscriptionByUserId: providers.findByUserId, now: () => NOW }),
		(_req, res) => {
			res.status(200).type("text/plain").send("ok");
		},
	);
	return { app, providers, events };
}

describe("requireWriteAccess middleware", () => {
	it.each([
		{ accept: "text/html", status: 303 },
		{ accept: SIREN_MEDIA_TYPE, status: 402 },
	])("tags the refusal an observer records for $accept at $status", async ({ accept, status }) => {
		const { app, providers, events } = buildObservedApp();
		await providers.upsertTrialing({
			userId: TEST_USER_ID,
			trialEndsAt: new Date(NOW.getTime() - ONE_DAY_MS).toISOString(),
		});

		const response = await request(serve(app)).post("/protected").set("Accept", accept);

		expect(response.status).toBe(status);
		expect(events).toEqual([
			expect.objectContaining({ event: "save_refused", status, code: "no_write_access", user_id: TEST_USER_ID }),
		]);
	});

	it("tags nothing for a reader with write access", async () => {
		const { app, events } = buildObservedApp();

		const response = await request(serve(app)).post("/protected").set("Accept", "text/html");

		expect(response.status).toBe(200);
		expect(events).toEqual([]);
	});

	it("calls next() and allows a founding member (no subscription row) through", async () => {
		const { app } = buildApp(TEST_USER_ID);

		const response = await request(serve(app)).post("/protected").set("Accept", "text/html");

		expect(response.status).toBe(200);
		expect(response.text).toBe("ok");
	});

	it("allows an active paid subscriber through", async () => {
		const { app, providers } = buildApp(TEST_USER_ID);
		await providers.upsertActive({
			userId: TEST_USER_ID,
			subscriptionId: "sub_active",
			customerId: "cus_active",
		});

		const response = await request(serve(app)).post("/protected").set("Accept", "text/html");

		expect(response.status).toBe(200);
	});

	it("pending_cancellation inside the cancellation window still has write access — the user paid for the rest of the period", async () => {
		const { app, providers } = buildApp(TEST_USER_ID);
		await providers.upsertActive({
			userId: TEST_USER_ID,
			subscriptionId: "sub_pc_future",
			customerId: "cus_pc_future",
		});
		await providers.markPendingCancellation({
			userId: TEST_USER_ID,
			cancellationEffectiveAt: new Date(NOW.getTime() + 5 * ONE_DAY_MS).toISOString(),
		});

		const response = await request(serve(app)).post("/protected").set("Accept", "text/html");

		expect(response.status).toBe(200);
		expect(response.text).toBe("ok");
	});

	it("pending_cancellation after the cancellation-effective-at instant flips to read-only — the user's prepaid window has elapsed", async () => {
		const { app, providers } = buildApp(TEST_USER_ID);
		await providers.upsertActive({
			userId: TEST_USER_ID,
			subscriptionId: "sub_pc_past",
			customerId: "cus_pc_past",
		});
		await providers.markPendingCancellation({
			userId: TEST_USER_ID,
			cancellationEffectiveAt: new Date(NOW.getTime() - ONE_DAY_MS).toISOString(),
		});

		const response = await request(serve(app)).post("/protected").set("Accept", "text/html");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/queue?inactive=1");
	});

	it("allows a trial user inside the trial window through", async () => {
		const { app, providers } = buildApp(TEST_USER_ID);
		await providers.upsertTrialing({
			userId: TEST_USER_ID,
			trialEndsAt: new Date(NOW.getTime() + 7 * ONE_DAY_MS).toISOString(),
		});

		const response = await request(serve(app)).post("/protected").set("Accept", "text/html");

		expect(response.status).toBe(200);
	});

	it("redirects HTML clients to /queue?inactive=1 when the trial has expired", async () => {
		const { app, providers } = buildApp(TEST_USER_ID);
		await providers.upsertTrialing({
			userId: TEST_USER_ID,
			trialEndsAt: new Date(NOW.getTime() - ONE_DAY_MS).toISOString(),
		});

		const response = await request(serve(app)).post("/protected").set("Accept", "text/html");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/queue?inactive=1");
	});

	it("redirects HTML clients to /queue?inactive=1 when the subscription is cancelled", async () => {
		const { app, providers } = buildApp(TEST_USER_ID);
		await providers.upsertActive({
			userId: TEST_USER_ID,
			subscriptionId: "sub_cancelled",
			customerId: "cus_cancelled",
		});
		await providers.markCancelledByUserId({ userId: TEST_USER_ID });

		const response = await request(serve(app)).post("/protected").set("Accept", "text/html");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/queue?inactive=1");
	});

	it("returns a 402 Siren warning message to API clients so the share extension shows a proper reason", async () => {
		const { app, providers } = buildApp(TEST_USER_ID);
		await providers.upsertActive({
			userId: TEST_USER_ID,
			subscriptionId: "sub_api_cancelled",
			customerId: "cus_api_cancelled",
		});
		await providers.markCancelledByUserId({ userId: TEST_USER_ID });

		const response = await request(serve(app))
			.post("/protected")
			.set("Accept", "application/vnd.siren+json");

		expect(response.status).toBe(402);
		expect(response.headers["content-type"]).toContain("application/vnd.siren+json");
		expect(response.body.class).toEqual(["error"]);
		expect(response.body.properties.messages).toEqual([
			{
				type: "warning",
				content: { type: "text/html", body: expect.stringContaining("subscription") },
			},
		]);
	});

});
