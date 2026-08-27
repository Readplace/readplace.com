import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { type QueueRenameResponse, initQueueRename } from "./queue-rename.client";

interface RenameCall {
	url: string;
	init: RequestInit;
}

const RENAME_ACTION = "/queue/queues/new-queue/rename?feature=queues";
const TAB_HREF = "/queue?queue=new-queue&feature=queues";

function tabMarkup(label = "New Queue"): string {
	return `<nav class="queue-nav"><ul class="queue-nav__list"><li class="queue-nav__item"><a class="queue-nav__link" href="/queue" data-test-queue="default"><span class="queue-nav__label">My Queue</span></a></li><li class="queue-nav__item"><a class="queue-nav__link queue-nav__link--active" href="${TAB_HREF}" aria-current="page" hx-boost="false" aria-label="Rename ${label}" data-queue-rename="${RENAME_ACTION}" data-queue-rename-field="label" data-queue-label-max="24" data-test-queue="new-queue"><span class="queue-nav__label">${label}</span><svg aria-hidden="true"></svg></a></li></ul></nav>`;
}

function pageMarkup(label?: string): string {
	return `${tabMarkup(label)}<h1 class="queue__title">New Queue</h1><div id="status-toast"></div><div class="sr-only" id="toast-live-region"></div>`;
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
		{ url: "https://readplace.test/queue?queue=new-queue&feature=queues" },
	);
	const document = dom.window.document;
	const calls: RenameCall[] = [];
	const caretAtEnd: Element[] = [];
	const announced: Element[] = [];
	let swapListener: (() => void) | undefined;
	initQueueRename({
		document,
		fetchFn: (target, requestInit) => {
			const call = { url: target, init: requestInit };
			calls.push(call);
			return respond(call);
		},
		placeCaretAtEnd: (element) => caretAtEnd.push(element),
		announceToast: (toast) => announced.push(toast),
		addSwapListener: (listener) => {
			swapListener = listener;
		},
	});
	function queryTab(testQueue: string): HTMLElement {
		const element = document.querySelector<HTMLElement>(`[data-test-queue="${testQueue}"]`);
		assert(element, `the ${testQueue} queue's tab must be in the document`);
		return element;
	}
	function tab(): HTMLElement {
		return queryTab("new-queue");
	}
	function label(): HTMLElement {
		const element = tab().querySelector<HTMLElement>(".queue-nav__label");
		assert(element, "a renameable tab must carry its name in an element of its own");
		return element;
	}
	function pencil(): Element {
		const element = tab().querySelector("svg");
		assert(element, "a renameable tab must draw its pencil");
		return element;
	}
	function clickOn(target: Element, mouseInit: MouseEventInit = {}): void {
		target.dispatchEvent(
			new dom.window.MouseEvent("click", { bubbles: true, cancelable: true, ...mouseInit }),
		);
	}
	return {
		document,
		window: dom.window,
		calls,
		caretAtEnd,
		announced,
		tab,
		label,
		pencil,
		queryTab,
		click: (target?: Element, mouseInit?: MouseEventInit) =>
			clickOn(target ?? label(), mouseInit),
		type: (text: string) => {
			label().textContent = text;
			label().dispatchEvent(new dom.window.Event("input", { bubbles: true }));
		},
		press: (key: string) => {
			label().dispatchEvent(new dom.window.KeyboardEvent("keydown", { key, bubbles: true }));
		},
		blur: (target?: Element) => {
			(target ?? label()).dispatchEvent(new dom.window.Event("focusout", { bubbles: true }));
		},
		swap: () => {
			assert(swapListener, "a swap listener must be registered");
			swapListener();
		},
		replaceNav: (label?: string) => {
			const nav = document.querySelector("nav.queue-nav");
			assert(nav, "the nav must be in the document to be swapped");
			nav.outerHTML = tabMarkup(label);
		},
	};
}

const settled = () => new Promise((resolve) => setImmediate(resolve));

const echoStored = (call: RenameCall): QueueRenameResponse => ({
	status: 200,
	json: () => Promise.resolve({ label: new URLSearchParams(String(call.init.body)).get("label") }),
});

function heldAnswers(answerFor: (call: RenameCall) => QueueRenameResponse) {
	const release: Array<() => void> = [];
	return {
		release,
		respond: (call: RenameCall) =>
			new Promise<QueueRenameResponse>((resolve) => {
				release.push(() => resolve(answerFor(call)));
			}),
	};
}

const bodies = (calls: RenameCall[]): unknown[] => calls.map((call) => call.init.body);

describe("initQueueRename", () => {
	it("opens the editor from the reader's own tap, with the whole name ready to be replaced", () => {
		const page = init(pageMarkup());

		page.click();

		const label = page.label();
		expect(label.getAttribute("contenteditable")).toBe("true");
		expect(label.getAttribute("role")).toBe("textbox");
		expect(label.getAttribute("aria-label")).toBe("Queue name");
		expect(page.document.activeElement).toBe(label);
		expect(page.tab().classList.contains("queue-nav__link--editing")).toBe(true);
		expect(page.tab().getAttribute("href")).toBeNull();
	});

	it("opens the editor when the reader taps the pencil rather than the name", () => {
		const page = init(pageMarkup());

		page.click(page.pencil());

		expect(page.document.activeElement).toBe(page.label());
	});

	it("leaves the link alone when the reader means to open the queue in a new tab", () => {
		const page = init(pageMarkup());

		page.click(page.label(), { metaKey: true });

		expect(page.tab().getAttribute("href")).toBe(TAB_HREF);
		expect(page.label().getAttribute("contenteditable")).toBeNull();
	});

	it("leaves a queue the server never offered to rename alone", () => {
		const page = init(pageMarkup());

		page.click(page.queryTab("default"));

		expect(page.document.activeElement).toBe(page.document.body);
		expect(page.calls).toEqual([]);
	});

	it("does nothing on a page with no queue to rename", () => {
		const page = init(`<h1 class="queue__title">My Queue</h1>`);

		expect(page.calls).toEqual([]);
	});

	it("opens the editor on a tab the page swapped in, with no rebinding of any kind", () => {
		const page = init(`<div id="status-toast"></div>`);
		page.document.body.insertAdjacentHTML("afterbegin", tabMarkup());

		page.click();

		expect(page.document.activeElement).toBe(page.label());
	});

	it("posts the typed name when the reader presses Enter", async () => {
		const page = init(pageMarkup());
		page.click();
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
		page.click();
		page.type("Work Reading");

		page.blur();
		await settled();

		expect(page.calls).toHaveLength(1);
	});

	it("ignores focus leaving anything but the name it is editing", async () => {
		const page = init(pageMarkup());
		page.click();
		page.type("Work Reading");

		page.blur(page.queryTab("default"));
		await settled();

		expect(page.calls).toEqual([]);
		expect(page.label().getAttribute("contenteditable")).toBe("true");
	});

	it("shows the name the server stored, not the one the reader typed", async () => {
		const page = init(pageMarkup(), () =>
			Promise.resolve({ status: 200, json: () => Promise.resolve({ label: "Work Reading 2" }) }),
		);
		page.click();
		page.type("Work Reading");

		page.press("Enter");
		await settled();

		expect(page.label().textContent).toBe("Work Reading 2");
		expect(page.document.querySelector(".queue__title")?.textContent).toBe("Work Reading 2");
		expect(page.document.title).toBe("Work Reading 2 — Readplace");
		expect(page.document.querySelector("#toast-live-region")?.textContent).toBe(
			"Queue renamed to Work Reading 2.",
		);
	});

	it("writes the confirmed name onto the tab the page swapped in mid-rename", async () => {
		const page = init(pageMarkup(), () =>
			Promise.resolve({ status: 200, json: () => Promise.resolve({ label: "Work Reading 2" }) }),
		);
		page.click();
		page.type("Work Reading");
		page.press("Enter");

		page.replaceNav("New Queue");
		page.swap();
		await settled();

		expect(page.label().textContent).toBe("Work Reading 2");
		expect(page.document.querySelector(".queue__title")?.textContent).toBe("Work Reading 2");
	});

	it("keeps an open edit through a swap that leaves its tab standing", () => {
		const page = init(pageMarkup());
		page.click();
		page.type("Work Reading");
		page.swap();

		page.press("Escape");

		expect(page.label().textContent).toBe("New Queue");
		expect(page.label().getAttribute("contenteditable")).toBeNull();
		expect(page.tab().getAttribute("href")).toBe(TAB_HREF);
	});

	it("posts a name confirmed after a swap that left its tab standing", async () => {
		const server = heldAnswers(echoStored);
		const page = init(pageMarkup(), server.respond);
		page.click();
		page.type("Work Reading");
		page.swap();

		page.press("Enter");
		await settled();
		expect(bodies(page.calls)).toEqual(["label=Work+Reading"]);

		server.release[0]();
		await settled();
		expect(page.label().getAttribute("contenteditable")).toBeNull();
	});

	it("asks the reader to try again when the answer carries no name to show", async () => {
		const page = init(pageMarkup(), () =>
			Promise.resolve({ status: 200, json: () => Promise.resolve({}) }),
		);
		page.click();
		page.type("Work Reading");

		page.press("Enter");
		await settled();

		expect(page.document.querySelector(".toast__message")?.textContent).toBe(
			"Couldn't rename the queue.",
		);
		expect(page.label().textContent).toBe("Work Reading");
		expect(page.label().getAttribute("contenteditable")).toBe("true");
	});

	it("hands the tab back as a link once the name is settled, still ready to rename", async () => {
		const page = init(pageMarkup());
		page.click();
		page.type("Work Reading");

		page.press("Enter");
		await settled();

		expect(page.label().textContent).toBe("Work Reading");
		expect(page.document.querySelector(".queue__title")?.textContent).toBe("Work Reading");
		expect(page.document.title).toBe("Work Reading — Readplace");
		expect(page.document.querySelector("#toast-live-region")?.textContent).toBe(
			"Queue renamed to Work Reading.",
		);
		expect(page.tab().getAttribute("href")).toBe(TAB_HREF);
		expect(page.tab().getAttribute("data-queue-rename")).toBe(RENAME_ACTION);
		expect(page.label().getAttribute("contenteditable")).toBeNull();
		expect(page.tab().classList.contains("queue-nav__link--editing")).toBe(false);
		expect(page.document.activeElement).toBe(page.tab());
	});

	it("lets the reader rename the same queue again without a page load", async () => {
		const page = init(pageMarkup());
		page.click();
		page.type("Work Reading");
		page.press("Enter");
		await settled();

		page.click();
		page.type("Deep Work");
		page.press("Enter");
		await settled();

		expect(page.calls).toHaveLength(2);
		expect(page.calls[1].init.body).toBe("label=Deep+Work");
		expect(page.label().textContent).toBe("Deep Work");
	});

	it("backs a second rename out to the name the first one stored", async () => {
		const page = init(pageMarkup());
		page.click();
		page.type("Work Reading");
		page.press("Enter");
		await settled();

		page.click();
		page.type("Deep Work");
		page.press("Escape");

		expect(page.label().textContent).toBe("Work Reading");
		expect(page.calls).toHaveLength(1);
	});

	it("posts a name typed during a rename still in flight once that one lands, in the order typed", async () => {
		const server = heldAnswers(echoStored);
		const page = init(pageMarkup(), server.respond);
		page.click();
		page.type("Work Reading");
		page.press("Enter");
		await settled();

		page.click();
		page.type("Deep Work");
		page.press("Enter");
		await settled();

		expect(bodies(page.calls)).toEqual(["label=Work+Reading"]);

		server.release[0]();
		await settled();

		expect(bodies(page.calls)).toEqual(["label=Work+Reading", "label=Deep+Work"]);

		server.release[1]();
		await settled();

		expect(page.label().textContent).toBe("Deep Work");
		expect(page.document.querySelector(".queue__title")?.textContent).toBe("Deep Work");
		expect(page.label().getAttribute("contenteditable")).toBeNull();
	});

	it("keeps the name still to be posted on screen while the earlier rename lands", async () => {
		const server = heldAnswers(echoStored);
		const page = init(pageMarkup(), server.respond);
		page.click();
		page.type("Work Reading");
		page.press("Enter");
		await settled();
		page.click();
		page.type("Deep Work");
		page.press("Enter");
		await settled();

		server.release[0]();
		await settled();

		expect(page.label().textContent).toBe("Deep Work");
		expect(page.label().getAttribute("contenteditable")).toBe("true");
		expect(page.document.querySelector(".queue__title")?.textContent).toBe("New Queue");
		expect(page.document.title).toBe("New Queue — Readplace");
	});

	it("posts once when the blur behind an in-flight rename carries the name already sent", async () => {
		const server = heldAnswers(echoStored);
		const page = init(pageMarkup(), server.respond);
		page.click();
		page.type("Work Reading");
		page.press("Enter");
		await settled();
		page.blur();
		await settled();

		server.release[0]();
		await settled();

		expect(bodies(page.calls)).toEqual(["label=Work+Reading"]);
		expect(page.label().textContent).toBe("Work Reading");
		expect(page.label().getAttribute("contenteditable")).toBeNull();
		expect(page.tab().getAttribute("href")).toBe(TAB_HREF);
	});

	it("posts once when the server numbers the name it stored and the reader retypes nothing", async () => {
		const server = heldAnswers(() => ({
			status: 200,
			json: () => Promise.resolve({ label: "Work Reading 2" }),
		}));
		const page = init(pageMarkup(), server.respond);
		page.click();
		page.type("Work Reading");
		page.press("Enter");
		await settled();
		page.blur();
		await settled();

		server.release[0]();
		await settled();

		expect(bodies(page.calls)).toEqual(["label=Work+Reading"]);
		expect(page.label().textContent).toBe("Work Reading 2");
		expect(page.label().getAttribute("contenteditable")).toBeNull();
	});

	it("posts once when the reader types back to the name already in flight", async () => {
		const server = heldAnswers(echoStored);
		const page = init(pageMarkup(), server.respond);
		page.click();
		page.type("Work Reading");
		page.press("Enter");
		await settled();
		page.click();
		page.type("Deep Work");
		page.press("Enter");
		await settled();
		page.click();
		page.type("Work Reading");
		page.press("Enter");
		await settled();

		server.release[0]();
		await settled();

		expect(bodies(page.calls)).toEqual(["label=Work+Reading"]);
		expect(page.label().textContent).toBe("Work Reading");
		expect(page.label().getAttribute("contenteditable")).toBeNull();
	});

	it("drops the name typed during a rename the server refused", async () => {
		const server = heldAnswers(() => ({
			status: 422,
			json: () => Promise.resolve({ message: "You already have a queue with that name." }),
		}));
		const page = init(pageMarkup(), server.respond);
		page.click();
		page.type("Work Reading");
		page.press("Enter");
		await settled();
		page.click();
		page.type("Deep Work");
		page.press("Enter");
		await settled();

		server.release[0]();
		await settled();

		expect(bodies(page.calls)).toEqual(["label=Work+Reading"]);
		expect(page.document.querySelector(".toast__message")?.textContent).toBe(
			"You already have a queue with that name.",
		);
		expect(page.label().textContent).toBe("Deep Work");
		expect(page.label().getAttribute("contenteditable")).toBe("true");
	});

	it("abandons an edit the page dropped underneath it", async () => {
		const page = init(pageMarkup());
		page.click();
		page.type("Work Reading");

		page.replaceNav();
		page.swap();
		page.press("Enter");
		await settled();

		expect(page.calls).toEqual([]);
	});

	it("keeps the default name and posts nothing when the reader presses Escape", async () => {
		const page = init(pageMarkup());
		page.click();
		page.type("Work Reading");

		page.press("Escape");
		await settled();

		expect(page.label().textContent).toBe("New Queue");
		expect(page.label().getAttribute("contenteditable")).toBeNull();
		expect(page.tab().getAttribute("href")).toBe(TAB_HREF);
		expect(page.calls).toEqual([]);
	});

	it("keeps the default name when the reader clears it away to nothing", async () => {
		const page = init(pageMarkup());
		page.click();
		page.type("   ");

		page.blur();
		await settled();

		expect(page.label().textContent).toBe("New Queue");
		expect(page.calls).toEqual([]);
	});

	it("posts nothing when the reader leaves the name as it was", async () => {
		const page = init(pageMarkup());
		page.click();

		page.blur();
		await settled();

		expect(page.calls).toEqual([]);
		expect(page.label().getAttribute("contenteditable")).toBeNull();
	});

	it("posts once when Enter is followed by the blur it causes", async () => {
		const page = init(pageMarkup());
		page.click();
		page.type("Work Reading");

		page.press("Enter");
		await settled();
		page.blur();
		await settled();

		expect(page.calls).toHaveLength(1);
	});

	it("ignores keys that are neither Enter nor Escape", async () => {
		const page = init(pageMarkup());
		page.click();
		page.type("Work Reading");

		page.press("a");
		await settled();

		expect(page.calls).toEqual([]);
		expect(page.label().getAttribute("contenteditable")).toBe("true");
	});

	it("ignores typing on a page where no name is being edited", () => {
		const page = init(pageMarkup());

		page.type("a".repeat(30));

		expect(page.label().textContent).toBe("a".repeat(30));
		expect(page.caretAtEnd).toEqual([]);
	});

	it("holds the name to the length the server will accept", () => {
		const page = init(pageMarkup());
		page.click();

		page.type("a".repeat(30));

		expect(page.label().textContent).toBe("a".repeat(24));
		expect(page.caretAtEnd).toEqual([page.label()]);
	});

	it("leaves a name within the cap alone", () => {
		const page = init(pageMarkup());
		page.click();

		page.type("Work Reading");

		expect(page.label().textContent).toBe("Work Reading");
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
		page.click();
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
		expect(page.label().textContent).toBe("Work Reading");
		expect(page.label().getAttribute("contenteditable")).toBe("true");
		expect(page.document.activeElement).toBe(page.label());
	});

	it("lets the reader try again after a refused name", async () => {
		const page = init(pageMarkup(), () =>
			Promise.resolve({ status: 422, json: () => Promise.resolve({ message: "Taken." }) }),
		);
		page.click();
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
		page.click();
		page.type("Work Reading");

		page.press("Enter");
		await settled();

		expect(page.document.querySelector(".toast__message")?.textContent).toBe(
			"Couldn't rename the queue.",
		);
	});

	it("apologises when the request never reaches the server", async () => {
		const page = init(pageMarkup(), () => Promise.reject(new Error("offline")));
		page.click();
		page.type("Work Reading");

		page.press("Enter");
		await settled();

		expect(page.document.querySelector(".toast__message")?.textContent).toBe(
			"Couldn't rename the queue.",
		);
	});
});
