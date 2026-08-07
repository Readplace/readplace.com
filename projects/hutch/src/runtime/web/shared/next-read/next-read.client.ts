interface NextReadDeps {
	document: Document;
	viewportHeight: () => number;
	addScrollListener: (listener: () => void) => void;
	removeScrollListener: (listener: () => void) => void;
	addSwapListener: (listener: () => void) => void;
	removeSwapListener: (listener: () => void) => void;
}

interface NextReadController {
	attach(): void;
	detach(): void;
}

export function initNextRead(deps: NextReadDeps): NextReadController {
	const READY_CLASS = "next-read--ready";
	const OPEN_CLASS = "next-read--open";

	let listener: (() => void) | null = null;

	function reachedArticleEnd(): boolean {
		const article = deps.document.querySelector("[data-article-body]");
		if (article === null) return false;
		return article.getBoundingClientRect().bottom <= deps.viewportHeight();
	}

	function evaluate(): void {
		const wrap = deps.document.querySelector("[data-next-read]");
		if (wrap === null) return;
		if (!wrap.classList.contains(READY_CLASS)) return;
		if (!reachedArticleEnd()) return;
		wrap.classList.add(OPEN_CLASS);
	}

	function attach(): void {
		if (listener !== null) return;
		listener = evaluate;
		deps.addScrollListener(listener);
		deps.addSwapListener(listener);
		evaluate();
	}

	function detach(): void {
		if (listener === null) return;
		deps.removeScrollListener(listener);
		deps.removeSwapListener(listener);
		listener = null;
	}

	return { attach, detach };
}
