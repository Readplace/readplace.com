import { z } from "zod";
import { defineDynamoTable, transactIfConditions, TransactWriteCommand, type DynamoDBDocumentClient } from "@packages/storage-client";
import { canonicalRemovalKey, readlistRemovedAtAttribute, readlistDefinitionKey, readlistPartitionValue } from "@packages/article-store";
import { isPrivateItemUrl, ReaderArticleHashId, personalReadlistOrder, personalReadlistPartition } from "@packages/domain/article";
import { toEventInstant } from "@packages/domain/event-envelope";
import { computeVerificationStatus } from "@packages/domain/user";
import type { FindUserById } from "@packages/provider-contracts/auth";
import type { ListUserSavesForUrl } from "@packages/provider-contracts/article-store";
import { LinkDequeuedEvent, LinkQueuedEvent } from "@packages/infra-components";
import type { PublishEvent } from "@packages/infra-components/runtime";
import { articleVersion, BULK_CHUNK_SIZE, BULK_RETENTION_SECONDS, type BulkSelection, SelectionTarget, selectionKey, targetKey } from "./selection";

type Write = NonNullable<ConstructorParameters<typeof TransactWriteCommand>[0]["TransactItems"]>[number];
const Row = z.looseObject({
	userId: z.string(), url: z.string(), savedAt: z.string(), status: z.enum(["read", "unread"]), statusRevision: z.number().int().optional(), readAt: z.string().nullish(),
	personalPickedAt: z.string().nullish(), personalDecision: z.string().nullish(), personalScope: z.string().nullish(),
	viewedAt: z.string().nullish(), bulkSave: z.boolean().optional(),
});
type Row = z.infer<typeof Row>;
const Ledger = z.object({
	url: z.string(), target: SelectionTarget, outcome: z.enum(["pending", "completed", "skipped", "failed", "restored", "restore-skipped"]),
	notice: z.enum(["queued", "dequeued"]).optional(), recovery: Row.optional(), removedAt: z.string().optional(), expiresAt: z.number(),
});
type Ledger = z.infer<typeof Ledger>;

function expectedRow(row: Row, extra: string[]) {
	const attrs = new Set([...Object.keys(row), ...extra, "statusRevision", "readAt", "viewedAt", "restoredAt", "personalDecision", "personalScope", "personalPickedAt", "bulkSave", "unknownOrigin", "lastSummaryOpenedAt", "lastSummaryClosedAt", "relatedDismissedAt", "relatedDismissedSuggestionId", "suggestionAttribution"]);
	const names: Record<string, string> = {};
	const values: Record<string, unknown> = {};
	const checks: string[] = [];
	for (const name of attrs) {
		const i = checks.length;
		names[`#v${i}`] = name;
		if (row[name] === undefined) checks.push(`attribute_not_exists(#v${i})`);
		else { checks.push(`#v${i} = :v${i}`); values[`:v${i}`] = row[name]; }
	}
	return { ConditionExpression: checks.join(" AND "), ExpressionAttributeNames: names, ExpressionAttributeValues: values };
}

export function initBulkExecution(deps: {
	client: DynamoDBDocumentClient; userArticlesTable: string; articlesTable: string; usersTable: string;
	findUserById: FindUserById; listUserSavesForUrl: ListUserSavesForUrl; publishEvent: PublishEvent; now: () => Date;
	schedulePrivateRelease: (jobId: string, marker: string, expiresAt: number) => Promise<void>;
}) {
	const table = deps.userArticlesTable;
	const raw = defineDynamoTable({ client: deps.client, tableName: table, schema: Row });
	const ledger = defineDynamoTable({ client: deps.client, tableName: table, schema: Ledger });
	const transact = async (writes: Write[]) => (await transactIfConditions(() => deps.client.send(new TransactWriteCommand({ TransactItems: writes })))).kind === "written";
	const jobCondition = (job: BulkSelection) => ({
		ConditionExpression: "#job.#state = :state AND #job.generation = :generation",
		ExpressionAttributeNames: { "#job": "selection", "#state": "state" },
		ExpressionAttributeValues: { ":state": job.state, ":generation": job.generation },
	});
	async function flush(job: BulkSelection, item: Ledger) {
		if (!item.notice) return;
		const { userId } = job;
		const url = item.target.url;
		if (item.notice === "dequeued" && isPrivateItemUrl(url)) {
			await deps.schedulePrivateRelease(job.id, canonicalRemovalKey(userId, item.target.key).url, item.expiresAt);
		}
		if (item.notice === "queued") await deps.publishEvent(LinkQueuedEvent, { userId, url });
		else if (!(await deps.listUserSavesForUrl({ userId, url })).length) await deps.publishEvent(LinkDequeuedEvent, { userId, url });
		await transact([{ Update: {
			TableName: table, Key: targetKey(job, item.target.key), UpdateExpression: "REMOVE notice", ConditionExpression: "notice = :notice",
			ExpressionAttributeValues: { ":notice": item.notice },
		} }]);
	}
	async function advance(job: BulkSelection, item: Ledger, restoring: boolean) {
		const target = item.target;
		const key = { userId: job.userId, url: target.key };
		const now = deps.now();
		const at = now.toISOString();
		const deadline = Math.floor(now.getTime() / 1000) + BULK_RETENTION_SECONDS;
		const action = job.spec.action;
		const existing = await raw.get(key, { consistentRead: true });
		const user = await deps.findUserById(job.userId);
		const createsSave = restoring || action.kind === "file";
		const writable = user && !user.deletedAt && !user.ageLockedAt && (!createsSave || user.emailVerified ||
			computeVerificationStatus({ registeredAt: user.registeredAt, now }).state !== "locked");
		const currentVersion = existing && articleVersion({ ...existing, readAt: existing.readAt ?? undefined,
			viewedAt: existing.viewedAt ?? undefined, personalDecision: existing.personalDecision ?? undefined, personalPickedAt: existing.personalPickedAt ?? undefined });
		const marker = action.kind === "file" ? readlistRemovedAtAttribute(action.destination) : undefined;
		const removedFromDestination = existing && marker && existing[marker];
		const changedDestination = typeof removedFromDestination === "string" && removedFromDestination >= toEventInstant(new Date(job.createdAt));
		const eligible = writable && !changedDestination && (restoring ? !existing && item.recovery && item.expiresAt > Math.floor(now.getTime() / 1000) : existing && currentVersion === target.version);
		const mutate: Write[] = [];
		let notice: Ledger["notice"];
		if (eligible && user) {
			mutate.push({ ConditionCheck: { TableName: deps.usersTable, Key: { email: user.email },
				ConditionExpression: "userId = :id AND attribute_not_exists(deletedAt) AND attribute_not_exists(ageLockedAt)" +
					(!createsSave ? "" : user.emailVerified ? " AND emailVerified = :verified" : user.registeredAt ? " AND registeredAt = :registered" : " AND attribute_not_exists(registeredAt)"),
				ExpressionAttributeValues: { ":id": job.userId, ...(!createsSave ? {} : user.emailVerified ? { ":verified": true } : user.registeredAt ? { ":registered": user.registeredAt } : {}) },
			} });
			mutate.push({ ConditionCheck: { TableName: deps.articlesTable, Key: { url: target.key },
				ConditionExpression: `attribute_exists(#url) AND attribute_not_exists(purgedAt)${restoring ? " AND (attribute_not_exists(lastPurgedAt) OR lastPurgedAt < :removed)" : ""}`,
				...(restoring ? { ExpressionAttributeValues: { ":removed": item.removedAt } } : {}), ExpressionAttributeNames: { "#url": "url" } } });
			if (restoring) {
				mutate.push({ Put: { TableName: table, Item: { ...item.recovery, ...key, restoredAt: at }, ConditionExpression: "attribute_not_exists(userId)" } },
					{ Update: { TableName: table, Key: canonicalRemovalKey(job.userId, target.key), UpdateExpression: "REMOVE bulkRemoval, privateReleaseAt, privateReleaseUrl",
						ConditionExpression: "removedAt = :removed AND bulkRemoval = :job", ExpressionAttributeValues: { ":removed": item.removedAt, ":job": job.id } } });
				notice = "queued";
			} else if (existing) {
				const expected = expectedRow(existing, marker ? [marker] : []);
				if (action.kind === "remove") {
					const privateHold = isPrivateItemUrl(target.url);
					mutate.push({ Delete: { TableName: table, Key: key, ...expected } },
						{ Update: { TableName: table, Key: canonicalRemovalKey(job.userId, target.key),
							UpdateExpression: `SET removedAt = :at, bulkRemoval = :job${privateHold ? ", privateReleaseAt = :deadline, privateReleaseUrl = :url" : ""}`,
							ConditionExpression: "attribute_not_exists(removedAt) OR removedAt < :at",
							ExpressionAttributeValues: { ":at": at, ":job": job.id, ...(privateHold ? { ":deadline": deadline, ":url": target.url } : {}) } } });
					notice = "dequeued";
				} else if (action.kind === "file") {
					mutate.push({ ConditionCheck: { TableName: table, Key: key, ...expected } },
						{ ConditionCheck: { TableName: table, Key: { userId: job.userId, url: readlistDefinitionKey(action.destination) },
							ConditionExpression: "createdAt = :created", ExpressionAttributeValues: { ":created": action.createdAt } } },
						{ Put: { TableName: table, Item: {
							userId: readlistPartitionValue({ userId: job.userId, readlist: action.destination }), url: target.key, savedAt: at, status: existing.status,
							...(existing.readAt ? { readAt: existing.readAt } : {}), ...(existing.provenance ? { provenance: existing.provenance } : {}),
							...(existing.suggestionAttribution ? { suggestionAttribution: existing.suggestionAttribution } : {}),
						}, ConditionExpression: "attribute_not_exists(userId)" } });
				} else if (existing.status === "unread") {
					const indexed = existing.personalScope ? {
						personalScope: personalReadlistPartition(job.userId, existing.personalPickedAt ? "picked" : "uncertain", "read"),
						personalOrder: personalReadlistOrder(at, ReaderArticleHashId.fromResourceUniqueId(target.key)),
					} : {};
					mutate.push({ Put: { TableName: table, Item: { ...existing, status: "read", readAt: at, statusRevision: (existing.statusRevision ?? 0) + 1, ...indexed }, ...expected } });
				}
			}
		}
		const record = (applied: boolean): Write[] => {
			const outcome = restoring ? (applied ? "restored" : "restore-skipped") : (applied ? "completed" : "skipped");
			const { recovery: _prior, notice: _sent, ...before } = item;
			const next = { ...before, ...targetKey(job, target.key), outcome,
				...(applied && notice ? { notice } : {}),
				...(applied && !restoring && action.kind === "remove" ? { recovery: existing, removedAt: at, expiresAt: deadline } : {}) };
			const counter = !applied ? "skipped" : restoring ? "restoredCount" : "completed";
			const condition = jobCondition(job);
			const extendRecovery = applied && !restoring && action.kind === "remove";
			const restorable = restoring || (applied && action.kind === "remove");
			return [
				{ Put: { TableName: table, Item: next, ConditionExpression: "#outcome = :before",
					ExpressionAttributeNames: { "#outcome": "outcome" }, ExpressionAttributeValues: { ":before": item.outcome } } },
				{ Update: { TableName: table, Key: selectionKey(job.userId, job.id), ...condition,
					UpdateExpression: `SET #job.#count = if_not_exists(#job.#count, :zero) + :one${extendRecovery ? ", #job.expiresAt = :deadline, expiresAt = :ttl" : ""}${restorable ? ", #job.restorable = #job.restorable + :delta" : ""}`,
					ExpressionAttributeNames: { ...condition.ExpressionAttributeNames, "#count": counter },
					ExpressionAttributeValues: { ...condition.ExpressionAttributeValues, ":zero": 0, ":one": 1, ...(extendRecovery ? { ":deadline": deadline, ":ttl": deadline + 86400 } : {}), ...(restorable ? { ":delta": restoring ? -1 : 1 } : {}) },
				} },
			];
		};
		const applied = mutate.length > 2 && await transact([...mutate, ...record(true)]);
		if (!applied) await transact(record(false));
		const current = await ledger.get(targetKey(job, target.key), { consistentRead: true });
		if (current) await flush(job, current);
	}
	return async (job: BulkSelection, remainingMs: () => number) => {
		const restoring = job.state === "restoring";
		const prefix = `${selectionKey(job.userId, job.id).url}/target/`;
		const page = await ledger.query({ KeyConditionExpression: "userId = :user AND begins_with(#url, :prefix)",
			ExpressionAttributeNames: { "#url": "url" }, ExpressionAttributeValues: { ":user": job.userId, ":prefix": prefix },
			ConsistentRead: true, Limit: BULK_CHUNK_SIZE, ...(job.cursor ? { ExclusiveStartKey: { userId: job.userId, url: job.cursor } } : {}) });
		let cursor = job.cursor;
		let interrupted = false;
		for (const item of page.items) {
			if (remainingMs() < 10_000) { interrupted = true; break; }
			await flush(job, item);
			if (restoring ? item.outcome === "completed" && item.recovery !== undefined : item.outcome === "pending") await advance(job, item, restoring);
			cursor = item.url;
		}
		if (interrupted && cursor === job.cursor) throw new Error("bulk step has no time left");
		const more = interrupted || page.lastEvaluatedKey !== undefined;
		const condition = jobCondition(job);
		// DynamoDB TTL can remove an older recovery record while later removals in the same job are still eligible.
		const closingRestore = restoring && !more;
		const finish = "#job.#state = :next" +
			(closingRestore ? ", #job.skipped = #job.skipped + #job.restorable, #job.restorable = :zero" : "") +
			" REMOVE #job.#cursor";
		await transact([{ Update: { TableName: table, Key: selectionKey(job.userId, job.id), ...condition,
			UpdateExpression: `SET #job.generation = #job.generation + :one, ${more ? "#job.#cursor = :next" : finish}`,
			ExpressionAttributeNames: { ...condition.ExpressionAttributeNames, "#cursor": "cursor" },
			ExpressionAttributeValues: { ...condition.ExpressionAttributeValues, ":one": 1, ...(closingRestore ? { ":zero": 0 } : {}), ":next": more ? cursor : restoring ? "restored" : "completed" },
		} }]);
	};
}
