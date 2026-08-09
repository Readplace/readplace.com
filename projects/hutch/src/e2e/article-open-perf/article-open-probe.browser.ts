export interface ArticleOpenProbeResult {
	elapsedMs: number;
	documentHopMs: number;
	sameDocument: boolean;
}

export interface ArticleOpenProbeConfig {
	pendingKey: string;
	titleSelector: string;
	bodySelector: string;
}

declare global {
	interface Window {
		readplaceArticleOpen?: ArticleOpenProbeResult;
	}
}

/**
 * Both ends of a sample are taken in-page, so no WebDriver round trip is inside
 * the measured window.
 *
 * The start has to outlive the document that recorded it, because an unboosted
 * open destroys it. `performance.timeOrigin + performance.now()` is the one
 * clock both documents can read the same value from: `now()` is per-document,
 * but `timeOrigin` is that document's offset into the same monotonic clock, so
 * the sum is comparable across the navigation. sessionStorage carries it because
 * it survives a same-origin navigation and dies with the tab.
 *
 * A boosted open never leaves the document, so it reads the start back from the
 * closure and only touches sessionStorage to clean up. Every other line — the
 * capture-phase click that starts the clock, and the rAF loop that stops it on
 * the first frame the article body has a laid-out box — is shared, which is what
 * makes the two arms comparable.
 */
export function installArticleOpenProbe(config: ArticleOpenProbeConfig): void {
	const documentId = `${performance.timeOrigin}:${Math.random()}`;
	const nowAbsMs = () => performance.timeOrigin + performance.now();

	function settle(pending: { startAbsMs: number; documentId: string }): boolean {
		const body = document.querySelector(config.bodySelector);
		if (!body) return false;
		if (body.getBoundingClientRect().height <= 0) return false;
		window.sessionStorage.removeItem(config.pendingKey);
		window.readplaceArticleOpen = {
			elapsedMs: nowAbsMs() - pending.startAbsMs,
			documentHopMs: performance.timeOrigin - pending.startAbsMs,
			sameDocument: pending.documentId === documentId,
		};
		return true;
	}

	function watch(pending: { startAbsMs: number; documentId: string }): void {
		const tick = () => {
			if (settle(pending)) return;
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	}

	const pending = window.sessionStorage.getItem(config.pendingKey);
	if (pending !== null) watch(JSON.parse(pending));

	document.addEventListener(
		"click",
		(event) => {
			const target = event.target;
			if (!(target instanceof Element)) return;
			if (!target.closest(config.titleSelector)) return;
			const started = { startAbsMs: nowAbsMs(), documentId };
			window.sessionStorage.setItem(config.pendingKey, JSON.stringify(started));
			watch(started);
		},
		true,
	);
}
