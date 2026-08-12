/// <reference lib="dom" />
import type { BulkSaveJob } from "../bulk-save-queue/bulk-save-job";
import type { BulkSaveJobStore } from "../bulk-save-queue/bulk-save-queue";
import type { BulkPayloadStore, PayloadStore } from "./upload-queue.types";

const STORE_NAME = "payloads";
const JOBS_KEY = "jobs";

const RECOVERABLE_WRITE: IDBTransactionOptions = { durability: "relaxed" };

function initConnection(databaseName: string) {
	let opened: Promise<IDBDatabase> | undefined;

	function open(): Promise<IDBDatabase> {
		return new Promise((resolve, reject) => {
			const request = indexedDB.open(databaseName, 1);
			request.onupgradeneeded = () => {
				request.result.createObjectStore(STORE_NAME);
			};
			request.onsuccess = () => {
				const db = request.result;
				db.onclose = () => {
					opened = undefined;
				};
				db.onversionchange = () => {
					db.close();
					opened = undefined;
				};
				resolve(db);
			};
			request.onerror = () => reject(request.error);
		});
	}

	async function connect(): Promise<IDBDatabase> {
		if (!opened) opened = open();
		try {
			return await opened;
		} catch (error) {
			opened = undefined;
			throw error;
		}
	}

	async function run<T>(
		mode: IDBTransactionMode,
		work: (store: IDBObjectStore) => T,
		options?: IDBTransactionOptions,
	): Promise<T> {
		let db = await connect();
		let transaction: IDBTransaction;
		try {
			transaction = db.transaction(STORE_NAME, mode, options);
		} catch {
			opened = undefined;
			db = await connect();
			transaction = db.transaction(STORE_NAME, mode, options);
		}
		return new Promise<T>((resolve, reject) => {
			const result = work(transaction.objectStore(STORE_NAME));
			transaction.oncomplete = () => resolve(result);
			transaction.onabort = () => reject(transaction.error);
		});
	}

	return { run };
}

export function initIndexedDbBulkPayloadStore(deps: { databaseName: string }): BulkPayloadStore {
	const connection = initConnection(deps.databaseName);
	return {
		async putAll(items) {
			if (items.length === 0) return;
			await connection.run(
				"readwrite",
				(store) => {
					for (const { id, bytes } of items) store.put(bytes, id);
				},
				RECOVERABLE_WRITE,
			);
		},
		async getAll(ids) {
			if (ids.length === 0) return new Map();
			return connection.run("readonly", (store) => {
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
			await connection.run(
				"readwrite",
				(store) => {
					for (const id of ids) store.delete(id);
				},
				RECOVERABLE_WRITE,
			);
		},
		async clear() {
			await connection.run(
				"readwrite",
				(store) => {
					store.clear();
				},
				RECOVERABLE_WRITE,
			);
		},
	};
}

export function initIndexedDbBulkSaveJobStore(deps: { databaseName: string }): BulkSaveJobStore {
	const connection = initConnection(deps.databaseName);
	return {
		async read(): Promise<unknown> {
			const holder: { value: unknown } = { value: undefined };
			await connection.run("readonly", (store) => {
				const request = store.get(JOBS_KEY);
				request.onsuccess = () => {
					holder.value = request.result;
				};
			});
			return holder.value;
		},
		async write(jobs: BulkSaveJob[]): Promise<void> {
			await connection.run(
				"readwrite",
				(store) => {
					store.put(jobs, JOBS_KEY);
				},
				RECOVERABLE_WRITE,
			);
		},
	};
}

export function initIndexedDbPayloadStore(deps: { databaseName: string }): PayloadStore {
	const connection = initConnection(deps.databaseName);
	return {
		async put({ id, blob }) {
			await connection.run("readwrite", (store) => {
				store.put(blob, id);
			});
		},
		async get(id) {
			const holder: { value: unknown } = { value: undefined };
			await connection.run("readonly", (store) => {
				const request = store.get(id);
				request.onsuccess = () => {
					holder.value = request.result;
				};
			});
			return holder.value instanceof Blob ? holder.value : undefined;
		},
		async remove(id) {
			await connection.run("readwrite", (store) => {
				store.delete(id);
			});
		},
		async clear() {
			await connection.run("readwrite", (store) => {
				store.clear();
			});
		},
	};
}
