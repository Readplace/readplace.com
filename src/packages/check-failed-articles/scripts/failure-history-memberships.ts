import { type DynamoDBDocumentClient, defineDynamoTable, dynamoField, forEachQueryPage } from "@packages/storage-client";
import { z } from "zod";

export interface FailureHistoryMembership {
	savedAt: string;
	viewedAt: string | undefined;
}

const MembershipRow = z.object({
	userId: z.string(),
	status: dynamoField(z.string()),
	savedAt: dynamoField(z.string()),
	viewedAt: dynamoField(z.string()),
});

const MEMBERSHIP_CONCURRENCY = 6;
const MEMBERSHIP_LOOKUP_TIMEOUT_MS = 180_000;

export function initFailureHistoryMemberships(deps: {
	client: Pick<DynamoDBDocumentClient, "send">;
	tableName: string;
}) {
	return async (
		keys: readonly string[],
		signal = AbortSignal.timeout(MEMBERSHIP_LOOKUP_TIMEOUT_MS),
	): Promise<ReadonlyMap<string, readonly FailureHistoryMembership[]>> => {
		const memberships = new Map<string, readonly FailureHistoryMembership[]>();
		if (signal.aborted) return memberships;
		const table = defineDynamoTable({
			tableName: deps.tableName,
			schema: MembershipRow,
			client: {
				send(command) {
					signal.throwIfAborted();
					return deps.client.send(command, { abortSignal: signal });
				},
			},
		});
		const readMemberships = async (key: string) => {
			const found: FailureHistoryMembership[] = [];
			try {
				await forEachQueryPage(table, {
					IndexName: "url-index",
					KeyConditionExpression: "#url = :url",
					ProjectionExpression: "userId, #status, savedAt, viewedAt",
					ExpressionAttributeNames: { "#url": "url", "#status": "status" },
					ExpressionAttributeValues: { ":url": key },
				}, async (rows) => {
					for (const row of rows) {
						if (row.userId.endsWith("#removed") || (row.status !== "read" && row.status !== "unread")) continue;
						if (row.savedAt === undefined) throw new Error("Missing membership save timestamp");
						found.push({ savedAt: row.savedAt, viewedAt: row.viewedAt });
					}
				});
			} catch {
				return;
			}
			if (!signal.aborted) memberships.set(key, found);
		};
		const readBatches = async () => {
			for (let i = 0; i < keys.length && !signal.aborted; i += MEMBERSHIP_CONCURRENCY) {
				await Promise.all(keys.slice(i, i + MEMBERSHIP_CONCURRENCY).map(readMemberships));
			}
		};
		await new Promise<void>((resolve, reject) => {
			const finish = () => {
				signal.removeEventListener("abort", finish);
				resolve();
			};
			signal.addEventListener("abort", finish, { once: true });
			void readBatches().then(finish, (error: unknown) => {
				signal.removeEventListener("abort", finish);
				reject(error);
			});
		});
		return memberships;
	};
}
