import assert from "node:assert/strict";
import request from "supertest";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { useTestServer } from "../../../test-app";

const useApp = useTestServer();

function buildHarness() {
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	const harness = useApp({
		...fixture,
		admin: { ...fixture.admin, adminEmails: ["ops@readplace.com"] },
	});
	return { server: harness.server, serviceToken: fixture.admin.recrawlServiceToken };
}

describe("the recrawl service token on admin surfaces", () => {
	it.each(["/admin/recrawl", "/admin/extend-trial", "/admin/founder-notes"])(
		"lets a server-to-server caller with the token open %s without a session",
		async (path) => {
			const { server, serviceToken } = buildHarness();

			const response = await request(server).get(path).set("x-service-token", serviceToken);

			assert.equal(response.status, 200);
			assert.equal(response.headers["cache-control"], "no-store");
		},
	);

	it.each(["/admin", "/admin/newsletters", "/admin/canary-reports/daily/example", "/admin/dashboards"])(
		"sends a caller with only the token on %s to sign in",
		async (path) => {
			const { server, serviceToken } = buildHarness();

			const response = await request(server).get(path).set("x-service-token", serviceToken);

			assert.equal(response.status, 303);
			assert.equal(response.headers.location, "/login");
			assert.equal(response.headers["cache-control"], "no-store");
		},
	);
});
