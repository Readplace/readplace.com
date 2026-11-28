import assert from "node:assert/strict";
import { z } from "zod";
import { defineDynamoTable, forEachQueryPage, TransactWriteCommand, transactIfConditions, type DynamoDBDocumentClient } from "@packages/storage-client";
import type { UserId } from "@packages/domain/user";
import { BULK_ARTICLE_JOB_PREFIX as BULK_PREFIX } from "@packages/article-store";
import { BULK_RETENTION_SECONDS, BULK_CHUNK_SIZE, BulkSelection, type BulkSelectionStore, headerExpiry, previewExpiry, type SelectionTarget, selectionKey, targetExpiry, targetKey } from "./selection";

function uniqueTargets(targets: readonly SelectionTarget[]) {
	assert(targets.length <= BULK_CHUNK_SIZE, "a preparation step must fit in one transaction");
	return [...new Map(targets.map(target => [target.key, target])).values()];
}

function afterAppend(selection: BulkSelection, added: number, cursor: string | undefined, now: Date): BulkSelection {
	const { cursor: _previous, ...header } = selection;
	return { ...header, expiresAt: previewExpiry(selection, now), ...(cursor === undefined ? {} : { cursor }), state: cursor === undefined ? "preview" : "preparing", generation: selection.generation + 1, selected: selection.selected + added };
}

function canAdvance(current: BulkSelection | undefined, expected: BulkSelection, state: BulkSelection["state"], now: Date) {
	return current?.state === state && current.generation === expected.generation && current.expiresAt > Math.floor(now.getTime() / 1000);
}

function failedHeader(job: BulkSelection): BulkSelection | undefined {
	const state = job.state;
	if (state !== "preparing" && state !== "running" && state !== "restoring") return undefined;
	const failed = state === "restoring" ? job.restorable : state === "running" ? job.selected - job.completed - job.skipped : 0;
	return { ...job, state: "failed", failedState: state, failed };
}

function resumedHeader(job: BulkSelection): BulkSelection | undefined {
	const { failedState, ...header } = job;
	if (job.state !== "failed" || !failedState) return undefined;
	return { ...header, state: failedState, failed: 0 };
}

interface LocalBulkSelections extends BulkSelectionStore {
	listTargets(job: BulkSelection): SelectionTarget[];
	checkpoint(job: BulkSelection): void;
}
export function initInMemoryBulkSelections(): LocalBulkSelections {
	const jobs = new Map<string, BulkSelection>();
	const targets = new Map<string, SelectionTarget>();
	const key = (owner: string, suffix: string) => JSON.stringify([owner, suffix]);
	const replace = (expected: BulkSelection, change: typeof failedHeader) => {
		const id = key(expected.userId, expected.id);
		const current = jobs.get(id);
		if (!current || current.generation !== expected.generation || current.state !== expected.state) return false;
		const next = change(current);
		if (next) jobs.set(id, next);
		return Boolean(next);
	};
	return {
		listTargets(job) {
			const prefix = `${selectionKey(job.userId, job.id).url}/target/`;
			return [...targets.entries()].filter(([address]) => {
				const [owner, url] = JSON.parse(address);
				return owner === job.userId && url.startsWith(prefix);
			}).map(([, target]) => target);
		},
		checkpoint(job) { jobs.set(key(job.userId, job.id), job); },
		async fail(job) { return replace(job, failedHeader); },
		async retry(job) { return replace(job, resumedHeader); },
		async create(selection) {
			const id = key(selection.userId, selection.id);
			assert(!jobs.has(id), "selection identity already in use");
			jobs.set(id, selection);
		},
		async get(owner, id) { return jobs.get(key(owner, id)); },
		async append(selection, batch, cursor, now) {
			const id = key(selection.userId, selection.id);
			if (!canAdvance(jobs.get(id), selection, "preparing", now)) return false;
			let added = 0;
			for (const target of uniqueTargets(batch)) {
				const address = key(selection.userId, targetKey(selection, target.key).url);
				if (targets.has(address)) continue;
				targets.set(address, target);
				added++;
			}
			jobs.set(id, afterAppend(selection, added, cursor, now));
			return true;
		},
		async restore(selection, now) {
			const id = key(selection.userId, selection.id);
			if (!canAdvance(jobs.get(id), selection, "completed", now) || !selection.restorable || selection.spec.action.kind !== "remove") return false;
			jobs.set(id, { ...selection, state: "restoring", generation: selection.generation + 1 });
			return true;
		},
		async confirm(selection, now) {
			const id = key(selection.userId, selection.id);
			if (!canAdvance(jobs.get(id), selection, "preview", now)) return false;
			jobs.set(id, { ...selection, expiresAt: Math.floor(now.getTime() / 1000) + BULK_RETENTION_SECONDS, state: "running", generation: selection.generation + 1 });
			return true;
		},
	};
}

export function initDynamoBulkSelections(client: DynamoDBDocumentClient, tableName: string): BulkSelectionStore {
	const rows = defineDynamoTable({ client, tableName, schema: z.object({ selection: BulkSelection.optional() }) });
	const header = (selection: BulkSelection) => ({ ...selectionKey(selection.userId, selection.id), selection: JSON.parse(JSON.stringify(selection)), expiresAt: headerExpiry(selection) });
	const compare = (selection: BulkSelection, state: string, now: Date) => ({
		ConditionExpression: "#selection.#state = :state AND #selection.generation = :generation AND #selection.expiresAt > :now",
		ExpressionAttributeNames: { "#selection": "selection", "#state": "state" },
		ExpressionAttributeValues: { ":state": state, ":generation": selection.generation, ":now": Math.floor(now.getTime() / 1000) },
	});
	const replace = async (job: BulkSelection, change: typeof failedHeader) => {
		const next = change(job);
		if (!next) return false;
		const result = await transactIfConditions(() => client.send(new TransactWriteCommand({ TransactItems: [
			{ Put: { TableName: tableName, Item: header(next), ConditionExpression: "#job = :previous",
				ExpressionAttributeNames: { "#job": "selection" }, ExpressionAttributeValues: { ":previous": JSON.parse(JSON.stringify(job)) } } },
		] })));
		return result.kind === "written";
	};
	return {
		async fail(job) { return replace(job, failedHeader); },
		async retry(job) { return replace(job, resumedHeader); },
		async create(selection) {
			await rows.put({ Item: header(selection), ConditionExpression: "attribute_not_exists(userId)" });
		},
		async get(userId, id) { return (await rows.get(selectionKey(userId, id), { consistentRead: true }))?.selection; },
		async append(selection, batch, cursor, now) {
			const candidates = uniqueTargets(batch);
			const existing = await Promise.all(candidates.map(target => rows.get(targetKey(selection, target.key), { consistentRead: true })));
			const fresh = candidates.filter((_, index) => !existing[index]);
			const next = afterAppend(selection, fresh.length, cursor, now);
			const result = await transactIfConditions(() => client.send(new TransactWriteCommand({ TransactItems: [
				{ Put: { TableName: tableName, Item: header(next), ...compare(selection, "preparing", now) } },
				...fresh.map(target => ({ Put: {
					TableName: tableName, Item: { ...targetKey(selection, target.key), target, expiresAt: targetExpiry(selection), outcome: "pending" },
					ConditionExpression: "attribute_not_exists(userId)",
				} })),
			] })));
			return result.kind === "written";
		},
		async restore(selection, now) {
			if (!selection.restorable || selection.spec.action.kind !== "remove") return false;
			const result = await transactIfConditions(() => client.send(new TransactWriteCommand({ TransactItems: [
				{ Put: { TableName: tableName, Item: header({ ...selection, state: "restoring", generation: selection.generation + 1 }), ...compare(selection, "completed", now) } },
			] })));
			return result.kind === "written";
		},
		async confirm(selection, now) {
			const result = await transactIfConditions(() => client.send(new TransactWriteCommand({ TransactItems: [
				{ Put: { TableName: tableName, Item: header({ ...selection, expiresAt: Math.floor(now.getTime() / 1000) + BULK_RETENTION_SECONDS, state: "running", generation: selection.generation + 1 }), ...compare(selection, "preview", now) } },
			] })));
			return result.kind === "written";
		},
	};
}

export function initExportBulkArticles(client: DynamoDBDocumentClient, tableName: string) {
	const rows = defineDynamoTable({ client, tableName, schema: z.object({
		url: z.string(), selection: BulkSelection.optional(), target: z.object({ url: z.string() }).optional(),
		outcome: z.string().optional(), recovery: z.record(z.string(), z.unknown()).optional(), removedAt: z.string().optional(),
	}) });
	return async (userId: UserId, now: Date) => {
		const records: Record<string, unknown>[] = [];
		await forEachQueryPage(rows, {
			KeyConditionExpression: "userId = :owner AND begins_with(#url, :prefix)", FilterExpression: "expiresAt > :now",
			ExpressionAttributeNames: { "#url": "url" }, ExpressionAttributeValues: { ":owner": userId, ":prefix": BULK_PREFIX, ":now": Math.floor(now.getTime() / 1000) },
			ConsistentRead: true,
		}, async page => {
			for (const { url, ...row } of page) records.push({ jobId: url.slice(BULK_PREFIX.length).split("/")[0], ...row });
		});
		return records;
	};
}
