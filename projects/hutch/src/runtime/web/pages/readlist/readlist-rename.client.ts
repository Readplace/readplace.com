export interface ReadlistRenameResponse {
	status: number;
	json: () => Promise<unknown>;
}

export interface ReadlistRenameDeps {
	document: Document;
	fetchFn: (url: string, init: RequestInit) => Promise<ReadlistRenameResponse>;
	placeCaretAtEnd: (element: HTMLElement) => void;
	announceToast: (toast: Element) => void;
	addSwapListener: (listener: () => void) => void;
}

const ACTION_ATTR = "data-readlist-rename";
const FIELD_ATTR = "data-readlist-rename-field";
const MAX_ATTR = "data-readlist-label-max";
const RENAME_SELECTOR = `[${ACTION_ATTR}]`;
const LABEL_SELECTOR = ".readlist-nav__label";
const EDITING_CLASS = "readlist-nav__link--editing";
const TOAST_MOUNT_SELECTOR = "#status-toast";
const LIVE_REGION_SELECTOR = "#toast-live-region";
const TOAST_DISMISS_MS = 6000;
const GENERIC_FAILURE = "Couldn't rename the readlist.";
const SITE_TITLE_SUFFIX = " — Readplace";

interface ReadlistRenameEdit {
	tab: HTMLElement;
	label: HTMLElement;
	href: string;
	action: string;
	field: string;
	max: number;
	openedWith: string;
	pending: boolean;
	sent: string | undefined;
	awaiting: string | undefined;
	handBackFocus: boolean;
}

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function isElement(node: EventTarget | null): node is Element {
	return typeof Reflect.get(Object(node), "closest") === "function";
}

function textOf(element: HTMLElement): string {
	const text = element.textContent;
	assert(text !== null, "an element's text content is never null");
	return text;
}

function attributeOf(element: HTMLElement, name: string): string {
	const value = element.getAttribute(name);
	assert(value, `a renameable readlist tab must carry ${name}`);
	return value;
}

function stringField(body: unknown, field: string): string | undefined {
	const value = Reflect.get(Object(body), field);
	return typeof value === "string" ? value : undefined;
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

export function initReadlistRename(deps: ReadlistRenameDeps): void {
	let editing: ReadlistRenameEdit | null = null;

	function setText(selector: string, text: string): void {
		const nodes = deps.document.querySelectorAll(selector);
		for (let i = 0; i < nodes.length; i++) nodes[i].textContent = text;
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

	function startEditing(tab: HTMLElement): void {
		const label = tab.querySelector<HTMLElement>(LABEL_SELECTOR);
		assert(label, "a renameable readlist tab must carry its name in an element of its own");
		editing = {
			tab,
			label,
			href: attributeOf(tab, "href"),
			action: attributeOf(tab, ACTION_ATTR),
			field: attributeOf(tab, FIELD_ATTR),
			max: Number(attributeOf(tab, MAX_ATTR)),
			openedWith: textOf(label),
			pending: false,
			sent: undefined,
			awaiting: undefined,
			handBackFocus: false,
		};
		label.setAttribute("contenteditable", "true");
		label.setAttribute("role", "textbox");
		label.setAttribute("aria-label", "Readlist name");
		label.setAttribute("spellcheck", "false");
		tab.classList.add(EDITING_CLASS);
		label.focus();
		tab.removeAttribute("href");
	}

	function finishEditing(): void {
		const edit = editing;
		if (edit === null) return;
		editing = null;
		edit.label.removeAttribute("contenteditable");
		edit.label.removeAttribute("role");
		edit.label.removeAttribute("aria-label");
		edit.label.removeAttribute("spellcheck");
		edit.tab.setAttribute("href", edit.href);
		edit.tab.classList.remove(EDITING_CLASS);
		if (edit.handBackFocus) edit.tab.focus();
	}

	function revert(): void {
		const edit = editing;
		if (edit === null) return;
		edit.label.textContent = edit.openedWith;
		finishEditing();
	}

	function succeed(action: string, label: string): void {
		setText(`[${ACTION_ATTR}="${action}"] ${LABEL_SELECTOR}`, label);
		setText(LIVE_REGION_SELECTOR, `Readlist renamed to ${label}.`);
		deps.document.title = `${label}${SITE_TITLE_SUFFIX}`;
		finishEditing();
	}

	function fail(edit: ReadlistRenameEdit, message: string | undefined): void {
		edit.pending = false;
		edit.awaiting = undefined;
		showToast(message ?? GENERIC_FAILURE);
		edit.label.focus();
	}

	function send(edit: ReadlistRenameEdit, label: string): void {
		edit.pending = true;
		edit.sent = label;
		deps.fetchFn(edit.action, renameRequest(edit.field, label)).then(
			(response) =>
				response.json().then(
					(body) => answer(edit, response.status, body),
					() => answer(edit, response.status, undefined),
				),
			() => fail(edit, undefined),
		);
	}

	function answer(edit: ReadlistRenameEdit, status: number, body: unknown): void {
		const stored = stringField(body, "label");
		if (status === 200 && stored) {
			const awaiting = edit.awaiting;
			edit.awaiting = undefined;
			if (awaiting !== undefined) {
				send(edit, awaiting);
				return;
			}
			succeed(edit.action, stored);
			return;
		}
		fail(edit, stringField(body, "message"));
	}

	function commit(): void {
		const edit = editing;
		if (edit === null) return;
		const label = textOf(edit.label).trim();
		if (label === "") {
			revert();
			return;
		}
		if (edit.pending) {
			edit.awaiting = label === edit.sent ? undefined : label;
			return;
		}
		if (label === edit.openedWith) {
			finishEditing();
			return;
		}
		send(edit, label);
	}

	deps.document.addEventListener("click", (event) => {
		if ([event.metaKey, event.ctrlKey, event.shiftKey, event.altKey].includes(true)) return;
		const target = event.target;
		if (!isElement(target)) return;
		const tab = target.closest<HTMLElement>(RENAME_SELECTOR);
		if (tab === null) return;
		if (editing !== null) return;
		event.preventDefault();
		startEditing(tab);
	});

	deps.document.addEventListener("keydown", (event) => {
		const edit = editing;
		if (edit === null) return;
		if (event.key === "Enter") {
			event.preventDefault();
			edit.handBackFocus = true;
			commit();
			return;
		}
		if (event.key === "Escape") {
			event.preventDefault();
			edit.handBackFocus = true;
			revert();
		}
	});

	deps.document.addEventListener("input", () => {
		const edit = editing;
		if (edit === null) return;
		const text = textOf(edit.label);
		if (text.length <= edit.max) return;
		edit.label.textContent = text.slice(0, edit.max);
		deps.placeCaretAtEnd(edit.label);
	});

	deps.document.addEventListener("focusout", (event) => {
		const edit = editing;
		if (edit === null) return;
		if (event.target !== edit.label) return;
		edit.handBackFocus = false;
		commit();
	});

	deps.addSwapListener(() => {
		const edit = editing;
		if (edit === null) return;
		if (deps.document.contains(edit.label)) return;
		editing = null;
	});
}
