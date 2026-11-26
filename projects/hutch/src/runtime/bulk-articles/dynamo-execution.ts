import assert from "node:assert";
import { z } from "zod";
import { batchGetFromTable, defineDynamoTable, transactIfConditions, TransactWriteCommand, type DynamoDBDocumentClient } from "@packages/storage-client";
import { canonicalRemovalKey, READLIST_DEFINITIONS_REVISION_ATTRIBUTE, readlistDefinitionsRevisionKey, readlistRemovedAtAttribute, readlistDefinitionKey, readlistPartitionValue } from "@packages/article-store";
import { isPrivateItemUrl, ReaderArticleHashId, personalReadlistOrder, personalReadlistPartition } from "@packages/domain/article";
import { toEventInstant } from "@packages/domain/event-envelope";
import { computeVerificationStatus } from "@packages/domain/user";
import type { FindUserById } from "@packages/provider-contracts/auth";
import type { ListReadlistDefinitions, ListUserSavesForUrl } from "@packages/provider-contracts/article-store";
import { LinkDequeuedEvent, LinkQueuedEvent } from "@packages/infra-components";
import type { PublishEvent } from "@packages/infra-components/runtime";
import { articleVersion, type BulkAction, BULK_CHUNK_SIZE, BULK_RETENTION_SECONDS, BulkSelection, SelectionTarget, selectionKey, targetKey } from "./selection";

type Write = NonNullable<ConstructorParameters<typeof TransactWriteCommand>[0]["TransactItems"]>[number];
const Row = z.looseObject({
	userId: z.string(), url: z.string(), savedAt: z.string(), status: z.enum(["read", "unread"]), statusRevision: z.number().int().nullish(), readAt: z.string().nullish(),
	personalPickedAt: z.string().nullish(), personalDecision: z.string().nullish(), personalScope: z.string().nullish(),
	viewedAt: z.string().nullish(), bulkSave: z.boolean().nullish(),
});
type Row = z.infer<typeof Row>;
const Ledger = z.object({
	url: z.string(), target: SelectionTarget, outcome: z.enum(["pending", "completed", "skipped", "failed", "restored", "restore-skipped"]),
	notice: z.enum(["queued", "dequeued"]).optional(), recovery: Row.optional(), removedAt: z.string().optional(), expiresAt: z.number(),
});
type Ledger = z.infer<typeof Ledger>;

const FINGERPRINT_FIELDS = ["savedAt", "status", "statusRevision", "readAt", "personalPickedAt", "personalDecision", "viewedAt", "bulkSave", "provenance",
	"restoredAt", "relatedDismissedAt", "lastSummaryOpenedAt", "lastSummaryClosedAt", "relatedDismissedSuggestionId", "suggestionAttribution"] as const;
const DEFAULT_FENCE = [...FINGERPRINT_FIELDS, "personalScope"] as const;
const NAMED_FENCE = ["savedAt", "status", "statusRevision", "readAt", "personalPickedAt", "personalScope"] as const;
const HOLDING_PROJECTION = ["userId", "url", ...DEFAULT_FENCE] as const;
const MAX_TRANSACTION_ITEMS = 100;
const MAX_TRANSACTION_BYTES = 4 * 1024 * 1024;
const MAX_EVERYWHERE_ATTEMPTS = 8;
const STEP_RESERVE_MS = 10_000;

function present(row: Row, name: string): unknown {
	const value = row[name];
	return value === null ? undefined : value;
}

function versionOf(row: Row): string {
	return articleVersion({
		savedAt: row.savedAt, status: row.status, statusRevision: row.statusRevision ?? undefined, readAt: row.readAt ?? undefined,
		personalPickedAt: row.personalPickedAt ?? undefined, personalDecision: row.personalDecision ?? undefined, viewedAt: row.viewedAt ?? undefined,
		bulkSave: row.bulkSave ?? undefined, provenance: present(row, "provenance"), restoredAt: present(row, "restoredAt"),
		relatedDismissedAt: present(row, "relatedDismissedAt"), lastSummaryOpenedAt: present(row, "lastSummaryOpenedAt"),
		lastSummaryClosedAt: present(row, "lastSummaryClosedAt"), relatedDismissedSuggestionId: present(row, "relatedDismissedSuggestionId"),
		suggestionAttribution: present(row, "suggestionAttribution"),
	});
}

function fence(row: Row, fields: readonly string[], prefix: string) {
	const names: Record<string, string> = {};
	const values: Record<string, unknown> = {};
	const checks = fields.map((field, i) => {
		const name = `#${prefix}${i}`;
		names[name] = field;
		const value = row[field];
		if (value === undefined) return `attribute_not_exists(${name})`;
		if (value === null) {
			values[`:${prefix}null`] = "NULL";
			return `attribute_type(${name}, :${prefix}null)`;
		}
		values[`:${prefix}${i}`] = value;
		return `${name} = :${prefix}${i}`;
	});
	return { checks, names, values };
}

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
	findUserById: FindUserById; listUserSavesForUrl: ListUserSavesForUrl; listReadlistDefinitions: ListReadlistDefinitions; publishEvent: PublishEvent; now: () => Date;
	schedulePrivateRelease: (jobId: string, marker: string, expiresAt: number) => Promise<void>;
}) {
	const table = deps.userArticlesTable;
	const raw = defineDynamoTable({ client: deps.client, tableName: table, schema: Row });
	const ledger = defineDynamoTable({ client: deps.client, tableName: table, schema: Ledger });
	const headers = defineDynamoTable({ client: deps.client, tableName: table, schema: z.object({ selection: BulkSelection.optional() }) });
	const revisions = defineDynamoTable({ client: deps.client, tableName: table, schema: z.object({ [READLIST_DEFINITIONS_REVISION_ATTRIBUTE]: z.number().optional() }) });
	const articles = defineDynamoTable({ client: deps.client, tableName: deps.articlesTable, schema: z.object({ url: z.string(), purgedAt: z.unknown().optional() }) });
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
	async function advance(job: BulkSelection, item: Ledger, restoring: boolean, action: Exclude<BulkAction, { kind: "read-everywhere" }>) {
		const target = item.target;
		const key = { userId: job.userId, url: target.key };
		const now = deps.now();
		const at = now.toISOString();
		const deadline = Math.floor(now.getTime() / 1000) + BULK_RETENTION_SECONDS;
		const existing = await raw.get(key, { consistentRead: true });
		const user = await deps.findUserById(job.userId);
		const createsSave = restoring || action.kind === "file";
		const writable = user && !user.deletedAt && !user.ageLockedAt && (!createsSave || user.emailVerified ||
			computeVerificationStatus({ registeredAt: user.registeredAt, now }).state !== "locked");
		const currentVersion = existing && versionOf(existing);
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
				switch (action.kind) {
				case "remove": {
					const privateHold = isPrivateItemUrl(target.url);
					mutate.push({ Delete: { TableName: table, Key: key, ...expected } },
						{ Update: { TableName: table, Key: canonicalRemovalKey(job.userId, target.key),
							UpdateExpression: `SET removedAt = :at, bulkRemoval = :job${privateHold ? ", privateReleaseAt = :deadline, privateReleaseUrl = :url" : ""}`,
							ConditionExpression: "attribute_not_exists(removedAt) OR removedAt < :at",
							ExpressionAttributeValues: { ":at": at, ":job": job.id, ...(privateHold ? { ":deadline": deadline, ":url": target.url } : {}) } } });
					notice = "dequeued";
					break;
				}
				case "file":
					mutate.push({ ConditionCheck: { TableName: table, Key: key, ...expected } },
						{ ConditionCheck: { TableName: table, Key: { userId: job.userId, url: readlistDefinitionKey(action.destination) },
							ConditionExpression: "createdAt = :created", ExpressionAttributeValues: { ":created": action.createdAt } } },
						{ Put: { TableName: table, Item: {
							userId: readlistPartitionValue({ userId: job.userId, readlist: action.destination }), url: target.key, savedAt: at, status: existing.status,
							...(existing.readAt ? { readAt: existing.readAt } : {}), ...(existing.provenance ? { provenance: existing.provenance } : {}),
							...(existing.suggestionAttribution ? { suggestionAttribution: existing.suggestionAttribution } : {}),
						}, ConditionExpression: "attribute_not_exists(userId)" } });
					break;
				case "read":
					if (existing.status === "unread") {
						const indexed = existing.personalScope ? {
							personalScope: personalReadlistPartition(job.userId, existing.personalPickedAt ? "picked" : "uncertain", "read"),
							personalOrder: personalReadlistOrder(at, ReaderArticleHashId.fromResourceUniqueId(target.key)),
						} : {};
						mutate.push({ Put: { TableName: table, Item: { ...existing, status: "read", readAt: at, statusRevision: (existing.statusRevision ?? 0) + 1, ...indexed }, ...expected } });
					}
					break;
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
	async function header(job: BulkSelection) {
		return (await headers.get(selectionKey(job.userId, job.id), { consistentRead: true }))?.selection;
	}
	function settle(job: BulkSelection, item: Ledger, outcome: "completed" | "skipped"): Write[] {
		const { recovery: _prior, notice: _sent, ...before } = item;
		const condition = jobCondition(job);
		return [
			{ Put: { TableName: table, Item: { ...before, ...targetKey(job, item.target.key), outcome }, ConditionExpression: "#outcome = :before",
				ExpressionAttributeNames: { "#outcome": "outcome" }, ExpressionAttributeValues: { ":before": item.outcome } } },
			{ Update: { TableName: table, Key: selectionKey(job.userId, job.id), ...condition,
				UpdateExpression: "SET #job.#count = if_not_exists(#job.#count, :zero) + :one",
				ExpressionAttributeNames: { ...condition.ExpressionAttributeNames, "#count": outcome },
				ExpressionAttributeValues: { ...condition.ExpressionAttributeValues, ":zero": 0, ":one": 1 } } },
		];
	}
	function holdingWrite(params: { partition: string; key: string; row: Row | undefined; isDefault: boolean; at: string; userId: BulkSelection["userId"]; index: number }): Write {
		const { partition, key, row, at } = params;
		const Key = { userId: partition, url: key };
		const prefix = `h${params.index}`;
		if (!row) return { ConditionCheck: { TableName: table, Key, ConditionExpression: "attribute_not_exists(userId)" } };
		if (row.status === "read") {
			return { ConditionCheck: { TableName: table, Key, ConditionExpression: "#status = :read AND savedAt = :saved",
				ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: { ":read": "read", ":saved": row.savedAt } } };
		}
		const fenced = fence(row, params.isDefault ? DEFAULT_FENCE : NAMED_FENCE, prefix);
		const indexed = row.personalScope ? {
			":scope": personalReadlistPartition(params.userId, row.personalPickedAt ? "picked" : "uncertain", "read"),
			":order": personalReadlistOrder(at, ReaderArticleHashId.fromResourceUniqueId(key)),
		} : undefined;
		return { Update: { TableName: table, Key,
			UpdateExpression: `SET #status = :read, readAt = :at, statusRevision = :revision${indexed ? ", personalScope = :scope, personalOrder = :order" : ""}`,
			ConditionExpression: fenced.checks.join(" AND "),
			ExpressionAttributeNames: { ...fenced.names, "#status": "status" },
			ExpressionAttributeValues: { ...fenced.values, ":read": "read", ":at": at, ":revision": typeof row.statusRevision === "number" ? row.statusRevision + 1 : 1, ...indexed },
		} };
	}
	async function markEverywhere(job: BulkSelection, item: Ledger, remainingMs: () => number) {
		const target = item.target;
		const at = deps.now().toISOString();
		for (let attempt = 0; attempt < MAX_EVERYWHERE_ATTEMPTS && remainingMs() >= STEP_RESERVE_MS; attempt++) {
			const user = await deps.findUserById(job.userId);
			const revisionKey = readlistDefinitionsRevisionKey(job.userId);
			const revision = (await revisions.get(revisionKey, { consistentRead: true }))?.[READLIST_DEFINITIONS_REVISION_ATTRIBUTE];
			const lists = await deps.listReadlistDefinitions(job.userId);
			const partitions = [job.userId, ...lists.map(list => readlistPartitionValue({ userId: job.userId, readlist: list.slug }))];
			const rows = await batchGetFromTable({ client: deps.client, tableName: table, schema: Row, consistentRead: true, projection: HOLDING_PROJECTION,
				keys: partitions.map(partition => ({ userId: partition, url: target.key })) });
			const holdings = new Map(rows.map(row => [row.userId, row]));
			const source = holdings.get(job.userId);
			const article = await articles.get({ url: target.key }, { consistentRead: true, projection: ["url", "purgedAt"] });
			const eligible = user && !user.deletedAt && !user.ageLockedAt && article && !article.purgedAt && source && versionOf(source) === target.version;
			const writes: Write[] = eligible ? [
				{ ConditionCheck: { TableName: deps.usersTable, Key: { email: user.email },
					ConditionExpression: "userId = :id AND attribute_not_exists(deletedAt) AND attribute_not_exists(ageLockedAt)", ExpressionAttributeValues: { ":id": job.userId } } },
				{ ConditionCheck: { TableName: deps.articlesTable, Key: { url: target.key },
					ConditionExpression: "attribute_exists(#url) AND attribute_not_exists(purgedAt)", ExpressionAttributeNames: { "#url": "url" } } },
				{ ConditionCheck: { TableName: table, Key: revisionKey, ConditionExpression: revision === undefined ? "attribute_not_exists(#revision)" : "#revision = :revision",
					ExpressionAttributeNames: { "#revision": READLIST_DEFINITIONS_REVISION_ATTRIBUTE }, ...(revision === undefined ? {} : { ExpressionAttributeValues: { ":revision": revision } }) } },
				...partitions.map((partition, index) => holdingWrite({ partition, key: target.key, row: holdings.get(partition), isDefault: index === 0, at, userId: job.userId, index })),
				...settle(job, item, "completed"),
			] : settle(job, item, "skipped");
			assert(writes.length <= MAX_TRANSACTION_ITEMS, "an article's holdings exceed one transaction");
			assert(Buffer.byteLength(JSON.stringify(writes)) <= MAX_TRANSACTION_BYTES, "an article's holdings exceed one transaction's size");
			if (await transact(writes)) return;
			const ledgerRow = await ledger.get(targetKey(job, target.key), { consistentRead: true });
			const current = await header(job);
			if (ledgerRow?.outcome !== "pending" || current?.generation !== job.generation || current.state !== job.state) return;
		}
		throw new Error("an article kept changing while it was marked read in every readlist");
	}
	return async (job: BulkSelection, remainingMs: () => number) => {
		const restoring = job.state === "restoring";
		const action = job.spec.action;
		const prefix = `${selectionKey(job.userId, job.id).url}/target/`;
		const page = await ledger.query({ KeyConditionExpression: "userId = :user AND begins_with(#url, :prefix)",
			ExpressionAttributeNames: { "#url": "url" }, ExpressionAttributeValues: { ":user": job.userId, ":prefix": prefix },
			ConsistentRead: true, Limit: BULK_CHUNK_SIZE, ...(job.cursor ? { ExclusiveStartKey: { userId: job.userId, url: job.cursor } } : {}) });
		let cursor = job.cursor;
		let interrupted = false;
		for (const item of page.items) {
			if (remainingMs() < 10_000) { interrupted = true; break; }
			await flush(job, item);
			if (action.kind === "read-everywhere") {
				if (item.outcome === "pending") await markEverywhere(job, item, remainingMs);
			} else if (restoring ? item.outcome === "completed" && item.recovery !== undefined : item.outcome === "pending") await advance(job, item, restoring, action);
			cursor = item.url;
		}
		if (interrupted && cursor === job.cursor) throw new Error("bulk step has no time left");
		const more = interrupted || page.lastEvaluatedKey !== undefined;
		const settled = !more && action.kind === "read-everywhere" ? await header(job) : undefined;
		if (settled && (settled.generation !== job.generation || settled.state !== job.state)) return;
		if (settled) assert(settled.completed + settled.skipped === settled.selected, "a bulk job reached its last target with targets it never settled");
		const base = jobCondition(job);
		const condition = settled ? {
			ConditionExpression: `${base.ConditionExpression} AND #job.completed = :completed AND #job.skipped = :skipped AND #job.selected = :selected`,
			ExpressionAttributeNames: base.ExpressionAttributeNames,
			ExpressionAttributeValues: { ...base.ExpressionAttributeValues, ":completed": settled.completed, ":skipped": settled.skipped, ":selected": settled.selected },
		} : base;
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
