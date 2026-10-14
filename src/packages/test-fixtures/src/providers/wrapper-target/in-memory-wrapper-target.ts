export type InMemoryWrapperTarget = {
	resolveWrapperTarget: (url: string) => Promise<{ url: string; contentSourceUrl?: string } | { ownOriginal: true } | undefined>;
	targets: Map<string, string>;
	ownOriginals: Set<string>;
	calls: string[];
};

export function initInMemoryWrapperTarget(): InMemoryWrapperTarget {
	const targets = new Map<string, string>();
	const ownOriginals = new Set<string>();
	const calls: string[] = [];
	return {
		targets,
		ownOriginals,
		calls,
		resolveWrapperTarget: async (url) => {
			calls.push(url);
			if (ownOriginals.has(url)) return { ownOriginal: true };
			const target = targets.get(url);
			return target === undefined ? undefined : { url: target };
		},
	};
}
