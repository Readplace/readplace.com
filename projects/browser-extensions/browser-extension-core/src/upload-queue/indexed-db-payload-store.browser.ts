/// <reference lib="dom" />
import type { BulkPayloadStore, PayloadStore } from "./upload-queue.types";

const STORE_NAME = "payloads";

export function initIndexedDbBulkPayloadStore(deps: { databaseName: string }): BulkPayloadStore {
	function open(): Promise<IDBDatabase> {
		return new Promise((resolve, reject) => {
			const request = indexedDB.open(deps.databaseName, 1);
			request.onupgradeneeded = () => {
				request.result.createObjectStore(STORE_NAME);
			};
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
	}

	async function run<T>(
		mode: IDBTransactionMode,
		work: (store: IDBObjectStore) => T,
	): Promise<T> {
		const db = await open();
		try {
			return await new Promise<T>((resolve, reject) => {
				const transaction = db.transaction(STORE_NAME, mode);
				const result = work(transaction.objectStore(STORE_NAME));
				transaction.oncomplete = () => resolve(result);
				transaction.onabort = () => reject(transaction.error);
			});
		} finally {
			db.close();
		}
	}

	return {
		async putAll(items) {
			if (items.length === 0) return;
			await run("readwrite", (store) => {
				for (const { id, blob } of items) store.put(blob, id);
			});
		},
		async getAll(ids) {
			if (ids.length === 0) return new Map();
			return run("readonly", (store) => {
				const found = new Map<string, Blob>();
				for (const id of ids) {
					const request = store.get(id);
					request.onsuccess = () => {
						if (request.result instanceof Blob) found.set(id, request.result);
					};
				}
				return found;
			});
		},
		async removeAll(ids) {
			if (ids.length === 0) return;
			await run("readwrite", (store) => {
				for (const id of ids) store.delete(id);
			});
		},
		async clear() {
			await run("readwrite", (store) => {
				store.clear();
			});
		},
	};
}

export function initIndexedDbPayloadStore(deps: { databaseName: string }): PayloadStore {
	const bulk = initIndexedDbBulkPayloadStore(deps);
	return {
		put: ({ id, blob }) => bulk.putAll([{ id, blob }]),
		get: async (id) => (await bulk.getAll([id])).get(id),
		remove: (id) => bulk.removeAll([id]),
		clear: () => bulk.clear(),
	};
}
