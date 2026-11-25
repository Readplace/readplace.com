import assert from "node:assert/strict";
import { Logger, noopLogger } from "@packages/logger";
import { RunBulkArticlesCommand, BulkArticlesProgressedEvent } from "@packages/infra-components";
import { UserIdSchema } from "@packages/domain/user";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { initBulkWorker } from "./job-worker";
import { initInMemoryBulkSelections } from "./selection-store";
import { newSelection } from "./selection";

it("repairs a lost continuation and ignores a duplicate after the preview is ready", async () => {
	const now = () => new Date("2026-11-24T00:00:00Z");
	const store = initInMemoryBulkSelections();
	const job = newSelection(UserIdSchema.parse("reader"), { source: "all", status: "unread", page: 1, order: "desc", extent: "all", action: { kind: "remove" } }, now());
	await store.create(job);
	const publishEvent = jest.fn(async () => {}).mockRejectedValueOnce(new Error("unavailable"));
	const prepare = jest.fn(async (current: typeof job) => ({ targets: [], next: current.generation === 0 ? "next" : undefined }));
	const handler = initBulkWorker({ store, publishEvent, now, logger: Logger.from(noopLogger), work: { prepare, execute: jest.fn() } });
	const deliver = (type: string, generation: number, remaining = 60_000) => handler(buildSqsEvent([{ messageId: "1", body: JSON.stringify({
		"detail-type": type, detail: { userId: job.userId, id: job.id, generation },
	}) }]), { getRemainingTimeInMillis: () => remaining });
	const command = RunBulkArticlesCommand.detailType;
	expect((await deliver(command, 0, 1000)).batchItemFailures).toHaveLength(1);
	expect((await deliver(command, 0)).batchItemFailures).toHaveLength(1);
	expect((await deliver(command, 0)).batchItemFailures).toEqual([]);
	expect(prepare).toHaveBeenCalledTimes(1);
	expect(publishEvent).toHaveBeenLastCalledWith(BulkArticlesProgressedEvent, expect.objectContaining({ generation: 1 }));
	await deliver(BulkArticlesProgressedEvent.detailType, 1);
	expect(publishEvent).toHaveBeenLastCalledWith(RunBulkArticlesCommand, expect.objectContaining({ generation: 1 }));
	await deliver(command, 1);
	await deliver(command, 1);
	expect(prepare).toHaveBeenCalledTimes(2);
	expect((await store.get(job.userId, job.id))?.state).toBe("preview");
});

it("shows an exhausted preparation and resumes its durable cursor on redrive", async () => {
	const now = () => new Date("2026-11-24T00:00:00Z");
	const store = initInMemoryBulkSelections();
	const job = newSelection(UserIdSchema.parse("reader"), { source: "all", extent: "all", page: 1, order: "desc", status: "unread", action: { kind: "read" } }, now());
	await store.create(job);
	const prepare = jest.fn(async () => ({ targets: [] })).mockRejectedValueOnce(new Error("unavailable"));
	const handler = initBulkWorker({ store, publishEvent: async () => {}, now, logger: Logger.from(noopLogger), work: { prepare, execute: jest.fn() } });
	const event = buildSqsEvent([{ messageId: "exhausted", body: JSON.stringify({
		"detail-type": RunBulkArticlesCommand.detailType, detail: { userId: job.userId, id: job.id, generation: 0 },
	}) }]);
	event.Records[0].attributes.ApproximateReceiveCount = "12";
	const context = { getRemainingTimeInMillis: () => 60_000 };
	expect((await handler(event, context)).batchItemFailures).toHaveLength(1);
	expect(await store.get(job.userId, job.id)).toMatchObject({ state: "failed", failedState: "preparing" });
	event.Records[0].attributes.ApproximateReceiveCount = "1";
	expect((await handler(event, context)).batchItemFailures).toEqual([]);
	expect(await store.get(job.userId, job.id)).toMatchObject({ state: "preview", selected: 0 });
});

it("keeps an old duplicate from reviving a failed later chunk", async () => {
	const now = () => new Date("2026-11-24T00:00:00Z");
	const store = initInMemoryBulkSelections();
	const job = newSelection(UserIdSchema.parse("reader"), { source: "all", extent: "all", page: 1, order: "desc", status: "unread", action: { kind: "read" } }, now());
	await store.create(job);
	await store.append(job, [], "first-page", now());
	const first = await store.get(job.userId, job.id);
	assert(first);
	await store.append(first, [], "second-page", now());
	const second = await store.get(job.userId, job.id);
	assert(second);
	await store.fail(second);
	const publishEvent = jest.fn();
	const prepare = jest.fn();
	const handler = initBulkWorker({ store, publishEvent, now, logger: Logger.from(noopLogger), work: { prepare, execute: jest.fn() } });
	const event = buildSqsEvent([{ messageId: "duplicate", body: JSON.stringify({
		"detail-type": RunBulkArticlesCommand.detailType, detail: { userId: job.userId, id: job.id, generation: 0 },
	}) }]);
	expect((await handler(event, { getRemainingTimeInMillis: () => 60_000 })).batchItemFailures).toEqual([]);
	expect(await store.get(job.userId, job.id)).toMatchObject({ state: "failed", cursor: "second-page" });
	expect(prepare).not.toHaveBeenCalled();
	expect(publishEvent).not.toHaveBeenCalled();
});
