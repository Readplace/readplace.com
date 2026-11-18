import request from "supertest";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { useTestServer } from "../../../test-app";
import { SIREN_MEDIA_TYPE } from "../../api/siren";
import { createAccessToken } from "../../test-helpers/oauth-token";

const useApp = useTestServer();

describe("POST /queue save-article when the save fails", () => {
	it("answers 500 with a Siren error whose code is save-failed", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp({
			...fixture,
			freshness: { refreshArticleIfStale: async () => { throw new Error("boom"); } },
			shared: { ...fixture.shared, logError: () => {} },
		});
		const token = await createAccessToken(harness);

		const response = await request(harness.server)
			.post("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${token}`)
			.type("json")
			.send({ url: "https://example.com/failing" });

		expect(response.status).toBe(500);
		expect(response.headers["content-type"]).toMatch(/^application\/vnd\.siren\+json/);
		expect(response.body.properties.code).toBe("save-failed");
	});
});
