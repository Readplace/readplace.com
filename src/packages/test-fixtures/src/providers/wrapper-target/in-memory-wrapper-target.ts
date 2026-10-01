export type InMemoryWrapperTarget = {
	resolveWrapperTarget: (url: string) => Promise<string | undefined>;
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
			return targets.get(url);
		},
	};
}
