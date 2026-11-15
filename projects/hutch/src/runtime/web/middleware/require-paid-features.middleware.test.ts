import express, { type Request, type RequestHandler } from "express";
import request from "supertest";
import { useLoopbackServer } from "@packages/web-test-harness";
import { authenticatedUserIdFrom } from "@packages/domain/user";
import { initGetEffectiveAccess } from "@packages/subscription-access";
import { initInMemorySubscriptionProviders } from "@packages/test-fixtures/providers/subscription-providers";
import { createViewerIdentityMiddleware } from "@packages/viewer-identity";
import type { AnalyticsEvent } from "@packages/web-analytics";
import { SIREN_MEDIA_TYPE } from "../api/siren";
import { ACCOUNT_PLANS_URL } from "../pages/account/account.url";
import { initObserveSaveRefusal } from "../shared/save-refusal";
import { initRequirePaidFeatures } from "./require-paid-features.middleware";

const serve = useLoopbackServer();

const TEST_USER_ID = authenticatedUserIdFrom("11112222333344445555666677778888");
const NOW = new Date("2026-05-23T12:00:00.000Z");
const ONE_DAY_MS = 86_400_000;

function buildApp() {
	const providers = initInMemorySubscriptionProviders({ now: () => NOW });
	const events: AnalyticsEvent[] = [];
	const attachUser: RequestHandler = (req: Request, _res, next) => {
		req.userId = TEST_USER_ID;
		next();
	};
	const app = express();
	app.use(createViewerIdentityMiddleware({ edgeSecret: "" }));
	app.post(
		"/paid",
		initObserveSaveRefusal({
			recordUngatedAnalyticsEvent: (event) => {
				events.push(event);
			},
			now: () => NOW,
			salt: "test-salt",
			path: "/paid",
		}),
		attachUser,
		initRequirePaidFeatures({
			getEffectiveAccess: initGetEffectiveAccess({
				findSubscriptionByUserId: providers.findByUserId,
				now: () => NOW,
			}),
		}),
		(_req, res) => {
			res.status(200).type("text/plain").send("ok");
		},
	);
	return { app, providers, events };
}

async function moveToFreePlan(providers: ReturnType<typeof initInMemorySubscriptionProviders>) {
	await providers.upsertTrialing({
		userId: TEST_USER_ID,
		trialEndsAt: new Date(NOW.getTime() - ONE_DAY_MS).toISOString(),
	});
}

describe("requirePaidFeatures middleware", () => {
	it("lets a founding member (no subscription row) through and records no refusal", async () => {
		const { app, events } = buildApp();

		const response = await request(serve(app)).post("/paid").set("Accept", "text/html");

		expect(response.status).toBe(200);
		expect(response.text).toBe("ok");
		expect(events).toEqual([]);
	});

	it("lets a reader inside a trial through", async () => {
		const { app, providers } = buildApp();
		await providers.upsertTrialing({
			userId: TEST_USER_ID,
			trialEndsAt: new Date(NOW.getTime() + ONE_DAY_MS).toISOString(),
		});

		const response = await request(serve(app)).post("/paid").set("Accept", "text/html");

		expect(response.status).toBe(200);
	});

	it("lets an active paid subscriber through", async () => {
		const { app, providers } = buildApp();
		await providers.upsertActive({ userId: TEST_USER_ID, subscriptionId: "sub_paid", customerId: "cus_paid" });

		const response = await request(serve(app)).post("/paid").set("Accept", "text/html");

		expect(response.status).toBe(200);
	});

	it("sends a free reader's HTML form post to the plans page", async () => {
		const { app, providers } = buildApp();
		await moveToFreePlan(providers);

		const response = await request(serve(app)).post("/paid").set("Accept", "text/html");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(ACCOUNT_PLANS_URL);
	});

	it("sends a free reader's htmx request to the plans page with HX-Redirect", async () => {
		const { app, providers } = buildApp();
		await providers.upsertActive({ userId: TEST_USER_ID, subscriptionId: "sub_gone", customerId: "cus_gone" });
		await providers.markCancelledByUserId({ userId: TEST_USER_ID });

		const response = await request(serve(app))
			.post("/paid")
			.set("Accept", "text/html")
			.set("HX-Request", "true");

		expect(response.status).toBe(200);
		expect(response.headers["hx-redirect"]).toBe(ACCOUNT_PLANS_URL);
	});

	it("answers a free reader's Siren client with a 402 warning message", async () => {
		const { app, providers } = buildApp();
		await moveToFreePlan(providers);

		const response = await request(serve(app)).post("/paid").set("Accept", SIREN_MEDIA_TYPE);

		expect(response.status).toBe(402);
		expect(response.headers["content-type"]).toContain(SIREN_MEDIA_TYPE);
		expect(response.body.class).toEqual(["error"]);
		expect(response.body.properties.messages).toEqual([
			{ type: "warning", content: { type: "text/html", body: "This feature isn't on the free plan." } },
		]);
	});

	it.each([
		{ accept: "text/html", htmx: false, status: 303 },
		{ accept: "text/html", htmx: true, status: 200 },
		{ accept: SIREN_MEDIA_TYPE, htmx: false, status: 402 },
	])("tags the refusal paid_feature_refused for $accept (htmx: $htmx)", async ({ accept, htmx, status }) => {
		const { app, providers, events } = buildApp();
		await moveToFreePlan(providers);

		const call = request(serve(app)).post("/paid").set("Accept", accept);
		const response = await (htmx ? call.set("HX-Request", "true") : call);

		expect(response.status).toBe(status);
		expect(events).toEqual([
			expect.objectContaining({ event: "save_refused", status, code: "paid_feature_refused", user_id: TEST_USER_ID }),
		]);
	});
});
