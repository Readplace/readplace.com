export interface QueueRenameResponse {
	status: number;
	json: () => Promise<unknown>;
}

export interface QueueRenameDeps {
	document: Document;
	fetchFn: (url: string, init: RequestInit) => Promise<QueueRenameResponse>;
	currentUrl: () => string;
	replaceUrl: (url: string) => void;
	selectAllIn: (element: HTMLElement) => void;
	placeCaretAtEnd: (element: HTMLElement) => void;
	announceToast: (toast: Element) => void;
	addSwapListener: (listener: () => void) => void;
}

const RENAME_SELECTOR = "[data-queue-rename]";
const ACTION_ATTR = "data-queue-rename";
const FIELD_ATTR = "data-queue-rename-field";
const MAX_ATTR = "data-queue-label-max";
const EDITING_CLASS = "queue-nav__link--editing";
const TITLE_SELECTOR = ".queue__title";
const CREATED_FLASH_SELECTOR = ".queue__created-flash";
const TOAST_MOUNT_SELECTOR = "#status-toast";
const LIVE_REGION_SELECTOR = "#toast-live-region";
const CREATED_PARAM = "created";
const TOAST_DISMISS_MS = 6000;
const GENERIC_FAILURE = "Couldn't rename the queue.";
const SITE_TITLE_SUFFIX = " — Readplace";

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function textOf(element: HTMLElement): string {
	const text = element.textContent;
	assert(text !== null, "an element's text content is never null");
	return text;
}

function attributeOf(element: HTMLElement, name: string): string {
	const value = element.getAttribute(name);
	assert(value, `a renameable queue tab must carry ${name}`);
	return value;
}

function messageOf(body: unknown): string | undefined {
	const message = Reflect.get(Object(body), "message");
	return typeof message === "string" ? message : undefined;
}

function renameRequest(field: string, label: string): RequestInit {
	const body = new URLSearchParams();
	body.append(field, label);
	return {
		method: "POST",
		credentials: "same-origin",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			Accept: "application/json",
		},
		body: body.toString(),
		keepalive: true,
	};
}

export function initQueueRename(deps: QueueRenameDeps): void {
	const bound = new WeakSet<Element>();

	function setText(selector: string, text: string): void {
		const nodes = deps.document.querySelectorAll(selector);
		for (let i = 0; i < nodes.length; i++) nodes[i].textContent = text;
	}

	function removeNodes(selector: string): void {
		const nodes = deps.document.querySelectorAll(selector);
		for (let i = 0; i < nodes.length; i++) nodes[i].remove();
	}

	function showToast(message: string): void {
		const mounts = deps.document.querySelectorAll(TOAST_MOUNT_SELECTOR);
		for (let i = 0; i < mounts.length; i++) {
			const toast = deps.document.createElement("div");
			toast.className = "toast";
			toast.setAttribute("tabindex", "-1");
			toast.setAttribute("data-dismiss", String(TOAST_DISMISS_MS));
			const text = deps.document.createElement("span");
			text.className = "toast__message";
			text.textContent = message;
			toast.appendChild(text);
			mounts[i].replaceChildren(toast);
			deps.announceToast(toast);
		}
	}

	function forgetCreatedParam(): void {
		const url = new URL(deps.currentUrl());
		url.searchParams.delete(CREATED_PARAM);
		deps.replaceUrl(`${url.pathname}${url.search}${url.hash}`);
	}

	function bind(tab: HTMLElement): void {
		if (bound.has(tab)) return;
		bound.add(tab);

		const action = attributeOf(tab, ACTION_ATTR);
		const field = attributeOf(tab, FIELD_ATTR);
		const max = Number(attributeOf(tab, MAX_ATTR));

		const defaultLabel = textOf(tab);
		let settled = false;

		function stopEditing(): void {
			tab.removeAttribute(ACTION_ATTR);
			tab.removeAttribute("contenteditable");
			tab.removeAttribute("role");
			tab.removeAttribute("aria-label");
			tab.removeAttribute("spellcheck");
			tab.classList.remove(EDITING_CLASS);
		}

		function revert(): void {
			settled = true;
			tab.textContent = defaultLabel;
			stopEditing();
		}

		function succeed(label: string): void {
			setText(TITLE_SELECTOR, label);
			removeNodes(CREATED_FLASH_SELECTOR);
			deps.document.title = `${label}${SITE_TITLE_SUFFIX}`;
			setText(LIVE_REGION_SELECTOR, `Queue renamed to ${label}.`);
			tab.textContent = label;
			stopEditing();
		}

		function fail(message: string | undefined): void {
			settled = false;
			showToast(message ?? GENERIC_FAILURE);
			tab.focus();
		}

		function apply(): void {
			if (settled) return;
			const label = textOf(tab).trim();
			if (label === "") {
				revert();
				return;
			}
			if (label === defaultLabel) {
				settled = true;
				stopEditing();
				return;
			}
			settled = true;
			deps.fetchFn(action, renameRequest(field, label)).then(
				(response) => {
					if (response.status === 200) {
						succeed(label);
						return;
					}
					return response.json().then(
						(body) => fail(messageOf(body)),
						() => fail(undefined),
					);
				},
				() => fail(undefined),
			);
		}

		tab.addEventListener("keydown", (event) => {
			if (event.key === "Enter") {
				event.preventDefault();
				apply();
				return;
			}
			if (event.key === "Escape") {
				event.preventDefault();
				revert();
			}
		});
		tab.addEventListener("blur", apply);
		tab.addEventListener("input", () => {
			const text = textOf(tab);
			if (text.length <= max) return;
			tab.textContent = text.slice(0, max);
			deps.placeCaretAtEnd(tab);
		});

		tab.setAttribute("contenteditable", "true");
		tab.setAttribute("role", "textbox");
		tab.setAttribute("aria-label", "Queue name");
		tab.setAttribute("spellcheck", "false");
		tab.setAttribute("tabindex", "-1");
		tab.classList.add(EDITING_CLASS);
		forgetCreatedParam();
		tab.focus();
		deps.selectAllIn(tab);
	}

	function scan(): void {
		const tabs = deps.document.querySelectorAll<HTMLElement>(RENAME_SELECTOR);
		for (let i = 0; i < tabs.length; i++) bind(tabs[i]);
	}

	scan();
	deps.addSwapListener(scan);
}
