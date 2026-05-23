import express, { type Request, type RequestHandler } from "express";
import request from "supertest";
import { UserIdSchema, type UserId } from "@packages/domain/user";
import { initInMemorySubscriptionProviders } from "@packages/test-fixtures/providers/subscription-providers";
import { initGetEffectiveAccess } from "../../domain/access/effective-access";
import { initRequireWriteAccess } from "./require-write-access.middleware";

const TEST_USER_ID = UserIdSchema.parse("11112222333344445555666677778888");
const NOW = new Date("2026-05-23T12:00:00.000Z");
const ONE_DAY_MS = 86_400_000;

function buildApp(userId: UserId, now: Date = NOW) {
	const providers = initInMemorySubscriptionProviders({ now: () => now });
	const getEffectiveAccess = initGetEffectiveAccess({
		findSubscriptionByUserId: providers.findByUserId,
		now: () => now,
	});
	const requireWriteAccess = initRequireWriteAccess({ getEffectiveAccess });

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

describe("requireWriteAccess middleware", () => {
	it("calls next() and allows a founding member (no subscription row) through", async () => {
		const { app } = buildApp(TEST_USER_ID);

		const response = await request(app).post("/protected").set("Accept", "text/html");

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

		const response = await request(app).post("/protected").set("Accept", "text/html");

		expect(response.status).toBe(200);
	});

	it("allows a paid subscriber whose subscription is pending cancellation through", async () => {
		const { app, providers } = buildApp(TEST_USER_ID);
		await providers.upsertActive({
			userId: TEST_USER_ID,
			subscriptionId: "sub_pc",
			customerId: "cus_pc",
		});
		await providers.markPendingCancellation({
			userId: TEST_USER_ID,
			cancellationEffectiveAt: new Date(NOW.getTime() + 5 * ONE_DAY_MS).toISOString(),
		});

		const response = await request(app).post("/protected").set("Accept", "text/html");

		expect(response.status).toBe(200);
	});

	it("allows a trial user inside the trial window through", async () => {
		const { app, providers } = buildApp(TEST_USER_ID);
		await providers.upsertTrialing({
			userId: TEST_USER_ID,
			trialEndsAt: new Date(NOW.getTime() + 7 * ONE_DAY_MS).toISOString(),
		});

		const response = await request(app).post("/protected").set("Accept", "text/html");

		expect(response.status).toBe(200);
	});

	it("redirects HTML clients to /queue?inactive=1 when the trial has expired", async () => {
		const { app, providers } = buildApp(TEST_USER_ID);
		await providers.upsertTrialing({
			userId: TEST_USER_ID,
			trialEndsAt: new Date(NOW.getTime() - ONE_DAY_MS).toISOString(),
		});

		const response = await request(app).post("/protected").set("Accept", "text/html");

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
		await providers.markCancelled({ subscriptionId: "sub_cancelled" });

		const response = await request(app).post("/protected").set("Accept", "text/html");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/queue?inactive=1");
	});

	it("returns 402 JSON to API clients that did not request html so the extension surfaces a structured error", async () => {
		const { app, providers } = buildApp(TEST_USER_ID);
		await providers.upsertActive({
			userId: TEST_USER_ID,
			subscriptionId: "sub_api_cancelled",
			customerId: "cus_api_cancelled",
		});
		await providers.markCancelled({ subscriptionId: "sub_api_cancelled" });

		const response = await request(app)
			.post("/protected")
			.set("Accept", "application/vnd.siren+json");

		expect(response.status).toBe(402);
		expect(response.body).toEqual({ error: "subscription_inactive" });
	});

});
