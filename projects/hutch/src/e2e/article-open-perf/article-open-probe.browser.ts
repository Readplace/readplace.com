import type { ArticleOpenSample } from "./article-open-latency";

export interface ArticleOpenProbeConfig {
	pendingKey: string;
	titleSelector: string;
	bodySelector: string;
	endMarkerSelector: string;
	endMarkerText: string;
}

declare global {
	interface Window {
		readplaceArticleOpen?: ArticleOpenSample;
	}
}

export function installArticleOpenProbe(config: ArticleOpenProbeConfig): void {
	const documentId = `${performance.timeOrigin}:${Math.random()}`;
	const clockSharedAcrossDocumentsMs = () => performance.timeOrigin + performance.now();

	function wholeArticleLaidOut(): boolean {
		const body = document.querySelector(config.bodySelector);
		if (body === null) return false;
		const endOfBody = body.querySelector(config.endMarkerSelector);
		if (endOfBody === null) return false;
		if (endOfBody.textContent !== config.endMarkerText) return false;
		return endOfBody.getBoundingClientRect().height > 0;
	}

	function documentHop(): { unloadEventMs: number; preRequestMs: number } {
		const [entry] = performance.getEntriesByType("navigation");
		if (!(entry instanceof PerformanceNavigationTiming)) {
			throw new Error("a new-document open must expose a navigation timing entry");
		}
		return {
			unloadEventMs: entry.unloadEventEnd - entry.unloadEventStart,
			preRequestMs: entry.fetchStart - entry.redirectEnd,
		};
	}

	type Pending = { startAbsMs: number; documentId: string };

	function record(pending: Pending, resolutionMs: number): void {
		window.sessionStorage.removeItem(config.pendingKey);
		const elapsedMs = clockSharedAcrossDocumentsMs() - pending.startAbsMs;
		window.readplaceArticleOpen =
			pending.documentId === documentId
				? { elapsedMs, resolutionMs, sameDocument: true }
				: { elapsedMs, resolutionMs, sameDocument: false, ...documentHop() };
	}

	function watch(pending: Pending): void {
		let previousCheckAbsMs = clockSharedAcrossDocumentsMs();
		const tick = () => {
			const checkedAtAbsMs = clockSharedAcrossDocumentsMs();
			if (wholeArticleLaidOut()) {
				record(pending, checkedAtAbsMs - previousCheckAbsMs);
				return;
			}
			previousCheckAbsMs = checkedAtAbsMs;
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	}

	const carriedAcrossNavigation = window.sessionStorage.getItem(config.pendingKey);
	if (carriedAcrossNavigation !== null) watch(JSON.parse(carriedAcrossNavigation));

	document.addEventListener(
		"click",
		(event) => {
			const target = event.target;
			if (!(target instanceof Element)) return;
			if (!target.closest(config.titleSelector)) return;
			const started = { startAbsMs: clockSharedAcrossDocumentsMs(), documentId };
			window.sessionStorage.setItem(config.pendingKey, JSON.stringify(started));
			watch(started);
		},
		true,
	);
}
