import {
	OFFLINE_OWNER_EXPIRES_HEADER,
	OFFLINE_OWNER_HEADER,
	OFFLINE_OWNER_MARKER_PATH,
	isFreshOfflineCopy,
} from "./offline-cache";

interface OwnedCopy {
	headers: { get(name: string): string | null };
}

interface OwnedCache<R extends OwnedCopy> {
	match(key: string, options: { ignoreVary: true }): Promise<R | undefined>;
	put(key: string, response: R): Promise<void>;
	delete(key: string): Promise<boolean>;
	keys(): Promise<ReadonlyArray<{ url: string }>>;
}

interface OfflineOwnership<R extends OwnedCopy> {
	adopt(cache: OwnedCache<R>, answer: R): Promise<void>;
	confirmedOwner(cache: OwnedCache<R>): Promise<string | undefined>;
	isOwnedBy(copy: R, owner: string): boolean;
}

export function initOfflineOwnership<R extends OwnedCopy>(deps: {
	origin: string;
	now: () => number;
	markOwner: (answer: R, savedAt: number) => R;
}): OfflineOwnership<R> {
	const markerKey = `${deps.origin}${OFFLINE_OWNER_MARKER_PATH}`;

	async function purge(cache: OwnedCache<R>): Promise<void> {
		for (const entry of await cache.keys()) await cache.delete(entry.url);
	}

	return {
		async adopt(cache, answer) {
			const owner = answer.headers.get(OFFLINE_OWNER_HEADER);
			const marker = await cache.match(markerKey, { ignoreVary: true });
			if (owner === null || marker?.headers.get(OFFLINE_OWNER_HEADER) !== owner) await purge(cache);
			if (owner !== null) await cache.put(markerKey, deps.markOwner(answer, deps.now()));
		},

		async confirmedOwner(cache) {
			const marker = await cache.match(markerKey, { ignoreVary: true });
			if (marker === undefined) return undefined;
			const expiresAtMs = Number(marker.headers.get(OFFLINE_OWNER_EXPIRES_HEADER)) * 1000;
			if (deps.now() < expiresAtMs && isFreshOfflineCopy(marker, deps.now())) {
				return String(marker.headers.get(OFFLINE_OWNER_HEADER));
			}
			await purge(cache);
			return undefined;
		},

		isOwnedBy(copy, owner) {
			return copy.headers.get(OFFLINE_OWNER_HEADER) === owner;
		},
	};
}
