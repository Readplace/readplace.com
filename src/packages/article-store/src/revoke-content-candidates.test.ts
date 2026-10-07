import { CandidateIdSchema } from "@packages/domain/article";
import type { DynamoDBDocumentClient } from "@packages/hutch-storage-client";
import { z } from "zod";
import { initRevokeContentCandidates } from "./revoke-content-candidates";

describe("content candidate revocation", () => {
	it("invalidates in-flight selectors and permanently records erased IDs before deletion", async () => {
		let received: unknown;
		const client = { send: async (command: unknown) => { received = command; return {}; } } as unknown as Pick<DynamoDBDocumentClient, "send">;
		await initRevokeContentCandidates({ client, tableName: "articles" })({ url: "https://example.com/post", candidateIds: ["first", "second", "first"].map((id) => CandidateIdSchema.parse(id)) });
		const command = z.object({ input: z.object({ UpdateExpression: z.string(), ConditionExpression: z.string(), ExpressionAttributeValues: z.record(z.string(), z.unknown()) }) }).parse(received).input;
		expect(command.UpdateExpression).toContain("ADD contentSelectionRevision :one");
		expect(command.UpdateExpression).toContain("revokedCandidateIds :ids");
		expect(command.ConditionExpression).toContain("attribute_exists(routeId)");
		expect(command.ExpressionAttributeValues[":ids"]).toEqual(new Set(["first", "second"]));
	});
	it("leaves the revision unchanged when no immutable candidate was erased", async () => {
		let calls = 0;
		const client = { send: async () => { calls += 1; return {}; } } as unknown as Pick<DynamoDBDocumentClient, "send">;
		await initRevokeContentCandidates({ client, tableName: "articles" })({ url: "https://example.com/post", candidateIds: [] });
		expect(calls).toBe(0);
	});
});
