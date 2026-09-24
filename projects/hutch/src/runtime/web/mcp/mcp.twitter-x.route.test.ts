import request from "supertest";
import { UserIdSchema } from "@packages/domain/user";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { useTestServer } from "../../test-app";
import { createAccessToken } from "../test-helpers/oauth-token";

const useApp = useTestServer();

describe("MCP save_link of a twitter.com link", () => {
	it("saves the x.com article", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const token = await createAccessToken(harness);

		const response = await request(harness.server)
			.post("/mcp")
			.set("Authorization", `Bearer ${token}`)
			.set("Content-Type", "application/json")
			.send(JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: { name: "save_link", arguments: { url: "https://twitter.com/jack/status/20" } },
			}));

		expect(response.status).toBe(200);
		expect(response.body.result.isError).not.toBe(true);
		const { articles } = await harness.articleStore.findArticlesByUser({ userId: UserIdSchema.parse("test-user-123") });
		expect(articles.map((article) => article.url)).toEqual(["https://x.com/jack/status/20"]);
	});
});
