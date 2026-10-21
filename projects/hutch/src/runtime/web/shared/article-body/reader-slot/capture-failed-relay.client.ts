const CAPTURE_FAILED_EVENT = "readplace-capture-failed";
const CAPTURE_STARTED_EVENT = "readplace-capture-started";
const GIVE_UP_NOTICE = `[hx-trigger^="${CAPTURE_FAILED_EVENT}"]`;

type PageNode = { parentNode: PageNode | null };

export type CaptureFailedRelayDocument = {
	addEventListener(type: string, listener: (event: { target: unknown }) => void): void;
	querySelector(selectors: string): PageNode | null;
};

function within(params: { node: PageNode; ancestor: unknown }): boolean {
	for (let node: PageNode | null = params.node; node; node = node.parentNode) {
		if (node === params.ancestor) return true;
	}
	return false;
}

export function initCaptureFailedRelay(deps: {
	document: CaptureFailedRelayDocument;
	isCaptureControl: (target: unknown) => boolean;
	dispatchCaptureFailed: () => void;
}): void {
	let loadedNotice: PageNode | null = null;
	let held = false;

	deps.document.addEventListener("htmx:load", (event) => {
		const notice = deps.document.querySelector(GIVE_UP_NOTICE);
		if (!notice || !within({ node: notice, ancestor: event.target })) return;
		loadedNotice = notice;
		if (!held) return;
		held = false;
		deps.dispatchCaptureFailed();
	});

	deps.document.addEventListener(CAPTURE_FAILED_EVENT, () => {
		const notice = deps.document.querySelector(GIVE_UP_NOTICE);
		if (notice && notice === loadedNotice) return;
		held = true;
	});

	deps.document.addEventListener(CAPTURE_STARTED_EVENT, () => {
		held = false;
	});

	deps.document.addEventListener("click", (event) => {
		if (deps.isCaptureControl(event.target)) held = false;
	});
}
