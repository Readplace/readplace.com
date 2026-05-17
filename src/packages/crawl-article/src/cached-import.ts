/**
 * Wraps a dynamic `import()` (or any async factory) so the module loads at
 * most once per process lifetime. Subsequent calls return the same promise.
 *
 * Useful for ESM-only packages consumed from CommonJS entry points where the
 * dynamic import is expensive (~50–200 ms depending on Lambda memory tier).
 */
export function cachedImport<T>(load: () => Promise<T>): () => Promise<T> {
	let cached: Promise<T> | undefined;
	return () => {
		if (!cached) {
			cached = load();
		}
		return cached;
	};
}
