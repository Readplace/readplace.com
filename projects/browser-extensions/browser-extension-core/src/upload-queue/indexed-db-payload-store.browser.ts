/// <reference lib="dom" />
import type { PayloadStore } from "./upload-queue.types";

const STORE_NAME = "payloads";

export function initIndexedDbPayloadStore(deps: { databaseName: string }): PayloadStore {
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
		work: (store: IDBObjectStore) => IDBRequest<T>,
	): Promise<T> {
		const db = await open();
		try {
			return await new Promise<T>((resolve, reject) => {
				const transaction = db.transaction(STORE_NAME, mode);
				const request = work(transaction.objectStore(STORE_NAME));
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
		} finally {
			db.close();
		}
	}

	return {
		async put({ id, blob }) {
			await run("readwrite", (store) => store.put(blob, id));
		},
		async get(id) {
			const stored = await run<unknown>("readonly", (store) => store.get(id));
			return stored instanceof Blob ? stored : undefined;
		},
		async remove(id) {
			await run("readwrite", (store) => store.delete(id));
		},
		async clear() {
			await run("readwrite", (store) => store.clear());
		},
	};
}
