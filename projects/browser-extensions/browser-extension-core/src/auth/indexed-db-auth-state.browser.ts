/// <reference lib="dom" />
import type { AuthState, AuthStateStore } from "./auth-state.types";
import type { OAuthTokens } from "./auth.types";
import type { RefreshKey } from "./refresh-proof";

const DATABASE = "hutch-auth";
const STORE = "auth";
const KEY = "state";

export async function initIndexedDbAuthState(deps: {
	indexedDB: IDBFactory;
	loadLegacy: () => Promise<OAuthTokens | null>;
	removeLegacy: () => Promise<void>;
	createKey: () => Promise<RefreshKey>;
	uuid: () => string;
}): Promise<AuthStateStore> {
	let connection: Promise<IDBDatabase> | undefined;
	function connect(): Promise<IDBDatabase> {
		connection ??= new Promise((resolve, reject) => {
			const request = deps.indexedDB.open(DATABASE, 1);
			request.onupgradeneeded = () => request.result.createObjectStore(STORE);
			request.onerror = () => { connection = undefined; reject(request.error); };
			request.onsuccess = () => {
				const database = request.result;
				database.onversionchange = () => { database.close(); connection = undefined; };
				database.onclose = () => { connection = undefined; };
				resolve(database);
			};
		});
		return connection;
	}
	async function transaction<T>(mode: IDBTransactionMode, mutate: (state: AuthState | undefined) => { state: AuthState | undefined; value: T }): Promise<T> {
		const database = await connect();
		return new Promise((resolve, reject) => {
			const tx = database.transaction(STORE, mode, { durability: "strict" });
			const objectStore = tx.objectStore(STORE);
			const request: IDBRequest<AuthState | undefined> = objectStore.get(KEY);
			let result: { value: T };
			tx.onabort = () => reject(tx.error ?? new Error("Auth storage transaction aborted"));
			tx.oncomplete = () => resolve(result.value);
			request.onsuccess = () => {
				try {
					const changed = mutate(request.result);
					result = changed;
					if (mode === "readwrite") objectStore.put(changed.state, KEY);
				} catch (error) {
					tx.abort();
					reject(error);
				}
			};
		});
	}
	const existing = await transaction("readonly", state => ({ state, value: state }));
	if (!existing) {
		const legacy = await deps.loadLegacy();
		const key = await deps.createKey();
		await transaction("readwrite", state => ({
			state: state ?? {
				version: 1, installationId: deps.uuid(), epoch: deps.uuid(), key,
				credentials: legacy ? { ...legacy, bound: false } : null, pending: null, journal: [],
			},
			value: undefined,
		}));
	}
	await deps.removeLegacy();
	return {
		read: () => transaction("readonly", state => {
			if (!state) throw new Error("Auth state disappeared");
			return { state, value: state };
		}),
		update: mutate => transaction("readwrite", state => {
			if (!state) throw new Error("Auth state disappeared");
			return { state, value: mutate(state) };
		}),
	};
}
