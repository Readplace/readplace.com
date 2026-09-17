export interface ReadlistDesignResponse {
	status: number;
	json: () => Promise<unknown>;
}

export interface ReadlistDesignDeps {
	document: Document;
	fetchFn: (url: string, init: RequestInit) => Promise<ReadlistDesignResponse>;
	reload: () => void;
}

const MENU_SELECTOR = ".readlist-design-nav__menu, .readlist-design-card__menu";
const RENAME_FORM_ATTR = "data-readlist-design-rename";
const RENAME_ERROR_ATTR = "data-readlist-design-rename-error";
const ERROR_HIDDEN_CLASS = "readlist-design-rename__error--hidden";
const ERROR_VISIBLE_CLASS = "readlist-design-rename__error--visible";
const GENERIC_FAILURE = "Couldn't rename the readlist.";

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function isElement(node: EventTarget | null): node is Element {
	return typeof Reflect.get(Object(node), "closest") === "function";
}

function stringField(body: unknown, field: string): string | undefined {
	const value = Reflect.get(Object(body), field);
	return typeof value === "string" ? value : undefined;
}

function closeOpenMenus(document: Document, except: Element | null): void {
	const menus = document.querySelectorAll<HTMLDetailsElement>(MENU_SELECTOR);
	for (let i = 0; i < menus.length; i++) {
		if (menus[i] !== except) menus[i].open = false;
	}
}

function showError(form: HTMLFormElement, message: string): void {
	const error = form.querySelector(`[${RENAME_ERROR_ATTR}]`);
	assert(error, "a rename form always carries its error line");
	error.textContent = message;
	error.classList.remove(ERROR_HIDDEN_CLASS);
	error.classList.add(ERROR_VISIBLE_CLASS);
}

function renameRequest(form: HTMLFormElement): RequestInit {
	const body = new URLSearchParams();
	const fields = form.querySelectorAll<HTMLInputElement>("input[name]");
	for (let i = 0; i < fields.length; i++) body.append(fields[i].name, fields[i].value);
	return {
		method: "POST",
		credentials: "same-origin",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			Accept: "application/json",
		},
		body: body.toString(),
	};
}

export function initReadlistDesign(deps: ReadlistDesignDeps): void {
	deps.document.addEventListener("click", (event) => {
		const target = event.target;
		const within = isElement(target) ? target.closest(MENU_SELECTOR) : null;
		closeOpenMenus(deps.document, within);
	});

	deps.document.addEventListener("keydown", (event) => {
		if (event.key === "Escape") closeOpenMenus(deps.document, null);
	});

	deps.document.addEventListener("submit", (event) => {
		const target = event.target;
		if (!isElement(target)) return;
		const form = target.closest("form");
		if (form === null || !form.hasAttribute(RENAME_FORM_ATTR)) return;
		event.preventDefault();
		const action = form.getAttribute("action");
		assert(action, "the rename form always posts somewhere");
		deps.fetchFn(action, renameRequest(form)).then(
			(response) =>
				response.json().then(
					(body) => {
						if (response.status === 200 && stringField(body, "label")) {
							deps.reload();
							return;
						}
						showError(form, stringField(body, "message") ?? GENERIC_FAILURE);
					},
					() => showError(form, GENERIC_FAILURE),
				),
			() => showError(form, GENERIC_FAILURE),
		);
	});
}
