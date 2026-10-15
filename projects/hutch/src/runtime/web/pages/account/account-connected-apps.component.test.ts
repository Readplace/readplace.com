import assert from "node:assert/strict";
import { type OAuthClient, OAuthClientIdSchema, getBuiltInClient } from "@packages/domain/oauth";
import { JSDOM } from "jsdom";
import { renderConnectedApps } from "./account-connected-apps.component";
import { buildConnectedAppsSection } from "./account-connected-apps.view-model";

function builtIn(id: string): OAuthClient {
	const client = getBuiltInClient(id);
	assert(client, `${id} is a built-in client`);
	return client;
}

function claudeAt(input: { id: string; redirectUri: string }): OAuthClient {
	return {
		id: OAuthClientIdSchema.parse(input.id),
		name: "Claude",
		redirectUris: [input.redirectUri],
		grants: ["authorization_code", "refresh_token"],
	};
}

function sectionFor(clients: readonly OAuthClient[]): Element {
	const html = renderConnectedApps(buildConnectedAppsSection({ clients, appShell: false, platform: undefined }));
	const section = new JSDOM(`<main class="account">${html}</main>`).window.document.querySelector("[data-test-connected-apps]");
	assert(section, "the connected apps section must render");
	return section;
}

function rowFor(section: Element, clientId: string): Element {
	const row = section.querySelector(`[data-test-connected-app-client="${clientId}"]`);
	assert(row, `the ${clientId} row must render`);
	return row;
}

function panelFor(section: Element, trigger: Element): Element {
	const panel = section.querySelector(`[data-test-confirm-popover="disconnect-app"][id="${trigger.getAttribute("popovertarget")}"]`);
	assert(panel, "every Disconnect trigger must open a rendered panel");
	return panel;
}

function triggerIn(row: Element): Element {
	const trigger = row.querySelector('[data-test-action="disconnect-app-open"]');
	assert(trigger, "a client row must carry a Disconnect trigger");
	return trigger;
}

const CHROME_AND_CLAUDE = [builtIn("hutch-chrome-extension"), claudeAt({ id: "dyn-claude", redirectUri: "https://claude.ai/api/mcp/auth_callback" })];

describe("renderConnectedApps", () => {
	it("renders one row per connected app in the view model's order", () => {
		const section = sectionFor(CHROME_AND_CLAUDE);

		expect(section.getAttribute("id")).toBe("connected-apps");
		expect(section.getAttribute("data-test-account-section")).toBe("connected-apps");
		expect(section.getAttribute("data-test-connected-apps-state")).toBe("listed");
		expect([...section.querySelectorAll("li.account-row[data-test-connected-app]")].map((row) => row.getAttribute("data-test-connected-app"))).toEqual(["chrome", "claude"]);
	});

	it("draws each app's own logo in the row's well", () => {
		const section = sectionFor(CHROME_AND_CLAUDE);

		const well = rowFor(section, "hutch-chrome-extension").querySelector(".account-row__icon");
		assert(well, "the row must carry its icon well");
		expect(well.getAttribute("aria-hidden")).toBe("true");
		expect([...well.querySelectorAll("svg path")].map((path) => path.getAttribute("fill"))).toEqual(["#DB4437", "#FFCD40", "#0F9D58"]);
	});

	it("opens a plain Disconnect panel from each row's trigger, Cancel before Disconnect and no close control", () => {
		const section = sectionFor(CHROME_AND_CLAUDE);

		for (const clientId of ["hutch-chrome-extension", "dyn-claude"]) {
			const trigger = triggerIn(rowFor(section, clientId));
			const panel = panelFor(section, trigger);
			expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
			expect(trigger.className).toBe("btn btn--destructive btn--m connected-apps__trigger");
			expect(panel.getAttribute("data-test-confirm-subject")).toBe(clientId);
			expect([...panel.querySelectorAll("[data-test-action]")].map((control) => control.getAttribute("data-test-action"))).toEqual([
				"disconnect-app-cancel",
				"disconnect-app-confirm",
			]);
			const header = panel.querySelector(".confirm-popover__header");
			assert(header, "the panel must carry its header");
			expect([...header.children].map((child) => child.tagName.toLowerCase())).toEqual(["h2"]);
		}
	});

	it("titles the panel with the app and states what Disconnect does", () => {
		const section = sectionFor(CHROME_AND_CLAUDE);

		const panel = panelFor(section, triggerIn(rowFor(section, "hutch-chrome-extension")));
		expect(panel.querySelector(".confirm-popover__title")?.textContent).toBe("Disconnect Chrome extension?");
		expect(panel.querySelector(".confirm-popover__body")?.textContent).toBe(
			"It's signed out and can't save to Readplace until you sign in to it again. Your saved articles stay in your readlist.",
		);
		expect(panel.querySelector(".sr-only")?.textContent).toBe("Save any page to Readplace with one click.");
	});

	it("names the app and where it connects from on every Disconnect control", () => {
		const section = sectionFor(CHROME_AND_CLAUDE);

		const row = rowFor(section, "dyn-claude");
		const controls = ["disconnect-app-open", "disconnect-app-fallback-open", "disconnect-app-fallback-confirm"].map((action) => {
			const control = row.querySelector(`[data-test-action="${action}"]`);
			assert(control, `the row must carry ${action}`);
			return control;
		});
		expect(controls.map((control) => control.textContent)).toEqual([
			"Disconnect Claude, Connected from claude.ai.",
			"Disconnect Claude, Connected from claude.ai.",
			"Disconnect Claude, Connected from claude.ai.",
		]);
		expect(controls.map((control) => control.querySelector(".sr-only")?.textContent)).toEqual([
			" Claude, Connected from claude.ai.",
			" Claude, Connected from claude.ai.",
			" Claude, Connected from claude.ai.",
		]);
	});

	it("tells two assistants of the same name apart by where they connect from", () => {
		const section = sectionFor([
			claudeAt({ id: "dyn-claude", redirectUri: "https://claude.ai/api/mcp/auth_callback" }),
			claudeAt({ id: "dyn-workspace", redirectUri: "https://example.com/callback" }),
		]);

		expect([...section.querySelectorAll('[data-test-action="disconnect-app-open"]')].map((trigger) => trigger.textContent)).toEqual([
			"Disconnect Claude, Connected from claude.ai.",
			"Disconnect Claude, Connected from example.com.",
		]);
	});

	it("keeps a disclosure in the row's actions that asks before posting where popover is unsupported", () => {
		const section = sectionFor(CHROME_AND_CLAUDE);

		const row = rowFor(section, "hutch-chrome-extension");
		const fallback = row.querySelector(".account-row__actions > details.connected-apps__fallback");
		assert(fallback, "the fallback disclosure must sit in the row's actions");
		expect([...fallback.children].map((child) => `${child.tagName.toLowerCase()}.${child.className}`)).toEqual([
			"summary.btn btn--destructive btn--m",
			"p.connected-apps__fallback-body",
			"form.connected-apps__fallback-form",
		]);
		expect(fallback.querySelector(".connected-apps__fallback-body")?.textContent).toBe(
			"It's signed out and can't save to Readplace until you sign in to it again. Your saved articles stay in your readlist.",
		);
	});

	it("posts the fallback to the same Disconnect as the panel, through one red submit that shows its round trip", () => {
		const section = sectionFor(CHROME_AND_CLAUDE);

		const row = rowFor(section, "hutch-chrome-extension");
		const fallbackForm = row.querySelector("details.connected-apps__fallback form");
		const panelForm = panelFor(section, triggerIn(row)).querySelector("form");
		assert(fallbackForm && panelForm, "both the fallback and the panel must post through a form");
		expect(fallbackForm.getAttribute("method")).toBe("POST");
		expect(fallbackForm.getAttribute("action")).toBe(panelForm.getAttribute("action"));
		expect(panelForm.getAttribute("action")).toBe(
			"/account/connected-apps/hutch-chrome-extension/disconnect?utm_source=account&utm_medium=internal&utm_content=disconnect-app",
		);
		expect([...fallbackForm.querySelectorAll('[type="submit"]')].map((submit) => submit.getAttribute("data-test-action"))).toEqual([
			"disconnect-app-fallback-confirm",
		]);
		const fallbackSubmit = fallbackForm.querySelector('button.btn.btn--destructive.btn--m[data-test-action="disconnect-app-fallback-confirm"]');
		assert(fallbackSubmit, "the fallback submit must be a destructive M button");
		expect([...fallbackSubmit.children].map((child) => child.classList[0])).toEqual(["account__action-label", "account__action-loader"]);
		const panelCommit = panelForm.querySelector('button.btn.btn--primary[data-test-action="disconnect-app-confirm"]');
		assert(panelCommit, "the panel must commit through its primary button");
		expect([...panelCommit.children].map((child) => child.classList[0])).toEqual(["account__action-label", "account__action-loader"]);
		expect([...row.querySelectorAll("form")].map((form) => form.className)).toEqual(["connected-apps__fallback-form"]);
	});

	it("swaps the page's main on either Disconnect without moving the reader", () => {
		const section = sectionFor(CHROME_AND_CLAUDE);

		const forms = [...section.querySelectorAll('form[data-test-connected-app-action]')];
		expect(forms.map((form) => form.getAttribute("data-test-connected-app-action"))).toEqual([
			"disconnect",
			"disconnect",
			"disconnect-confirm",
			"disconnect-confirm",
		]);
		for (const form of forms) {
			expect([form.getAttribute("hx-boost"), form.getAttribute("hx-target"), form.getAttribute("hx-select"), form.getAttribute("hx-swap")]).toEqual([
				"true",
				"main",
				"main",
				"outerHTML show:none",
			]);
		}
	});

	it("keeps one row pointing at the ways to save when nothing is connected", () => {
		const section = sectionFor([]);

		expect(section.getAttribute("data-test-connected-apps-state")).toBe("empty");
		const row = section.querySelector('li.account-row[data-test-connected-app="empty"]');
		assert(row, "the empty row must render");
		expect(row.querySelector(".account-row__title")?.textContent).toBe("No apps connected yet");
		expect(row.querySelector(".account-row__description")?.textContent).toBe(
			"Install the browser extension or the iPhone app, or connect an AI assistant, and it shows up here.",
		);
		expect([...row.querySelectorAll(".account-row__actions > *")].map((action) => action.outerHTML)).toEqual([
			'<a class="btn btn--neutral btn--m" href="/install?utm_source=account&amp;utm_medium=internal&amp;utm_content=see-ways-to-save" data-test-connected-app-action="see-ways-to-save">See ways to save</a>',
		]);
	});
});
