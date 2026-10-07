export type InMemoryWrapperTarget = {
	resolveWrapperTarget: (url: string) => Promise<{ url: string; contentSourceUrl?: string } | undefined>;
	targets: Map<string, string>;
	calls: string[];
};

export function initInMemoryWrapperTarget(): InMemoryWrapperTarget {
	const targets = new Map<string, string>();
	const calls: string[] = [];
	return {
		targets,
		calls,
		resolveWrapperTarget: async (url) => {
			calls.push(url);
			const target = targets.get(url);
			return target === undefined ? undefined : { url: target };
		},
	};
}
