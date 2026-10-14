import { RESCUE_NOTICE_SELECTOR } from "./read-reader-rescue";
import { HTMX_LOAD_EVENT } from "./reader-rescue-message.types";

type PageNode = { parentNode: PageNode | null };

export type AnnouncerDocument = {
	addEventListener(type: string, listener: (event: { target: unknown }) => void): void;
	querySelector(selectors: string): PageNode | null;
};

function loadedWithin(params: { node: PageNode; loaded: unknown }): boolean {
	for (let node: PageNode | null = params.node; node; node = node.parentNode) {
		if (node === params.loaded) return true;
	}
	return false;
}

export function initAnnounceCaptureStarted(deps: { document: AnnouncerDocument; dispatch: () => void }): () => void {
	let loadedNotice: PageNode | null = null;
	let held = false;

	deps.document.addEventListener(HTMX_LOAD_EVENT, (event) => {
		const notice = deps.document.querySelector(RESCUE_NOTICE_SELECTOR);
		if (!notice || !loadedWithin({ node: notice, loaded: event.target })) return;
		loadedNotice = notice;
		if (!held) return;
		held = false;
		deps.dispatch();
	});

	return function announceCaptureStarted() {
		const notice = deps.document.querySelector(RESCUE_NOTICE_SELECTOR);
		if (notice && notice === loadedNotice) {
			deps.dispatch();
			return;
		}
		held = true;
	};
}
