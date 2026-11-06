import assert from "node:assert/strict";
import type { S3Client } from "@aws-sdk/client-s3";
import type { DynamoDBDocumentClient } from "@packages/storage-client";
import { type UploadId, UploadIdSchema } from "@packages/media-contracts";
import { initMediaObjectHoldings, initMediaObjectStore } from "./media-object-store";
import type { MediaObjectRows, ObjectMeta } from "./media-objects.types";
import { type ObjectSha256, ObjectSha256Schema, objectKey } from "./object-sha256";

const SHA = ObjectSha256Schema.parse("a".repeat(64));
const OTHER_SHA = ObjectSha256Schema.parse("b".repeat(64));
const UPLOAD_A = UploadIdSchema.parse("0".repeat(32));
const UPLOAD_B = UploadIdSchema.parse("1".repeat(32));
const UPLOAD_C = UploadIdSchema.parse("2".repeat(32));

function memoryRows() {
	const metas = new Map<ObjectSha256, ObjectMeta>();
	const refs = new Set<string>();
	const holds = new Map<UploadId, Set<ObjectSha256>>();
	const hooks: {
		beforeWrite?: () => Promise<void>;
		beforeRelease?: () => Promise<void>;
		failWrite?: Error;
	} = {};
	const refId = (p: { sha256: ObjectSha256; uploadId: UploadId }) => `${p.sha256}|${p.uploadId}`;
	const matches = (sha256: ObjectSha256, seen: ObjectMeta | undefined) => {
		const current = metas.get(sha256);
		if (seen === undefined || current === undefined) return seen === current;
		return (
			current.state === seen.state && current.generation === seen.generation && current.holders === seen.holders
		);
	};
	const take = (key: "beforeWrite" | "beforeRelease") => {
		const hook = hooks[key];
		hooks[key] = undefined;
		return hook;
	};

	const rows: MediaObjectRows = {
		async readHolding(params) {
			return { meta: metas.get(params.sha256), held: refs.has(refId(params)) };
		},
		async writeHolding({ sha256, uploadId, meta, seen }) {
			await take("beforeWrite")?.();
			const failure = hooks.failWrite;
			hooks.failWrite = undefined;
			if (failure) throw failure;
			if (!matches(sha256, seen) || refs.has(refId({ sha256, uploadId }))) return "conflict";
			metas.set(sha256, meta);
			refs.add(refId({ sha256, uploadId }));
			holds.set(uploadId, new Set([...(holds.get(uploadId) ?? []), sha256]));
			return "written";
		},
		async releaseHolding({ sha256, uploadId, meta, seen }) {
			await take("beforeRelease")?.();
			if (!matches(sha256, seen) || !refs.has(refId({ sha256, uploadId }))) return "conflict";
			metas.set(sha256, meta);
			refs.delete(refId({ sha256, uploadId }));
			return "released";
		},
		async listHeldObjects({ uploadId }) {
			return [...(holds.get(uploadId) ?? [])];
		},
		async readMeta({ sha256 }) {
			return metas.get(sha256);
		},
		async deleteHold({ sha256, uploadId }) {
			holds.get(uploadId)?.delete(sha256);
		},
	};
	return { rows, metas, refs, holds, hooks };
}

function memoryBytes() {
	const keys = new Set<string>();
	const hooks: { onDelete?: (key: string) => Promise<void> } = {};
	const puts: string[] = [];
	return {
		keys,
		byteHooks: hooks,
		puts,
		putBytes: async (key: string) => {
			puts.push(key);
			keys.add(key);
		},
		bytes: {
			async deleteObject({ key }: { key: string }) {
				const hook = hooks.onDelete;
				hooks.onDelete = undefined;
				await hook?.(key);
				keys.delete(key);
			},
		},
	};
}

function setup() {
	const memory = memoryRows();
	const s3 = memoryBytes();
	const store = initMediaObjectHoldings({ rows: memory.rows, bytes: s3.bytes });
	const refAs = (uploadId: UploadId, sha256: ObjectSha256 = SHA) =>
		store.ref({ sha256, uploadId, size: 1_024, mediaType: "audio/mpeg", putBytes: s3.putBytes });
	return { ...memory, ...s3, store, refAs };
}

const GEN_1 = objectKey({ sha256: SHA, generation: 1 });
const GEN_2 = objectKey({ sha256: SHA, generation: 2 });

describe("ref", () => {
	it("copies the bytes once and writes a live meta at generation 1 on a first ref", async () => {
		const { refAs, metas, puts } = setup();

		const held = await refAs(UPLOAD_A);

		assert.deepEqual(held, { sha256: SHA, generation: 1, key: `objects/sha256/${SHA}/1` });
		assert.deepEqual(puts, [GEN_1]);
		assert.deepEqual(metas.get(SHA), {
			size: 1_024,
			mediaType: "audio/mpeg",
			generation: 1,
			holders: 1,
			state: "live",
		});
	});

	it("returns the held object without another copy or write when the same upload refs again", async () => {
		const { refAs, metas, puts } = setup();
		await refAs(UPLOAD_A);

		const held = await refAs(UPLOAD_A);

		assert.equal(held.key, GEN_1);
		assert.deepEqual(puts, [GEN_1]);
		assert.equal(metas.get(SHA)?.holders, 1);
	});

	it("adds a holder without a second copy when another upload refs the same bytes", async () => {
		const { refAs, metas, puts } = setup();
		await refAs(UPLOAD_A);

		const held = await refAs(UPLOAD_B);

		assert.equal(held.key, GEN_1);
		assert.deepEqual(puts, [GEN_1]);
		assert.equal(metas.get(SHA)?.holders, 2);
	});

	it("leaves no live meta when its transaction fails after the copy, and its retry copies again", async () => {
		const { refAs, metas, puts, hooks } = setup();
		hooks.failWrite = new Error("transaction failed");

		await assert.rejects(refAs(UPLOAD_A), /transaction failed/);
		assert.equal(metas.get(SHA), undefined);

		await refAs(UPLOAD_A);
		assert.deepEqual(puts, [GEN_1, GEN_1]);
		assert.equal(metas.get(SHA)?.state, "live");
	});

	it("re-reads and joins the live meta when another upload's ref commits first", async () => {
		const { refAs, metas, puts, hooks } = setup();
		hooks.beforeWrite = async () => {
			await refAs(UPLOAD_B);
		};

		const held = await refAs(UPLOAD_A);

		assert.equal(held.key, GEN_1);
		assert.deepEqual(puts, [GEN_1, GEN_1]);
		assert.equal(metas.get(SHA)?.holders, 2);
	});

	it("writes generation 2 over a deleting generation-1 meta and deletes the generation-1 bytes itself", async () => {
		const { refAs, store, metas, keys, byteHooks } = setup();
		await refAs(UPLOAD_A);
		byteHooks.onDelete = async () => {
			throw new Error("s3 unavailable");
		};
		await assert.rejects(store.unrefAll({ uploadId: UPLOAD_A }), /s3 unavailable/);
		assert.equal(metas.get(SHA)?.state, "deleting");

		const held = await refAs(UPLOAD_B);

		assert.equal(held.key, GEN_2);
		assert.deepEqual([...keys], [GEN_2]);
		assert.deepEqual(metas.get(SHA), {
			size: 1_024,
			mediaType: "audio/mpeg",
			generation: 2,
			holders: 1,
			state: "live",
		});
	});
});

describe("unrefAll", () => {
	it("flips the last holder's meta to deleting, then deletes the bytes and keeps the deleting meta", async () => {
		const { refAs, store, metas, keys, holds, byteHooks } = setup();
		await refAs(UPLOAD_A);
		const seenWhileDeleting: (ObjectMeta | undefined)[] = [];
		byteHooks.onDelete = async () => {
			seenWhileDeleting.push(metas.get(SHA));
		};

		await store.unrefAll({ uploadId: UPLOAD_A });

		assert.equal(seenWhileDeleting[0]?.state, "deleting");
		assert.equal(seenWhileDeleting[0]?.holders, 0);
		assert.equal(keys.size, 0);
		assert.equal(metas.get(SHA)?.state, "deleting");
		assert.deepEqual([...(holds.get(UPLOAD_A) ?? [])], []);
	});

	it("releases every object the upload holds", async () => {
		const { refAs, store, metas, keys } = setup();
		await refAs(UPLOAD_A, SHA);
		await refAs(UPLOAD_A, OTHER_SHA);

		await store.unrefAll({ uploadId: UPLOAD_A });

		assert.deepEqual(
			[...metas.values()].map((meta) => meta.state),
			["deleting", "deleting"],
		);
		assert.equal(keys.size, 0);
	});

	it("leaves the meta live and the bytes in place while another upload holds them, and drops its own holds row", async () => {
		const { refAs, store, metas, keys, holds } = setup();
		await refAs(UPLOAD_A);
		await refAs(UPLOAD_B);

		await store.unrefAll({ uploadId: UPLOAD_A });

		assert.equal(metas.get(SHA)?.state, "live");
		assert.equal(metas.get(SHA)?.holders, 1);
		assert.deepEqual([...keys], [GEN_1]);
		assert.deepEqual([...(holds.get(UPLOAD_A) ?? [])], []);
		assert.deepEqual([...(holds.get(UPLOAD_B) ?? [])], [SHA]);
	});

	it("rejects with the holds row kept when gc fails, and a re-run deletes the bytes and the holds row", async () => {
		const { refAs, store, metas, keys, holds, byteHooks } = setup();
		await refAs(UPLOAD_A);
		byteHooks.onDelete = async () => {
			throw new Error("s3 unavailable");
		};

		await assert.rejects(store.unrefAll({ uploadId: UPLOAD_A }), /s3 unavailable/);
		assert.deepEqual([...(holds.get(UPLOAD_A) ?? [])], [SHA]);

		await store.unrefAll({ uploadId: UPLOAD_A });
		assert.equal(keys.has(GEN_1), false);
		assert.equal(metas.get(SHA)?.state, "deleting");
		assert.deepEqual([...(holds.get(UPLOAD_A) ?? [])], []);
	});

	it("re-reads and releases against the new holder count when another ref commits first", async () => {
		const { refAs, store, metas, hooks } = setup();
		await refAs(UPLOAD_A);
		await refAs(UPLOAD_B);
		hooks.beforeRelease = async () => {
			await refAs(UPLOAD_C);
		};

		await store.unrefAll({ uploadId: UPLOAD_A });

		assert.equal(metas.get(SHA)?.holders, 2);
		assert.equal(metas.get(SHA)?.state, "live");
	});
});

describe("gc", () => {
	it("leaves generation-2 bytes when a ref supersedes the generation-1 meta it is collecting", async () => {
		const { refAs, store, metas, keys, byteHooks } = setup();
		await refAs(UPLOAD_A);
		let fenced: Promise<unknown> = Promise.resolve();
		byteHooks.onDelete = async () => {
			fenced = refAs(UPLOAD_B);
			await fenced;
		};

		await store.unrefAll({ uploadId: UPLOAD_A });

		assert.deepEqual(await fenced, { sha256: SHA, generation: 2, key: GEN_2 });
		assert.deepEqual([...keys], [GEN_2]);
		assert.equal(metas.get(SHA)?.generation, 2);
		assert.equal(metas.get(SHA)?.state, "live");
	});

	it("leaves a later ref's bytes when a stale gc resumes after the object was collected and referenced again", async () => {
		const { refAs, store, keys, byteHooks } = setup();
		await refAs(UPLOAD_A);
		let later: Promise<unknown> = Promise.resolve();
		byteHooks.onDelete = async () => {
			await refAs(UPLOAD_B);
			await store.unrefAll({ uploadId: UPLOAD_B });
			later = refAs(UPLOAD_C);
			await later;
		};

		await store.unrefAll({ uploadId: UPLOAD_A });

		assert.deepEqual(await later, { sha256: SHA, generation: 3, key: objectKey({ sha256: SHA, generation: 3 }) });
		assert.deepEqual([...keys], [objectKey({ sha256: SHA, generation: 3 })]);
	});

	it("does nothing on a live meta", async () => {
		const { refAs, store, metas, keys } = setup();
		await refAs(UPLOAD_A);

		await store.gc({ sha256: SHA });

		assert.equal(metas.get(SHA)?.state, "live");
		assert.deepEqual([...keys], [GEN_1]);
	});

	it("does nothing on an absent meta", async () => {
		const { store, keys } = setup();

		await store.gc({ sha256: SHA });

		assert.equal(keys.size, 0);
	});
});

describe("initMediaObjectStore", () => {
	it("reads the meta from the media table", async () => {
		const sent: { name: string; input: Record<string, unknown> }[] = [];
		const record = async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
			sent.push({ name: command.constructor.name, input: command.input });
			return {};
		};
		const client: Pick<DynamoDBDocumentClient, "send"> = {
			send: record as unknown as DynamoDBDocumentClient["send"],
		};
		const s3: Pick<S3Client, "send"> = { send: record as unknown as S3Client["send"] };
		const store = initMediaObjectStore({ client, tableName: "hutch-media-test", s3, bucketName: "media-test" });

		await store.gc({ sha256: SHA });

		assert.deepEqual(sent, [
			{
				name: "GetCommand",
				input: { TableName: "hutch-media-test", Key: { pk: `object#${SHA}`, sk: "meta" }, ConsistentRead: true },
			},
		]);
	});
});
