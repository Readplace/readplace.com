interface BoostedPageBundleDeps {
	document: Document;
	selector: string;
	addSwapListener: (listener: (target: Element) => void) => void;
	create: () => () => void;
}

export function initBoostedPageBundle(deps: BoostedPageBundleDeps): void {
	function createIfPresent(): (() => void) | null {
		if (deps.document.querySelector(deps.selector) === null) return null;
		return deps.create();
	}

	let currentMain: Element | null = deps.document.querySelector("main");
	let cleanup = createIfPresent();
	deps.addSwapListener((target) => {
		if (target.tagName !== "MAIN") return;
		if (target === currentMain) return;
		currentMain = target;
		if (cleanup !== null) cleanup();
		cleanup = createIfPresent();
	});
}
