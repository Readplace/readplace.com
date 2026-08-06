export interface ReaderExitConfirmDeps {
	document: Document;
	supportsPopover: () => boolean;
	showPopover: (panel: Element) => void;
	hidePopover: (panel: Element) => void;
	fetchFn: (url: string, init: RequestInit) => Promise<unknown>;
	navigate: (href: string) => void;
}

interface PendingExit {
	href: string;
	panel: Element;
}

const PANEL_ID = "reader-exit-confirm";
const FORM_SELECTOR = ".reader-confirm__form";
const NO_SELECTOR = ".reader-confirm__cta--no";
const BOUND_FLAG = "data-reader-exit-confirm-bound";
const EXIT_SCOPES = [".article-body__content", ".related-slot__list"];
const SAME_TAB_TARGETS = ["", "_self", "_top"];
const FOLLOWED_PROTOCOLS = ["http:", "https:"];

function isElement(node: EventTarget | null): node is Element {
	return typeof Reflect.get(Object(node), "closest") === "function";
}

function isExitLink(anchor: HTMLAnchorElement): boolean {
	const rawHref = anchor.getAttribute("href");
	if (rawHref === null) return false;
	if (rawHref === "") return false;
	if (rawHref.charAt(0) === "#") return false;
	// Browsers match target keywords ASCII case-insensitively, so a crawled
	// target="_TOP" still navigates this tab and must be intercepted too.
	if (!SAME_TAB_TARGETS.includes(anchor.target.toLowerCase())) return false;
	if (!FOLLOWED_PROTOCOLS.includes(anchor.protocol)) return false;
	return EXIT_SCOPES.some((scope) => anchor.closest(scope) !== null);
}

function markReadRequest(form: HTMLFormElement): RequestInit {
	const body = new URLSearchParams();
	const fields = form.querySelectorAll<HTMLInputElement>("input[name]");
	for (let i = 0; i < fields.length; i++) {
		body.append(fields[i].name, fields[i].value);
	}
	return {
		method: "POST",
		credentials: "same-origin",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: body.toString(),
		keepalive: true,
		redirect: "manual",
	};
}

function noop(): void {}

export function initReaderExitConfirm(deps: ReaderExitConfirmDeps): void {
	let pending: PendingExit | null = null;

	function takePending(): PendingExit | null {
		const decision = pending;
		pending = null;
		return decision;
	}

	function bindDismissal(panel: HTMLElement): void {
		if (panel.getAttribute(BOUND_FLAG) === "true") return;
		panel.setAttribute(BOUND_FLAG, "true");
		panel.addEventListener("toggle", (event) => {
			if (event.newState === "closed") pending = null;
		});
	}

	function leave(decision: PendingExit): void {
		deps.hidePopover(decision.panel);
		deps.navigate(decision.href);
	}

	deps.document.addEventListener(
		"click",
		(event) => {
			const target = event.target;
			if (!isElement(target)) return;

			if (target.closest(NO_SELECTOR) !== null) {
				const declined = takePending();
				if (declined !== null) leave(declined);
				return;
			}

			const panel = deps.document.getElementById(PANEL_ID);
			if (panel === null) return;
			if (!deps.supportsPopover()) return;
			if (event.defaultPrevented) return;
			if (event.button !== 0) return;
			if ([event.metaKey, event.ctrlKey, event.shiftKey, event.altKey].includes(true)) return;

			const anchor = target.closest<HTMLAnchorElement>("a");
			if (anchor === null) return;
			if (!isExitLink(anchor)) return;

			pending = { href: anchor.href, panel };
			event.preventDefault();
			event.stopPropagation();
			bindDismissal(panel);
			deps.showPopover(panel);
		},
		true,
	);

	deps.document.addEventListener("submit", (event) => {
		const target = event.target;
		if (!isElement(target)) return;
		const form = target.closest<HTMLFormElement>(FORM_SELECTOR);
		if (form === null) return;
		event.preventDefault();
		const accepted = takePending();
		if (accepted === null) return;
		deps.fetchFn(form.action, markReadRequest(form)).then(noop, noop);
		leave(accepted);
	});
}
