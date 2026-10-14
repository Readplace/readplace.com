import express from "express";
import request from "supertest";
import type { RefreshToken } from "@node-oauth/oauth2-server";
import { createViewerIdentityMiddleware } from "@packages/viewer-identity";
import type { AnalyticsEvent } from "@packages/web-analytics";
import { initTokenRevocation } from "./token-revocation";

const chatGptRefresh: RefreshToken = {
	refreshToken: "chatgpt-refresh",
	client: { id: "ZQDfp02ea4PGzTvwCR_GGBAsVgKJ1jsm", grants: ["refresh_token"] },
	user: { id: "00000000000000000000000000000001", grantId: "grant-1" },
};

function revocationApp(revokeToken: () => Promise<boolean>) {
	const captured: AnalyticsEvent[] = [];
	const app = express();
	app.use(createViewerIdentityMiddleware({ edgeSecret: "" }));
	app.post(
		"/revoke",
		express.json(),
		initTokenRevocation({
			model: {
				getRefreshToken: async (token) => (token === chatGptRefresh.refreshToken ? chatGptRefresh : null),
				getAccessToken: async () => null,
				revokeToken,
			},
			destroyUserSessions: async () => {},
			recordUngatedAnalyticsEvent: (event) => {
				captured.push(event);
			},
			now: () => new Date("2026-09-11T04:47:00.000Z"),
			salt: "test-salt",
		}),
	);
	return { app, captured };
}

describe("initTokenRevocation", () => {
	it("records the grant a revoked refresh token belonged to", async () => {
		const { app, captured } = revocationApp(async () => true);

		const response = await request(app).post("/revoke").send({ token: "chatgpt-refresh" });

		expect(response.status).toBe(200);
		expect(captured).toEqual([
			expect.objectContaining({
				event: "oauth_token_revoked",
				client_id: "ZQDfp02ea4PGzTvwCR_GGBAsVgKJ1jsm",
				grant_id: "grant-1",
				outcome: "revoked",
				token_kind: "refresh",
			}),
		]);
	});

	it("records not_found when the store had already dropped the token between the lookup and the revoke, and still answers 200", async () => {
		const { app, captured } = revocationApp(async () => false);

		const response = await request(app).post("/revoke").send({ token: "chatgpt-refresh" });

		expect(response.status).toBe(200);
		expect(response.body).toEqual({});
		expect(captured).toEqual([
			expect.objectContaining({ outcome: "not_found", token_kind: "refresh", grant_id: "grant-1" }),
		]);
	});
});
