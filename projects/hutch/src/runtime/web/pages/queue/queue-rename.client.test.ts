import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { type QueueRenameResponse, initQueueRename } from "./queue-rename.client";

interface RenameCall {
	url: string;
	init: RequestInit;
}

const RENAME_ACTION = "/queue/queues/new-queue/rename";

function tabMarkup(label = "New Queue"): string {
	return `<nav class="queue-nav"><ul class="queue-nav__list"><li><a class="queue-nav__link" href="/queue">My Queue</a></li><li><span class="queue-nav__link queue-nav__link--active" data-queue-rename="${RENAME_ACTION}" data-queue-rename-field="label" data-queue-label-max="24" data-test-queue="new-queue">${label}</span></li></ul></nav>`;
}

function pageMarkup(label?: string): string {
	return `${tabMarkup(label)}<p class="queue__created-flash">Created New Queue.</p><h1 class="queue__title">New Queue</h1><div id="status-toast"></div><div class="sr-only" id="toast-live-region"></div>`;
}

function init(
	bodyHtml: string,
	respond: (call: RenameCall) => Promise<QueueRenameResponse> = (call) =>
		Promise.resolve({
			status: 200,
			json: () =>
				Promise.resolve({ label: new URLSearchParams(String(call.init.body)).get("label") }),
		}),
) {
	const dom = new JSDOM(
		`<!DOCTYPE html><html><head><title>New Queue — Readplace</title></head><body>${bodyHtml}</body></html>`,
		{ url: "https://readplace.test/queue?feature=queues&created=new-queue" },
	);
	const document = dom.window.document;
	const calls: RenameCall[] = [];
	const selected: Element[] = [];
	const caretAtEnd: Element[] = [];
	const announced: Element[] = [];
	let url = dom.window.location.href;
	let swapListener: (() => void) | undefined;
	initQueueRename({
		document,
		fetchFn: (target, requestInit) => {
			const call = { url: target, init: requestInit };
			calls.push(call);
			return respond(call);
		},
		currentUrl: () => url,
		replaceUrl: (next) => {
			url = new URL(next, "https://readplace.test").href;
		},
		selectAllIn: (element) => selected.push(element),
		placeCaretAtEnd: (element) => caretAtEnd.push(element),
		announceToast: (toast) => announced.push(toast),
		addSwapListener: (listener) => {
			swapListener = listener;
		},
	});
	function tab(): HTMLElement {
		const element = document.querySelector<HTMLElement>('[data-test-queue="new-queue"]');
		assert(element, "the created queue's tab must be in the document");
		return element;
	}
	return {
		document,
		window: dom.window,
		calls,
		selected,
		caretAtEnd,
		announced,
		tab,
		currentUrl: () => url,
		type: (text: string) => {
			tab().textContent = text;
			tab().dispatchEvent(new dom.window.Event("input", { bubbles: true }));
		},
		press: (key: string) => {
			tab().dispatchEvent(new dom.window.KeyboardEvent("keydown", { key, bubbles: true }));
		},
		blur: () => {
			tab().dispatchEvent(new dom.window.Event("blur"));
		},
		swap: () => {
			assert(swapListener, "a swap listener must be registered");
			swapListener();
		},
	};
}

const settled = () => new Promise((resolve) => setImmediate(resolve));

describe("initQueueRename", () => {
	it("opens the just-created tab for editing with its text ready to be replaced", () => {
		const page = init(pageMarkup());

		const tab = page.tab();
		expect(tab.getAttribute("contenteditable")).toBe("true");
		expect(tab.getAttribute("role")).toBe("textbox");
		expect(tab.getAttribute("aria-label")).toBe("Queue name");
		expect(tab.classList.contains("queue-nav__link--editing")).toBe(true);
		expect(page.selected).toEqual([tab]);
		expect(page.document.activeElement).toBe(tab);
	});

	it("drops the naming marker from the address so a reload does not reopen it", () => {
		const page = init(pageMarkup());

		expect(page.currentUrl()).toBe("https://readplace.test/queue?feature=queues");
	});

	it("does nothing on a page with no queue to name", () => {
		const page = init(`<h1 class="queue__title">My Queue</h1>`);

		expect(page.calls).toEqual([]);
	});

	it("binds a tab that arrives in a swapped page, and only once", () => {
		const page = init(`<div id="status-toast"></div>`);
		page.document.body.insertAdjacentHTML("afterbegin", tabMarkup());

		page.swap();
		const boundOnce = page.selected.length;
		page.swap();

		expect(boundOnce).toBe(1);
		expect(page.selected).toHaveLength(1);
	});

	it("posts the typed name when the reader presses Enter", async () => {
		const page = init(pageMarkup());
		page.type("Work Reading");

		page.press("Enter");
		await settled();

		expect(page.calls).toHaveLength(1);
		expect(page.calls[0].url).toBe(RENAME_ACTION);
		expect(page.calls[0].init.method).toBe("POST");
		expect(page.calls[0].init.body).toBe("label=Work+Reading");
	});

	it("posts the typed name when the reader clicks away", async () => {
		const page = init(pageMarkup());
		page.type("Work Reading");

		page.blur();
		await settled();

		expect(page.calls).toHaveLength(1);
	});

	it("shows the name the server stored, not the one the reader typed", async () => {
		const page = init(pageMarkup(), () =>
			Promise.resolve({ status: 200, json: () => Promise.resolve({ label: "Work Reading 2" }) }),
		);
		page.type("Work Reading");

		page.press("Enter");
		await settled();

		expect(page.tab().textContent).toBe("Work Reading 2");
		expect(page.document.querySelector(".queue__title")?.textContent).toBe("Work Reading 2");
		expect(page.document.title).toBe("Work Reading 2 — Readplace");
		expect(page.document.querySelector("#toast-live-region")?.textContent).toBe(
			"Queue renamed to Work Reading 2.",
		);
	});

	it("asks the reader to try again when the answer carries no name to show", async () => {
		const page = init(pageMarkup(), () =>
			Promise.resolve({ status: 200, json: () => Promise.resolve({}) }),
		);
		page.type("Work Reading");

		page.press("Enter");
		await settled();

		expect(page.document.querySelector(".toast__message")?.textContent).toBe(
			"Couldn't rename the queue.",
		);
		expect(page.tab().textContent).toBe("Work Reading");
		expect(page.tab().getAttribute("contenteditable")).toBe("true");
	});

	it("shows the new name everywhere the old one was, once the server confirms it", async () => {
		const page = init(pageMarkup());
		page.type("Work Reading");

		page.press("Enter");
		await settled();

		expect(page.tab().textContent).toBe("Work Reading");
		expect(page.document.querySelector(".queue__title")?.textContent).toBe("Work Reading");
		expect(page.document.title).toBe("Work Reading — Readplace");
		expect(page.document.querySelector(".queue__created-flash")).toBeNull();
		expect(page.document.querySelector("#toast-live-region")?.textContent).toBe(
			"Queue renamed to Work Reading.",
		);
		expect(page.document.querySelector("[data-queue-rename]")).toBeNull();
		expect(page.tab().getAttribute("contenteditable")).toBeNull();
		expect(page.tab().classList.contains("queue-nav__link--editing")).toBe(false);
	});

	it("keeps the default name and posts nothing when the reader presses Escape", async () => {
		const page = init(pageMarkup());
		page.type("Work Reading");

		page.press("Escape");
		await settled();

		expect(page.tab().textContent).toBe("New Queue");
		expect(page.tab().getAttribute("contenteditable")).toBeNull();
		expect(page.calls).toEqual([]);
	});

	it("keeps the default name when the reader clears it away to nothing", async () => {
		const page = init(pageMarkup());
		page.type("   ");

		page.blur();
		await settled();

		expect(page.tab().textContent).toBe("New Queue");
		expect(page.calls).toEqual([]);
	});

	it("posts nothing when the reader leaves the default name as it was", async () => {
		const page = init(pageMarkup());

		page.blur();
		await settled();

		expect(page.calls).toEqual([]);
		expect(page.tab().getAttribute("contenteditable")).toBeNull();
	});

	it("posts once when Enter is followed by the blur it causes", async () => {
		const page = init(pageMarkup());
		page.type("Work Reading");

		page.press("Enter");
		await settled();
		page.blur();
		await settled();

		expect(page.calls).toHaveLength(1);
	});

	it("ignores keys that are neither Enter nor Escape", async () => {
		const page = init(pageMarkup());
		page.type("Work Reading");

		page.press("a");
		await settled();

		expect(page.calls).toEqual([]);
		expect(page.tab().getAttribute("contenteditable")).toBe("true");
	});

	it("holds the name to the length the server will accept", () => {
		const page = init(pageMarkup());

		page.type("a".repeat(30));

		expect(page.tab().textContent).toBe("a".repeat(24));
		expect(page.caretAtEnd).toEqual([page.tab()]);
	});

	it("leaves a name within the cap alone", () => {
		const page = init(pageMarkup());

		page.type("Work Reading");

		expect(page.tab().textContent).toBe("Work Reading");
		expect(page.caretAtEnd).toEqual([]);
	});

	it("explains a refused name and leaves the reader editing what they typed", async () => {
		const page = init(pageMarkup(), () =>
			Promise.resolve({
				status: 422,
				json: () =>
					Promise.resolve({
						error: "name-taken",
						message: "You already have a queue with that name.",
					}),
			}),
		);
		page.type("Work Reading");

		page.press("Enter");
		await settled();

		const toast = page.document.querySelector("#status-toast .toast");
		assert(toast, "a refused name must be explained in a toast");
		expect(toast.querySelector(".toast__message")?.textContent).toBe(
			"You already have a queue with that name.",
		);
		expect(toast.getAttribute("data-dismiss")).toBe("6000");
		expect(page.announced).toEqual([toast]);
		expect(page.tab().textContent).toBe("Work Reading");
		expect(page.tab().getAttribute("contenteditable")).toBe("true");
		expect(page.document.activeElement).toBe(page.tab());
	});

	it("lets the reader try again after a refused name", async () => {
		const page = init(pageMarkup(), () =>
			Promise.resolve({ status: 422, json: () => Promise.resolve({ message: "Taken." }) }),
		);
		page.type("Work Reading");
		page.press("Enter");
		await settled();

		page.type("Deep Work");
		page.press("Enter");
		await settled();

		expect(page.calls).toHaveLength(2);
		expect(page.calls[1].init.body).toBe("label=Deep+Work");
	});

	it("falls back to a plain apology when the server's answer carries no reason", async () => {
		const page = init(pageMarkup(), () =>
			Promise.resolve({ status: 500, json: () => Promise.reject(new Error("not json")) }),
		);
		page.type("Work Reading");

		page.press("Enter");
		await settled();

		expect(page.document.querySelector(".toast__message")?.textContent).toBe(
			"Couldn't rename the queue.",
		);
	});

	it("apologises when the request never reaches the server", async () => {
		const page = init(pageMarkup(), () => Promise.reject(new Error("offline")));
		page.type("Work Reading");

		page.press("Enter");
		await settled();

		expect(page.document.querySelector(".toast__message")?.textContent).toBe(
			"Couldn't rename the queue.",
		);
	});
});
