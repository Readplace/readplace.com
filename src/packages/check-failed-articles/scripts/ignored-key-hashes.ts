const INVALID_LIST =
	"FAILED_ARTICLES_IGNORED_KEY_HASHES must be a JSON array of unique lowercase SHA-256 hex digests";

export function parseIgnoredKeyHashes(raw: string | undefined): ReadonlySet<string> {
	if (raw === undefined || raw === "") {
		throw new Error("FAILED_ARTICLES_IGNORED_KEY_HASHES is required (use [] for an empty list)");
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error(INVALID_LIST);
	}
	if (!Array.isArray(parsed)) throw new Error(INVALID_LIST);
	const hashes = new Set<string>();
	for (const hash of parsed) {
		if (typeof hash !== "string" || hash.length !== 64 || /[^0-9a-f]/.test(hash) || hashes.has(hash)) {
			throw new Error(INVALID_LIST);
		}
		hashes.add(hash);
	}
	return hashes;
}
