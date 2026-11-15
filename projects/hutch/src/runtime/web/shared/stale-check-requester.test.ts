import express from "express";
import request from "supertest";
import { createViewerIdentityMiddleware, EDGE_SECRET_HEADER, VIEWER_IP_HEADER } from "@packages/viewer-identity";
import { useLoopbackServer } from "@packages/web-test-harness";
import { staleCheckRequesterOf } from "./stale-check-requester";

const serve = useLoopbackServer();
const EDGE_SECRET = "probe-edge-secret";
const VIEWER_HEADERS = { [EDGE_SECRET_HEADER]: EDGE_SECRET, [VIEWER_IP_HEADER]: "203.0.113.7" };

function buildApp(userId: string | undefined) {
	const app = express();
	app.use(createViewerIdentityMiddleware({ edgeSecret: EDGE_SECRET }));
	app.get("/article", (req, res) => {
		Object.assign(req, { userId });
		res.json(staleCheckRequesterOf(req));
	});
	return app;
}

describe("staleCheckRequesterOf", () => {
	it("counts a logged-out request against its client IP", async () => {
		const response = await request(serve(buildApp(undefined))).get("/article").set(VIEWER_HEADERS);

		expect(response.body).toEqual({ ip: "203.0.113.7" });
	});

	it("counts a signed-in request against its account", async () => {
		const response = await request(serve(buildApp("user-1"))).get("/article").set(VIEWER_HEADERS);

		expect(response.body).toEqual({ account: "user-1" });
	});
});
