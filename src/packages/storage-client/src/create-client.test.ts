import assert from "node:assert/strict";
import { createDynamoDocumentClient } from "./create-client";

describe("createDynamoDocumentClient", () => {
	it("builds a document client from the given config", async () => {
		const client = createDynamoDocumentClient({ region: "ap-southeast-2" });

		assert.equal(await client.config.region(), "ap-southeast-2");
		client.destroy();
	});

	it("builds a document client with the SDK defaults when given no config", () => {
		const client = createDynamoDocumentClient();

		assert.equal(client.constructor.name, "DynamoDBDocumentClient");
		client.destroy();
	});
});
