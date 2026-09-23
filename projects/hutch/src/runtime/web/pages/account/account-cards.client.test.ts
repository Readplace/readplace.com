import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
	type AccountCardsDeps,
	confirmSetup,
	initAccountCards,
	mountElements,
	readElementsConfig,
} from "./account-cards.client";

const CONTAINER_HTML = `
<div data-card-elements data-publishable-key="pk_test_123" data-client-secret="seti_123_secret" data-setup-id="seti_123">
	<div data-card-element></div>
	<p data-card-error></p>
	<button type="button" data-card-submit>Save card</button>
</div>
`;

type ConfirmResult = {
	error?: { message?: string };
};

function makeDoc(html: string): Document {
	return new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window.document;
}

function fakeStripe(confirmResult: ConfirmResult) {
	const mounted: Element[] = [];
	const elementsOptions: unknown[] = [];
	const cardOptions: unknown[] = [];
	return {
		stripe: {
			elements: (elementsArg: unknown) => {
				elementsOptions.push(elementsArg);
				return {
					create: (_type: string, createArg: unknown) => {
						cardOptions.push(createArg);
						return { mount: (el: Element) => mounted.push(el) };
					},
				};
			},
			confirmCardSetup: async () => confirmResult,
		},
		mounted,
		elementsOptions,
		cardOptions,
	};
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("readElementsConfig", () => {
	it("reads the publishable key, client secret, and setup id from the container", () => {
		const container = makeDoc(CONTAINER_HTML).querySelector("[data-card-elements]");
		assert(container, "container must exist");
		expect(readElementsConfig(container)).toEqual({
			publishableKey: "pk_test_123",
			clientSecret: "seti_123_secret",
			setupId: "seti_123",
		});
	});

	it("returns undefined when the publishable key is missing", () => {
		const container = makeDoc(
			'<div data-card-elements data-client-secret="seti_x" data-setup-id="seti_1"></div>',
		).querySelector("[data-card-elements]");
		assert(container, "container must exist");
		expect(readElementsConfig(container)).toBeUndefined();
	});

	it("returns undefined when the client secret is missing", () => {
		const container = makeDoc(
			'<div data-card-elements data-publishable-key="pk_x" data-setup-id="seti_1"></div>',
		).querySelector("[data-card-elements]");
		assert(container, "container must exist");
		expect(readElementsConfig(container)).toBeUndefined();
	});

	it("returns undefined when the setup id is missing", () => {
		const container = makeDoc(
			'<div data-card-elements data-publishable-key="pk_x" data-client-secret="seti_x"></div>',
		).querySelector("[data-card-elements]");
		assert(container, "container must exist");
		expect(readElementsConfig(container)).toBeUndefined();
	});
});

describe("confirmSetup", () => {
	function deps(confirmResult: ConfirmResult) {
		const doc = makeDoc(CONTAINER_HTML);
		const errorEl = doc.querySelector("[data-card-error]");
		const submitButton = doc.querySelector<HTMLButtonElement>("[data-card-submit]");
		assert(errorEl && submitButton, "fixture must contain error + submit");
		const confirmedAdds: string[] = [];
		const { stripe } = fakeStripe(confirmResult);
		return {
			errorEl,
			submitButton,
			confirmedAdds,
			args: {
				stripe,
				card: { mount: () => undefined },
				clientSecret: "seti_123_secret",
				setupId: "seti_123",
				errorEl,
				submitButton,
				confirmAdd: (input: { setupId: string }) => confirmedAdds.push(input.setupId),
			},
		};
	}

	it("hands the server-minted setup id back to the server on success", async () => {
		const d = deps({});
		await confirmSetup(d.args);
		expect(d.confirmedAdds).toEqual(["seti_123"]);
		expect(d.errorEl.textContent).toBe("");
	});

	it("shows the Stripe error message and re-enables the button on failure", async () => {
		const d = deps({ error: { message: "Your card was declined." } });
		await confirmSetup(d.args);
		expect(d.confirmedAdds).toEqual([]);
		expect(d.errorEl.textContent).toBe("Your card was declined.");
		expect(d.submitButton.disabled).toBe(false);
	});

	it("falls back to a generic message when Stripe omits one", async () => {
		const d = deps({ error: {} });
		await confirmSetup(d.args);
		expect(d.errorEl.textContent).toBe("We couldn't save your card. Please try again.");
		expect(d.submitButton.disabled).toBe(false);
	});
});

describe("mountElements", () => {
	function deps(
		doc: Document,
		options: { confirmResult?: ConfirmResult; loadStripeFails?: boolean } = {},
	) {
		const loadCalls: string[] = [];
		const confirmedAdds: string[] = [];
		const { stripe, mounted, elementsOptions, cardOptions } = fakeStripe(options.confirmResult ?? {});
		const accountDeps: AccountCardsDeps = {
			document: doc,
			loadStripe: async (key) => {
				loadCalls.push(key);
				if (options.loadStripeFails) throw new Error("Failed to load Stripe.js");
				return stripe;
			},
			confirmAdd: (input) => confirmedAdds.push(input.setupId),
			addSettleListener: () => undefined,
		};
		return { accountDeps, loadCalls, confirmedAdds, mounted, elementsOptions, cardOptions };
	}

	it("is a no-op when no Elements container is present", async () => {
		const d = deps(makeDoc("<main>no container</main>"));
		await mountElements(d.accountDeps);
		expect(d.loadCalls).toEqual([]);
	});

	it("is a no-op when the container is missing its config attributes", async () => {
		const d = deps(makeDoc("<div data-card-elements></div>"));
		await mountElements(d.accountDeps);
		expect(d.loadCalls).toEqual([]);
	});

	it("does not mount twice on an already-mounted container", async () => {
		const doc = makeDoc(CONTAINER_HTML);
		doc.querySelector("[data-card-elements]")?.setAttribute("data-card-mounted", "true");
		const d = deps(doc);
		await mountElements(d.accountDeps);
		expect(d.loadCalls).toEqual([]);
	});

	it("is a no-op when the submit button is missing", async () => {
		const doc = makeDoc(
			'<div data-card-elements data-publishable-key="pk_x" data-client-secret="seti_x" data-setup-id="seti_1"><div data-card-element></div><p data-card-error></p></div>',
		);
		const d = deps(doc);
		await mountElements(d.accountDeps);
		expect(d.loadCalls).toEqual([]);
	});

	it("is a no-op when the document has no window to resolve the card field's styles", async () => {
		const doc = makeDoc("").implementation.createHTMLDocument("");
		doc.body.innerHTML = CONTAINER_HTML;
		const d = deps(doc);
		await mountElements(d.accountDeps);
		expect(d.loadCalls).toEqual([]);
	});

	it("styles the card field from the page's own face and ink, so it follows the reader's theme", async () => {
		const doc = makeDoc(`
<link rel="preload" as="style" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&amp;display=swap">
<div data-card-elements data-publishable-key="pk_test_123" data-client-secret="seti_123_secret" data-setup-id="seti_123">
	<div data-card-element style="color: rgb(228, 228, 228); font-family: Inter; font-size: 16px; --color-text-muted: #6b6b6b"></div>
	<p data-card-error style="color: rgb(210, 128, 128)"></p>
	<button type="button" data-card-submit>Save card</button>
</div>
`);
		const d = deps(doc);
		await mountElements(d.accountDeps);

		expect(d.elementsOptions).toEqual([
			{
				fonts: [
					{ cssSrc: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" },
				],
			},
		]);
		expect(d.cardOptions).toEqual([
			{
				style: {
					base: {
						color: "rgb(228, 228, 228)",
						fontFamily: "Inter",
						fontSize: "16px",
						"::placeholder": { color: "#6b6b6b" },
					},
					invalid: { color: "rgb(210, 128, 128)" },
				},
			},
		]);
	});

	it("loads Stripe, mounts the card element, and confirms on submit click", async () => {
		const doc = makeDoc(CONTAINER_HTML);
		const d = deps(doc, { confirmResult: {} });
		await mountElements(d.accountDeps);

		expect(d.loadCalls).toEqual(["pk_test_123"]);
		expect(d.mounted).toHaveLength(1);
		expect(
			doc.querySelector("[data-card-elements]")?.getAttribute("data-card-mounted"),
		).toBe("true");

		const submit = doc.querySelector<HTMLButtonElement>("[data-card-submit]");
		if (!submit) throw new Error("submit must exist");
		submit.dispatchEvent(new (doc.defaultView ?? globalThis).Event("click"));
		await flush();

		expect(d.confirmedAdds).toEqual(["seti_123"]);
	});

	it("surfaces a retryable error and stays unmounted when Stripe.js fails to load", async () => {
		const doc = makeDoc(CONTAINER_HTML);
		const d = deps(doc, { loadStripeFails: true });

		await mountElements(d.accountDeps);

		const errorEl = doc.querySelector("[data-card-error]");
		if (!errorEl) throw new Error("fixture must contain error element");
		expect(errorEl.textContent).toBe(
			"We couldn't load the secure card form. Check your connection or ad blocker, then reload to try again.",
		);
		expect(d.mounted).toEqual([]);

		// Left unmounted, so the next settle (or a reload) retries the load —
		// a second mount re-invokes loadStripe rather than no-opping.
		await mountElements(d.accountDeps);
		expect(d.loadCalls).toEqual(["pk_test_123", "pk_test_123"]);
	});
});

describe("initAccountCards", () => {
	it("registers a settle listener and runs the mount once on init", () => {
		const doc = makeDoc("<main>no container</main>");
		let registered: (() => void) | undefined;
		const calls: string[] = [];
		initAccountCards({
			document: doc,
			loadStripe: async (key) => {
				calls.push(key);
				return fakeStripe({}).stripe;
			},
			confirmAdd: () => undefined,
			addSettleListener: (listener) => {
				registered = listener;
			},
		});
		expect(typeof registered).toBe("function");
		// Re-running via the settle listener must not throw on a container-less page.
		registered?.();
		expect(calls).toEqual([]);
	});
});
