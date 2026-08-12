/// <reference lib="dom" />
import type { BulkPayloadStore, PayloadStore } from "./upload-queue.types";

const STORE_NAME = "payloads";

function openDatabase(databaseName: string): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(databaseName, 1);
		request.onupgradeneeded = () => {
			request.result.createObjectStore(STORE_NAME);
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

async function inOneTransaction<T>(
	databaseName: string,
	mode: IDBTransactionMode,
	work: (store: IDBObjectStore) => T,
	options?: IDBTransactionOptions,
): Promise<T> {
	const db = await openDatabase(databaseName);
	try {
		return await new Promise<T>((resolve, reject) => {
			const transaction = db.transaction(STORE_NAME, mode, options);
			const result = work(transaction.objectStore(STORE_NAME));
			transaction.oncomplete = () => resolve(result);
			transaction.onabort = () => reject(transaction.error);
		});
	} finally {
		db.close();
	}
}

const RECOVERABLE_WRITE: IDBTransactionOptions = { durability: "relaxed" };

export function initIndexedDbBulkPayloadStore(deps: { databaseName: string }): BulkPayloadStore {
	return {
		async putAll(items) {
			if (items.length === 0) return;
			await inOneTransaction(
				deps.databaseName,
				"readwrite",
				(store) => {
					for (const { id, bytes } of items) store.put(bytes, id);
				},
				RECOVERABLE_WRITE,
			);
		},
		async getAll(ids) {
			if (ids.length === 0) return new Map();
			return inOneTransaction(deps.databaseName, "readonly", (store) => {
				const found = new Map<string, ArrayBuffer>();
				for (const id of ids) {
					const request = store.get(id);
					request.onsuccess = () => {
						if (request.result instanceof ArrayBuffer) found.set(id, request.result);
					};
				}
				return found;
			});
		},
		async removeAll(ids) {
			if (ids.length === 0) return;
			await inOneTransaction(
				deps.databaseName,
				"readwrite",
				(store) => {
					for (const id of ids) store.delete(id);
				},
				RECOVERABLE_WRITE,
			);
		},
		async clear() {
			await inOneTransaction(
				deps.databaseName,
				"readwrite",
				(store) => {
					store.clear();
				},
				RECOVERABLE_WRITE,
			);
		},
	};
}

export function initIndexedDbPayloadStore(deps: { databaseName: string }): PayloadStore {
	return {
		async put({ id, blob }) {
			await inOneTransaction(deps.databaseName, "readwrite", (store) => {
				store.put(blob, id);
			});
		},
		async get(id) {
			const stored = await inOneTransaction(deps.databaseName, "readonly", (store) => {
				const request = store.get(id);
				const holder: { value: unknown } = { value: undefined };
				request.onsuccess = () => {
					holder.value = request.result;
				};
				return holder;
			});
			return stored.value instanceof Blob ? stored.value : undefined;
		},
		async remove(id) {
			await inOneTransaction(deps.databaseName, "readwrite", (store) => {
				store.delete(id);
			});
		},
		async clear() {
			await inOneTransaction(deps.databaseName, "readwrite", (store) => {
				store.clear();
			});
		},
	};
}
