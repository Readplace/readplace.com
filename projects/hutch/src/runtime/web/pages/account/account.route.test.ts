import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { DisplayNameSchema, UserIdSchema } from "@packages/domain/user";
import { CardSetupIdSchema, PaymentMethodIdSchema } from "@packages/provider-contracts/payment-methods";
import type { SavedCard } from "@packages/provider-contracts/payment-methods";
import { InvoiceIdSchema, type InvoiceSummary } from "@packages/provider-contracts/subscription-billing";
import {
	BROWSER_USER_AGENT,
	describeUntrackedCtas,
	findUntrackedCtas,
} from "@packages/web-test-harness";
import { useTestServer, loginAgent } from "../../../test-app";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";
import { CHECKOUT_VARIANTS } from "../../../observability/events";
import { SUBSCRIBE_PLANS_POPOVER_ID } from "../../shared/subscribe-plans/subscribe-plans.component";
import { ACCOUNT_CANCEL_MAX_POLLS } from "./account.view-model";

function card(id: string, isPrimary: boolean, last4: string): SavedCard {
	return {
		id: PaymentMethodIdSchema.parse(id),
		brand: "visa",
		last4,
		expMonth: 12,
		expYear: 2030,
		isPrimary,
	};
}

function cardRows(root: Document | Element): Element[] {
	return Array.from(root.querySelectorAll("[data-test-card]"));
}

function cardActionKeys(row: Element): string[] {
	return Array.from(row.querySelectorAll("[data-test-card-action]")).map(
		(el) => el.getAttribute("data-test-card-action") ?? "",
	);
}

const useApp = useTestServer();
const ONE_DAY_MS = 86_400_000;
const GOOGLEBOT = "Googlebot/2.1 (+http://www.google.com/bot.html)";

async function loginUser(
	harness: ReturnType<ReturnType<typeof useTestServer>>,
	email: string,
) {
	const { auth } = harness;
	await auth.createUser({ email, password: "password123" });
	const lookup = await auth.findUserByEmail(email);
	assert(lookup, "test user should exist");
	const agent = request.agent(harness.server).set("User-Agent", BROWSER_USER_AGENT);
	await agent.post("/login").type("form").send({ email, password: "password123" });
	return { agent, userId: lookup.userId };
}

function findCard(doc: Document) {
	const card = doc.querySelector("[data-test-account-card]");
	assert(card, "account card must be rendered");
	return card;
}

function findAction(doc: Document, key: string) {
	const element = doc.querySelector(`[data-test-account-action="${key}"]`);
	assert(element, `account action "${key}" must be rendered`);
	return element;
}

function actionKeys(root: Document | Element): string[] {
	return Array.from(root.querySelectorAll("[data-test-account-action]")).map(
		(el) => el.getAttribute("data-test-account-action") ?? "",
	);
}

function trailingActionKeys(doc: Document): string[] {
	const slot = findCard(doc).querySelector(".account-billing__actions");
	assert(slot, "the plan section must render its trailing action slot");
	return actionKeys(slot);
}

function managePanel(doc: Document, panel: "subscription" | "payment"): Element {
	const element = doc.querySelector(`[data-test-manage-panel="${panel}"]`);
	assert(element, `the ${panel} panel must always render`);
	return element;
}

function hiddenFields(form: Element): string[][] {
	return Array.from(form.querySelectorAll<HTMLInputElement>('input[type="hidden"]')).map((input) => [
		input.name,
		input.value,
	]);
}

function planChips(doc: Document): string[][] {
	return Array.from(findCard(doc).querySelectorAll("[data-test-account-plan-chip]")).map((chip) => [
		chip.textContent ?? "",
		chip.className,
	]);
}

function planTitle(doc: Document): string {
	const title = findCard(doc).querySelector("[data-test-account-plan-title]");
	assert(title, "the plan section must render its title");
	return title.textContent ?? "";
}

function planPrice(doc: Document): Element {
	const price = findCard(doc).querySelector("[data-test-account-price]");
	assert(price, "the price must always render");
	return price;
}

function expectBillingHidden(doc: Document) {
	const payment = doc.querySelector("[data-test-cards-section]");
	assert(payment, "the payment section's root must always render");
	expect(payment.getAttribute("data-test-cards-state")).toBe("hidden");
	const history = doc.querySelector("[data-test-billing-history]");
	assert(history, "the billing-history root must always render");
	expect(history.getAttribute("data-billing-history-state")).toBe("hidden");
	expect(doc.querySelectorAll('form[action*="/account/cards"]')).toHaveLength(0);
	expect(doc.querySelectorAll("[data-card-elements]")).toHaveLength(0);
}

function expectAlertTitleBetweenHeadings(doc: Document) {
	const section = doc.querySelector('[data-test-account-section="subscription"]');
	assert(section, "the subscription section must render");
	const outline = Array.from(section.querySelectorAll("h2, [data-test-alert-title], h3"));
	expect(outline.slice(0, 3).map((element) => element.tagName)).toEqual(["H2", "P", "H3"]);
	expect(outline[2].hasAttribute("data-test-account-plan-title")).toBe(true);
}

function profileLineTexts(doc: Document): string[] {
	return Array.from(doc.querySelectorAll("[data-test-account-profile-line]")).map((line) => line.textContent ?? "");
}

function profileInitials(doc: Document): string {
	const initials = doc.querySelector("[data-test-account-profile-initials]");
	assert(initials, "the Profile row must render its initials disc");
	return initials.textContent ?? "";
}

function confirmPopoverKeys(doc: Document): string[] {
	return Array.from(doc.querySelectorAll("[data-test-confirm-popover]")).map(
		(panel) => panel.getAttribute("data-test-confirm-popover") ?? "",
	);
}

function dangerForm(doc: Document, placement: "dialog" | "fallback" | "inline"): Element {
	const form = doc.querySelector(`[data-test-danger-form="${placement}"]`);
	assert(form, `the ${placement} delete form must render`);
	return form;
}

function subscribePlanKeys(doc: Document): string[] {
	return Array.from(
		doc.querySelectorAll(
			`[data-test-confirm-popover="subscribe-plans"] [data-test-plan]`,
		),
	).map((panel) => panel.getAttribute("data-test-plan") ?? "");
}

function checkedSubscribePlanKeys(doc: Document): string[] {
	return Array.from(
		doc.querySelectorAll<HTMLInputElement>(
			`[data-test-confirm-popover="subscribe-plans"] input[name="plan"]`,
		),
	)
		.filter((radio) => radio.checked)
		.map((radio) => radio.value);
}

describe("GET /account (unauthenticated)", () => {
	it("redirects to /login", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/account");
		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/login?return=%2Faccount");
	});
});

describe("GET /account (founding member, no subscription row)", () => {
	it("renders the founding card and no actions", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get("/account");

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		const card = findCard(doc);
		expect(card.classList.contains("account-card--founding")).toBe(true);
		expect(card.getAttribute("data-test-account-state")).toBe("founding");
		expect(actionKeys(doc)).toEqual([]);
		// The nav-hide bundle is injected per page and carries no page gate, so a
		// page that doesn't opt in must not serve it or its nav would hide on scroll.
		expect(response.text).not.toContain("/client-dist/reader-nav.client.js");
	});
});

describe("GET /account (active paid subscription)", () => {
	it("summarises the plan — title, Active chip and price — with Manage subscription, a GET form that opens the cancel panel in place", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "active@example.com");
		await subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_active",
			customerId: "cus_active",
			plan: "monthly",
		});

		const response = await agent.get("/account");

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		const card = findCard(doc);
		expect(card.classList.contains("account-card--active")).toBe(true);
		expect(card.getAttribute("data-test-account-state")).toBe("active");
		expect(planTitle(doc)).toBe("Monthly plan");
		expect(planChips(doc)).toEqual([["Active", "chip chip--status chip--success"]]);
		expect(planPrice(doc).getAttribute("data-price-state")).toBe("visible");
		expect(planPrice(doc).textContent).toBe("$10/month");

		expect(actionKeys(card)).toEqual(["manage-subscription"]);
		const manage = findAction(doc, "manage-subscription");
		expect(manage.tagName.toLowerCase()).toBe("form");
		expect(manage.getAttribute("method")?.toUpperCase()).toBe("GET");
		expect(manage.getAttribute("action")).toBe("/account");
		expect(hiddenFields(manage)).toEqual([
			["utm_source", "account"],
			["utm_medium", "internal"],
			["utm_content", "manage-subscription"],
			["manage", "subscription"],
		]);
		expect(manage.getAttribute("hx-swap")).toBe("outerHTML show:none");
		const panel = managePanel(doc, "subscription");
		expect(panel.getAttribute("data-manage-panel-state")).toBe("closed");
		expect(panel.className).toBe("account-billing__panel account-billing__panel--closed");
		expect(actionKeys(panel)).toEqual([]);
	});
});

describe("GET /account?manage=subscription", () => {
	it("opens the subscription panel with its sentence and the cancel form, and the trailing action becomes Done", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, userId } = await loginUser(harness, "manage-subscription@example.com");
		await harness.subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_manage",
			customerId: "cus_manage",
			plan: "monthly",
		});

		const response = await agent.get("/account?manage=subscription");

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		const panel = managePanel(doc, "subscription");
		expect(panel.getAttribute("data-manage-panel-state")).toBe("open");
		expect(panel.className).toBe("account-billing__panel");
		expect(panel.querySelector(".account-billing__panel-body")?.textContent).toBe(
			"Cancelling stops your next payment. You keep full access until the end of the period you've paid for.",
		);
		expect(actionKeys(panel)).toEqual(["cancel-form"]);
		const cancel = findAction(doc, "cancel-form");
		expect(cancel.getAttribute("method")?.toUpperCase()).toBe("POST");
		expect(cancel.getAttribute("action")).toBe(
			"/account/cancel?utm_source=account&utm_medium=internal&utm_content=cancel-form",
		);
		expect(cancel.querySelector("button")?.className).toBe("btn btn--destructive btn--m");

		expect(trailingActionKeys(doc)).toEqual(["done"]);
		const done = findAction(doc, "done");
		expect(done.getAttribute("method")?.toUpperCase()).toBe("GET");
		expect(done.getAttribute("action")).toBe("/account");
		expect(hiddenFields(done)).toEqual([
			["utm_source", "account"],
			["utm_medium", "internal"],
			["utm_content", "done"],
		]);
		expect(done.querySelector("button")?.className).toBe("btn btn--neutral btn--m");
	});

	it("leaves the panel shut for a trialing reader, whose card keeps Subscribe as its one action", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, userId } = await loginUser(harness, "manage-subscription-trial@example.com");
		await harness.subscriptionProviders.upsertTrialing({
			userId,
			trialEndsAt: new Date(Date.now() + 7 * ONE_DAY_MS).toISOString(),
		});

		const doc = new JSDOM((await agent.get("/account?manage=subscription")).text).window.document;

		expect(managePanel(doc, "subscription").getAttribute("data-manage-panel-state")).toBe("closed");
		expect(actionKeys(managePanel(doc, "subscription"))).toEqual([]);
		expect(trailingActionKeys(doc)).toEqual(["subscribe"]);
	});
});

describe("GET /account?manage=payment", () => {
	it("opens the payment panel with the backups, the hint and Add a card, and the card row's action becomes Done", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await activeUserWithCards(harness, "manage-payment@example.com", [
			card("pm_primary", true, "4242"),
			card("pm_backup", false, "1111"),
		]);

		const response = await agent.get("/account?manage=payment");

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		const panel = managePanel(doc, "payment");
		expect(panel.getAttribute("data-manage-panel-state")).toBe("open");
		expect(cardRows(panel).map((row) => row.querySelector(".account-billing__title")?.textContent)).toEqual([
			"Visa •••• 1111",
		]);
		expect(panel.querySelector(".account-billing__hint")?.textContent).toBe(
			"A new card is added as a backup. Make it primary to pay with it from your next payment.",
		);
		assert(panel.querySelector("[data-test-add-card]"), "the open panel must offer Add a card below the cap");
		const primaryRow = doc.querySelector("[data-test-card-primary]");
		assert(primaryRow, "the primary card row must render");
		expect(actionKeys(primaryRow)).toEqual(["done"]);
		expect(hiddenFields(findAction(doc, "done"))).toEqual([
			["utm_source", "account"],
			["utm_medium", "internal"],
			["utm_content", "done"],
		]);
	});

	it("keeps the payment panel shut on a plain /account, with Update payment method on the primary card's row", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await activeUserWithCards(harness, "manage-payment-closed@example.com", [
			card("pm_primary", true, "4242"),
			card("pm_backup", false, "1111"),
		]);

		const doc = new JSDOM((await agent.get("/account")).text).window.document;

		const panel = managePanel(doc, "payment");
		expect(panel.getAttribute("data-manage-panel-state")).toBe("closed");
		expect(cardRows(panel)).toHaveLength(0);
		const primaryRow = doc.querySelector("[data-test-card-primary]");
		assert(primaryRow, "the primary card row must render");
		expect(actionKeys(primaryRow)).toEqual(["update-payment"]);
		const update = findAction(doc, "update-payment");
		expect(update.getAttribute("method")?.toUpperCase()).toBe("GET");
		expect(update.getAttribute("action")).toBe("/account");
		expect(hiddenFields(update)).toEqual([
			["utm_source", "account"],
			["utm_medium", "internal"],
			["utm_content", "update-payment"],
			["manage", "payment"],
		]);
		const updateButton = update.querySelector("button");
		assert(updateButton, "Update payment method must render its button");
		expect(updateButton.firstElementChild?.tagName.toLowerCase()).toBe("svg");
		expect(updateButton.querySelector(".account__action-label")?.textContent).toBe("Update payment method");
	});

	it("opens the panel on a card notice without being asked, so the reason sits beside the cards it names", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await activeUserWithCards(harness, "manage-payment-notice@example.com", [
			card("pm_primary", true, "4242"),
		]);

		const doc = new JSDOM((await agent.get("/account?error=cannot_remove_primary")).text).window.document;

		const panel = managePanel(doc, "payment");
		expect(panel.getAttribute("data-manage-panel-state")).toBe("open");
		const notice = panel.querySelector('[data-test-alert="card-notice"]');
		assert(notice, "the card notice must render inside the payment panel");
		expect(notice.textContent).toContain("primary card can't be removed");
	});
});

describe("GET /account (billing history)", () => {
	it("offers View invoices to any reader with a billing customer, a former subscriber included", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, userId } = await loginUser(harness, "history-cancelled@example.com");
		await harness.subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_history",
			customerId: "cus_history",
		});
		await harness.subscriptionProviders.markCancelledByUserId({ userId });

		const doc = new JSDOM((await agent.get("/account")).text).window.document;

		const history = doc.querySelector("[data-test-billing-history]");
		assert(history, "the billing-history root must render");
		expect(history.getAttribute("data-billing-history-state")).toBe("visible");
		expect(history.querySelector(".account-row__title")?.textContent).toBe("Billing history");
		expect(actionKeys(history)).toEqual(["view-invoices"]);
		const viewInvoices = findAction(doc, "view-invoices");
		expect(viewInvoices.getAttribute("method")?.toUpperCase()).toBe("GET");
		expect(viewInvoices.getAttribute("action")).toBe("/account/invoices");
		expect(viewInvoices.getAttribute("hx-swap")).toBe("outerHTML show:none scroll:html:top");
		expect(hiddenFields(viewInvoices)).toEqual([
			["utm_source", "account"],
			["utm_medium", "internal"],
			["utm_content", "view-invoices"],
		]);
	});

	it("hides billing history for a trialing reader, who has no invoices to show", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, userId } = await loginUser(harness, "history-trial@example.com");
		await harness.subscriptionProviders.upsertTrialing({
			userId,
			trialEndsAt: new Date(Date.now() + 7 * ONE_DAY_MS).toISOString(),
		});

		const doc = new JSDOM((await agent.get("/account")).text).window.document;

		const history = doc.querySelector("[data-test-billing-history]");
		assert(history, "the billing-history root must render");
		expect(history.getAttribute("data-billing-history-state")).toBe("hidden");
		expect(history.className).toBe("account-billing__history account-billing__history--hidden");
		expect(history.textContent?.trim()).toBe("");
	});
});

describe("GET /account (next-charge line)", () => {
	function nextChargeLine(doc: Document): Element {
		const line = doc.querySelector("[data-test-next-charge]");
		assert(line, "next-charge element must always be in the DOM");
		return line;
	}

	async function activeSubscriber(email: string) {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, userId } = await loginUser(harness, email);
		await harness.subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_active",
			customerId: "cus_active",
		});
		return { harness, agent, userId };
	}

	it("renders the date and amount of the next payment as a localisable <time>", async () => {
		const { harness, agent } = await activeSubscriber("charge-soon@example.com");
		const at = new Date(Date.now() + 12 * ONE_DAY_MS).toISOString();
		harness.subscriptionBilling.seedNextCharge({
			subscriptionId: "sub_active",
			nextCharge: { at, amountMinor: 4900, currency: "usd" },
		});

		const response = await agent.get("/account");

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		const line = nextChargeLine(doc);
		expect(line.getAttribute("data-next-charge-state")).toBe("visible");
		const time = line.querySelector("time[data-local-time='date']");
		assert(time, "the renewal date must render as a <time> element for client localisation");
		expect(time.getAttribute("datetime")).toBe(at);
		expect(line.textContent).toContain("Next payment on ");
		expect(line.textContent).toContain("$49.00");
	});

	it("shows a payment months out — the plan summary always names the next payment", async () => {
		const { harness, agent } = await activeSubscriber("charge-far@example.com");
		const at = new Date(Date.now() + 200 * ONE_DAY_MS).toISOString();
		harness.subscriptionBilling.seedNextCharge({
			subscriptionId: "sub_active",
			nextCharge: { at, amountMinor: 6000, currency: "usd" },
		});

		const response = await agent.get("/account");

		const doc = new JSDOM(response.text).window.document;
		const line = nextChargeLine(doc);
		expect(line.getAttribute("data-next-charge-state")).toBe("visible");
		expect(line.querySelector("time")?.getAttribute("datetime")).toBe(at);
		expect(line.textContent).toContain("$60.00");
	});

	it("persists the fetched charge — a second visit does not ask Stripe again", async () => {
		const { harness, agent } = await activeSubscriber("charge-persist@example.com");
		harness.subscriptionBilling.seedNextCharge({
			subscriptionId: "sub_active",
			nextCharge: {
				at: new Date(Date.now() + 12 * ONE_DAY_MS).toISOString(),
				amountMinor: 4900,
				currency: "usd",
			},
		});

		await agent.get("/account");
		await agent.get("/account");

		expect(harness.subscriptionBilling.nextChargeLookups()).toEqual(["sub_active"]);
	});

	it("still returns 200 with the plain active summary when the provider read fails", async () => {
		const { harness, agent } = await activeSubscriber("charge-fail@example.com");
		harness.subscriptionBilling.failNextChargeLookup();

		const response = await agent.get("/account");

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		expect(planTitle(doc)).toBe("Subscription");
		expect(planChips(doc)).toEqual([["Active", "chip chip--status chip--success"]]);
		expect(doc.querySelector("[data-test-account-status]")?.textContent).toBe("");
		expect(nextChargeLine(doc).getAttribute("data-next-charge-state")).toBe("hidden");
	});

	it("does not ask Stripe for a price for a trialing user", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, userId } = await loginUser(harness, "trial-noprice@example.com");
		await harness.subscriptionProviders.upsertTrialing({
			userId,
			trialEndsAt: new Date(Date.now() + 7 * ONE_DAY_MS).toISOString(),
		});

		await agent.get("/account");

		expect(harness.subscriptionBilling.nextChargeLookups()).toEqual([]);
	});

	it("hides the line and asks nothing of Stripe while a cancellation is in flight", async () => {
		const { harness, agent } = await activeSubscriber("charge-cancelling@example.com");
		harness.subscriptionBilling.seedNextCharge({
			subscriptionId: "sub_active",
			nextCharge: {
				at: new Date(Date.now() + 12 * ONE_DAY_MS).toISOString(),
				amountMinor: 4900,
				currency: "usd",
			},
		});

		const response = await agent.get("/account?cancelling=1");

		const doc = new JSDOM(response.text).window.document;
		expect(nextChargeLine(doc).getAttribute("data-next-charge-state")).toBe("hidden");
		expect(harness.subscriptionBilling.nextChargeLookups()).toEqual([]);
	});

	it("clears the stored renewal when the subscription is cancelled", async () => {
		const { harness, agent, userId } = await activeSubscriber("charge-cancel@example.com");
		harness.subscriptionBilling.seedNextCharge({
			subscriptionId: "sub_active",
			nextCharge: {
				at: new Date(Date.now() + 12 * ONE_DAY_MS).toISOString(),
				amountMinor: 4900,
				currency: "usd",
			},
		});
		await agent.get("/account");

		await harness.subscriptionProviders.markCancelledByUserId({ userId });

		const row = await harness.subscriptionProviders.findByUserId(userId);
		assert(row, "row must exist");
		expect(row.nextCharge).toBeUndefined();
	});
});

describe("GET /account (which account am I in?)", () => {
	it("names the signed-in email in the Profile row so a reader can tell two accounts apart", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await loginUser(harness, "reader@example.com");

		const response = await agent.get("/account");

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		expect(profileLineTexts(doc)).toEqual(["reader@example.com"]);
		expect(profileInitials(doc)).toBe("RE");
		const lede = doc.querySelector(".account__lede");
		assert(lede, "the account page must open with its lede");
		expect(lede.textContent).toBe("Manage your account, billing and preferences.");
		expect(doc.querySelector('meta[name="description"]')?.getAttribute("content")).toBe(
			"Manage your account, billing and preferences.",
		);
	});

	it("names it on the app shell too, the only surface the iOS app renders", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await loginUser(harness, "ios-reader@example.com");

		const response = await agent.get("/account?platform=ios&shell=app");

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		expect(profileLineTexts(doc)).toEqual(["ios-reader@example.com"]);
		expect(profileInitials(doc)).toBe("IR");
		const lede = doc.querySelector(".account__lede");
		assert(lede, "the app-shell account page must open with its lede");
		expect(lede.textContent).toBe("Manage your account and preferences.");
	});

	it("names the reader by their display name over the email, with initials from the name", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, userId } = await loginUser(harness, "reader@example.com");
		await harness.auth.setUserDisplayName({ userId, displayName: DisplayNameSchema.parse("Reader Name") });

		const doc = new JSDOM((await agent.get("/account")).text).window.document;

		expect(profileLineTexts(doc)).toEqual(["Reader Name", "reader@example.com"]);
		expect(
			Array.from(doc.querySelectorAll("[data-test-account-profile-line]")).map((line) => line.className),
		).toEqual(["account-row__title", "account-row__description"]);
		expect(profileInitials(doc)).toBe("RN");
	});
});

describe("GET /account (headed sections)", () => {
	function sections(doc: Document): Element[] {
		return Array.from(doc.querySelectorAll("[data-test-account-section]"));
	}

	function headingOf(doc: Document, section: Element): string {
		const headingId = section.getAttribute("aria-labelledby");
		assert(headingId, "every account section must be labelled by its heading");
		const heading = doc.getElementById(headingId);
		assert(heading, `the heading a section is labelled by (#${headingId}) must render`);
		assert(section.contains(heading), "a section's heading must sit inside it");
		expect(heading.tagName).toBe("H2");
		return heading.textContent ?? "";
	}

	function subscriptionSection(doc: Document): Element {
		const section = doc.querySelector('[data-test-account-section="subscription"]');
		assert(section, "the subscription section must render");
		return section;
	}

	it("stacks the web page into labelled sections, with the plan, payment and billing-history sections in one card under one heading", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const doc = new JSDOM((await agent.get("/account")).text).window.document;

		expect(sections(doc).map((section) => section.getAttribute("data-test-account-section"))).toEqual([
			"profile",
			"security",
			"subscription",
			"connected-apps",
			"appearance",
			"data",
			"danger",
		]);
		expect(sections(doc).map((section) => headingOf(doc, section))).toEqual([
			"Profile",
			"Security",
			"Subscription & billing",
			"Connected apps",
			"Appearance",
			"Your data",
			"Danger zone",
		]);
		const billing = subscriptionSection(doc).querySelector("[data-test-account-billing]");
		assert(billing, "the subscription section must hold one billing card");
		expect(billing.classList.contains("account-section__card")).toBe(true);
		expect(
			Array.from(billing.children).map((child) =>
				["data-test-account-card", "data-test-cards-section", "data-test-billing-history"].find((hook) =>
					child.hasAttribute(hook),
				),
			),
		).toEqual(["data-test-account-card", "data-test-cards-section", "data-test-billing-history"]);
	});

	it("keeps the payment cards' provider error inside the subscription section", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.paymentMethods.listCards = async () => {
			throw new Error("Stripe is down");
		};
		const harness = useApp(fixture);
		const { agent, userId } = await loginUser(harness, "sections-provider-error@example.com");
		await harness.subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_sections_err",
			customerId: "cus_sections_err",
		});

		const doc = new JSDOM((await agent.get("/account")).text).window.document;

		const alert = subscriptionSection(doc).querySelector('[data-test-alert="payment-methods"]');
		assert(alert, "the provider error must render inside the subscription section");
		expect(alert.querySelector("[data-test-alert-message]")?.textContent).toBe(
			"Couldn't load your saved cards. Refresh the page to try again.",
		);
	});

	it("keeps a card notice inside the subscription section", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await activeUserWithCards(harness, "sections-card-notice@example.com", [
			card("pm_primary", true, "4242"),
		]);

		const doc = new JSDOM((await agent.get("/account?error=card_limit")).text).window.document;

		const notice = subscriptionSection(doc).querySelector('[data-test-alert="card-notice"]');
		assert(notice, "the card notice must render inside the subscription section");
		expect(notice.getAttribute("data-test-alert-variant")).toBe("error");
	});

	it("names the section Subscription, and leaves billing out of the lede, on the iOS surface, which hides billing", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const doc = new JSDOM((await agent.get("/account?platform=ios")).text).window.document;

		expect(sections(doc).map((section) => headingOf(doc, section))).toEqual([
			"Profile",
			"Security",
			"Subscription",
			"Connected apps",
			"Appearance",
			"Your data",
			"Danger zone",
		]);
		expect(doc.querySelector(".account__lede")?.textContent).toBe("Manage your account and preferences.");
	});

	it("names it Subscription on the app shell alone too, under the sheet's back link", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const doc = new JSDOM((await agent.get("/account?shell=app")).text).window.document;

		expect(headingOf(doc, subscriptionSection(doc))).toBe("Subscription");
		assert(doc.querySelector("[data-test-account-back-link]"), "the app shell must render its back link");
		expect(doc.body.classList.contains("page-account--chromeless")).toBe(true);
	});
});

describe("GET /account?platform=ios (iOS app surface — Guideline 3.1.1)", () => {
	it("hides the Subscribe CTA, the payment section and billing history for a trialing user, keeping status + danger zone", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "ios-trial@example.com");
		const trialEndsAt = new Date(Date.now() + 7 * ONE_DAY_MS).toISOString();
		await subscriptionProviders.upsertTrialing({ userId, trialEndsAt });

		const response = await agent.get("/account?platform=ios");

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		// The subscription state still renders — the reviewer sees where they stand.
		expect(doc.querySelector("[data-test-account-status]")?.textContent).toContain("free trial");
		// No in-app purchase path: no Subscribe form, no card management section.
		expect(actionKeys(doc)).toEqual([]);
		expectBillingHidden(doc);
		expect(confirmPopoverKeys(doc)).toEqual(["delete-account"]);
		// Apple requires in-app account deletion to stay reachable.
		assert(
			doc.querySelector("[data-test-account-danger]"),
			"danger zone must remain on the iOS surface",
		);
		// The delete form carries ?platform=ios too, so a server-rejected confirmation
		// re-renders commerce-free (mirrors the cancel control above).
		const deleteActions = (["dialog", "fallback"] as const).map((placement) =>
			dangerForm(doc, placement).getAttribute("action"),
		);
		expect(deleteActions).toEqual([
			"/account/delete?utm_source=account&utm_medium=internal&utm_content=delete-account&platform=ios",
			"/account/delete?utm_source=account&utm_medium=internal&utm_content=delete-account&platform=ios",
		]);
	});

	it("keeps Manage subscription and its panel's Cancel control routed through ?platform=ios, and hides the price and billing for an active subscriber", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "ios-active@example.com");
		await subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_ios",
			customerId: "cus_ios",
			plan: "yearly",
		});

		const response = await agent.get("/account?platform=ios");

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		expect(planTitle(doc)).toBe("Yearly plan");
		expect(planPrice(doc).getAttribute("data-price-state")).toBe("hidden");
		expect(actionKeys(doc)).toEqual(["manage-subscription"]);
		expect(hiddenFields(findAction(doc, "manage-subscription")).slice(-2)).toEqual([
			["manage", "subscription"],
			["platform", "ios"],
		]);
		expectBillingHidden(doc);

		const managing = new JSDOM((await agent.get("/account?platform=ios&manage=subscription")).text).window.document;
		expect(actionKeys(managePanel(managing, "subscription"))).toEqual(["cancel-form"]);
		expect(findAction(managing, "cancel-form").getAttribute("action")).toBe(
			"/account/cancel?utm_source=account&utm_medium=internal&utm_content=cancel-form&platform=ios",
		);
	});

	it("hides the renewal line and never asks Stripe for a price on the iOS surface", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "ios-price@example.com");
		await subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_ios",
			customerId: "cus_ios",
		});
		harness.subscriptionBilling.seedNextCharge({
			subscriptionId: "sub_ios",
			nextCharge: {
				at: new Date(Date.now() + 12 * ONE_DAY_MS).toISOString(),
				amountMinor: 4900,
				currency: "usd",
			},
		});

		const response = await agent.get("/account?platform=ios");

		const doc = new JSDOM(response.text).window.document;
		const line = doc.querySelector("[data-test-next-charge]");
		assert(line, "the renewal element still renders, just hidden");
		expect(line.getAttribute("data-next-charge-state")).toBe("hidden");
		expect(harness.subscriptionBilling.nextChargeLookups()).toEqual([]);
	});
});

describe("POST /account/cancel?platform=ios", () => {
	it("preserves the iOS surface across the post-redirect so the re-render stays commerce-free", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "ios-cancel@example.com");
		await subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_cancel",
			customerId: "cus_cancel",
		});

		const response = await agent.post("/account/cancel?platform=ios");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account?cancelling=1&platform=ios");
	});

	it("preserves the app shell too, so the re-render stays chromeless instead of dropping the web shell back in", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "shell-cancel@example.com");
		await subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_shell_cancel",
			customerId: "cus_shell_cancel",
		});

		const response = await agent.post("/account/cancel?platform=ios&shell=app");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account?cancelling=1&platform=ios&shell=app");
	});
});

describe("GET /account?platform=ios&shell=app (the app's in-app web sheet)", () => {
	it("renders chromeless — no header, nav, footer or banner area, so no link can yank the user into a logged-out browser", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get("/account?platform=ios&shell=app");

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		assert(doc.querySelector("[data-test-account-card]"), "the account page itself must render");
		expect(doc.querySelector(".header")).toBeNull();
		expect(doc.querySelector(".nav")).toBeNull();
		expect(doc.querySelector(".footer")).toBeNull();
		expect(doc.querySelector(".banner-area")).toBeNull();
		expect(doc.body.classList.contains("page-account--chromeless")).toBe(true);
	});

	it("gives the sheet its only way back: the close deep link, inside <main> so a boosted swap can't destroy it", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const doc = new JSDOM((await agent.get("/account?platform=ios&shell=app")).text).window.document;

		const back = doc.querySelector("[data-test-account-back-link]");
		assert(back, "the chromeless account page must render a back link");
		expect(back.getAttribute("href")).toBe("readplace://reader/close");
		// Every form on the page is hx-target="main" hx-swap="outerHTML", so anything
		// outside <main> is destroyed on the first boosted POST.
		const main = doc.querySelector("main.account");
		assert(main, "the account page must render its <main>");
		expect(main.contains(back)).toBe(true);
		// A boosted link would XHR the deep link and fail silently; the delegate only
		// sees a real navigation.
		expect(back.hasAttribute("hx-boost")).toBe(false);
	});

	it("carries the page styles inside <main> so a boosted swap brings its own CSS", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const doc = new JSDOM((await agent.get("/account?platform=ios&shell=app")).text).window.document;

		const style = doc.querySelector("main.account style");
		assert(style, "the page styles must be injected into <main>");
		expect(style.textContent).toContain(".account__back");
	});

	it("serves local-time (the trial cutoff would otherwise freeze at the server's UTC baseline) but neither WebMCP nor the Stripe card glue", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "shell-scripts@example.com");
		await subscriptionProviders.upsertTrialing({
			userId,
			trialEndsAt: new Date(Date.now() + 7 * ONE_DAY_MS).toISOString(),
		});

		const response = await agent.get("/account?platform=ios&shell=app");
		const doc = new JSDOM(response.text).window.document;

		assert(
			doc.querySelector("[data-test-account-status] time[data-local-time]"),
			"the trial cutoff renders as a localisable <time>",
		);
		expect(doc.querySelector('script[src*="/client-dist/local-time.client.js"]')).not.toBeNull();
		// No in-page AI agent inside a WKWebView, and withoutCommerce guarantees the
		// Stripe Elements container can never render here.
		expect(doc.querySelector('script[src*="/client-dist/webmcp.client.js"]')).toBeNull();
		expect(doc.querySelector('script[src*="/client-dist/account-cards.client.js"]')).toBeNull();
	});

	it("still hides commerce, and stamps both markers on the surviving controls so a boosted request returns chromeless", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "shell-commerce@example.com");
		await subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_shell",
			customerId: "cus_shell",
		});

		const doc = new JSDOM((await agent.get("/account?platform=ios&shell=app")).text).window.document;

		expectBillingHidden(doc);
		expect(actionKeys(doc)).toEqual(["manage-subscription"]);
		expect(hiddenFields(findAction(doc, "manage-subscription")).slice(-2)).toEqual([
			["platform", "ios"],
			["shell", "app"],
		]);
		const deleteActions = (["dialog", "fallback"] as const).map((placement) =>
			dangerForm(doc, placement).getAttribute("action"),
		);
		expect(deleteActions).toEqual([
			"/account/delete?utm_source=account&utm_medium=internal&utm_content=delete-account&platform=ios&shell=app",
			"/account/delete?utm_source=account&utm_medium=internal&utm_content=delete-account&platform=ios&shell=app",
		]);
	});

	it("treats the app shell as an iOS surface on its own — the app never has to carry both markers for commerce to stay hidden", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "shell-only@example.com");
		await subscriptionProviders.upsertTrialing({
			userId,
			trialEndsAt: new Date(Date.now() + 7 * ONE_DAY_MS).toISOString(),
		});

		const doc = new JSDOM((await agent.get("/account?shell=app")).text).window.document;

		expect(doc.body.classList.contains("page-account--chromeless")).toBe(true);
		// Guideline 3.1.1 holds off the shell marker alone: no Subscribe CTA, no cards.
		expect(actionKeys(doc)).toEqual([]);
		expectBillingHidden(doc);
		expect(confirmPopoverKeys(doc)).toEqual(["delete-account"]);
	});

	it("keeps the full web shell for a store build that predates the marker — it sends platform=ios alone and cannot drive a deep link", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const doc = new JSDOM((await agent.get("/account?platform=ios")).text).window.document;

		expect(doc.querySelector(".header")).not.toBeNull();
		expect(doc.querySelector("[data-test-account-back-link]")).toBeNull();
		expect(doc.body.classList.contains("page-account--chromeless")).toBe(false);
		// The old surface still satisfies Guideline 3.1.1.
		expectBillingHidden(doc);
	});

	it("opens the subscription panel with both markers on the cancel form's action and on Done's hidden fields", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, userId } = await loginUser(harness, "shell-manage@example.com");
		await harness.subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_shell_manage",
			customerId: "cus_shell_manage",
		});

		const doc = new JSDOM((await agent.get("/account?platform=ios&shell=app&manage=subscription")).text).window.document;

		expect(managePanel(doc, "subscription").getAttribute("data-manage-panel-state")).toBe("open");
		expect(findAction(doc, "cancel-form").getAttribute("action")).toBe(
			"/account/cancel?utm_source=account&utm_medium=internal&utm_content=cancel-form&platform=ios&shell=app",
		);
		expect(trailingActionKeys(doc)).toEqual(["done"]);
		expect(hiddenFields(findAction(doc, "done"))).toEqual([
			["utm_source", "account"],
			["utm_medium", "internal"],
			["utm_content", "done"],
			["platform", "ios"],
			["shell", "app"],
		]);
	});

	it("leaves the plain web account page untouched — shell, cards script and no back link", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get("/account");
		const doc = new JSDOM(response.text).window.document;

		expect(doc.querySelector(".header")).not.toBeNull();
		expect(doc.querySelector("[data-test-account-back-link]")).toBeNull();
		expect(doc.body.classList.contains("page-account")).toBe(true);
		expect(doc.body.classList.contains("page-account--chromeless")).toBe(false);
		expect(doc.querySelector('script[src*="/client-dist/account-cards.client.js"]')).not.toBeNull();
	});
});

describe("GET /account?error=subscribe_failed", () => {
	it("offers the subscribe action again and says nothing was charged, so a failed checkout is not a dead end", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "retryable-subscribe-error@example.com");
		await subscriptionProviders.upsertTrialing({
			userId,
			trialEndsAt: new Date(Date.now() + 5 * ONE_DAY_MS).toISOString(),
		});

		const response = await agent.get("/account?error=subscribe_failed");
		const doc = new JSDOM(response.text).window.document;

		const card = doc.querySelector("[data-test-account-card]");
		assert(card, "account card must render");
		expect(card.getAttribute("data-test-account-state")).toBe("error-subscribe-failed");
		const body = doc.querySelector('[data-test-alert="account-subscription"] [data-test-alert-message]');
		assert(body, "the retryable error body must render");
		expect(body.textContent).toContain("nothing was charged");
		const alert = body.closest('[data-test-alert="account-subscription"]');
		assert(alert);
		expect(alert.getAttribute("data-test-alert-variant")).toBe("error");
		expect(alert.getAttribute("role")).toBe("alert");
		expect(alert.classList.contains("alert--visible")).toBe(true);
		expectAlertTitleBetweenHeadings(doc);
		expect(planTitle(doc)).toBe("Subscription");
		expect(
			Array.from(doc.querySelectorAll("[data-test-account-action]")).map((el) =>
				el.getAttribute("data-test-account-action"),
			),
		).toContain("subscribe");
		expect(confirmPopoverKeys(doc)).toEqual(["account-profile", "delete-account", "subscribe-plans"]);
	});
});

describe("GET /account?error=payment_method", () => {
	it("renders the payment-method error card with a support email link", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "pay-err@example.com");
		await subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_pay_err",
			customerId: "cus_pay_err",
			plan: "triennial",
		});
		await subscriptionProviders.markCancelledByUserId({ userId });

		const response = await agent.get("/account?error=payment_method");

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		const card = findCard(doc);
		expect(card.classList.contains("account-card--error-payment-method")).toBe(true);
		expect(card.getAttribute("data-test-account-state")).toBe("error-payment-method");

		const heading = doc.querySelector('[data-test-alert="account-subscription"] [data-test-alert-title]');
		assert(heading, "error heading must render");
		expectAlertTitleBetweenHeadings(doc);
		expect(planTitle(doc)).toBe("3-year plan");
		expect(planChips(doc)).toEqual([]);
		const subscriptionAlert = heading.closest('[data-test-alert="account-subscription"]');
		assert(subscriptionAlert, "the subscription error must render an alert");
		expect(subscriptionAlert.getAttribute("data-test-alert-variant")).toBe("error");
		expect(subscriptionAlert.getAttribute("role")).toBe("alert");
		expect(subscriptionAlert.classList.contains("alert--visible")).toBe(true);

		const supportLink = doc.querySelector("[data-test-account-support-link]");
		assert(supportLink, "support email link must render");
		expect(supportLink.getAttribute("href")).toBe("mailto:support@readplace.com");

		expect(actionKeys(card)).toEqual([]);
	});
});

describe("GET /account (trialing inside trial window)", () => {
	it("renders the trial card with days-left text and a Subscribe form — no Cancel button while on trial", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "trial@example.com");
		const trialEndsAt = new Date(Date.now() + 7 * ONE_DAY_MS).toISOString();
		await subscriptionProviders.upsertTrialing({ userId, trialEndsAt });

		const response = await agent.get("/account");

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		const card = findCard(doc);
		expect(card.classList.contains("account-card--trial")).toBe(true);
		expect(card.getAttribute("data-test-account-state")).toBe("trial");
		const status = doc.querySelector("[data-test-account-status]")?.textContent ?? "";
		expect(status).toContain("free trial");
		expect(status).toContain("7 days left");
		expect(planTitle(doc)).toBe("Free trial");
		expect(planChips(doc)).toEqual([]);

		expect(actionKeys(doc)).toEqual(["subscribe"]);
		const subscribe = findAction(doc, "subscribe");
		expect(subscribe.tagName.toLowerCase()).toBe("form");
		expect(subscribe.getAttribute("action")).toBe("/account/subscribe?utm_source=account&utm_medium=internal&utm_content=subscribe");
	});
});

describe("GET /account (inactive — trial expired vs cancelled render identical DOM)", () => {
	it("renders the inactive card with a Subscribe form", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "expired@example.com");
		await subscriptionProviders.upsertTrialing({
			userId,
			trialEndsAt: new Date(Date.now() - ONE_DAY_MS).toISOString(),
		});

		const response = await agent.get("/account");

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		const card = findCard(doc);
		expect(card.classList.contains("account-card--inactive")).toBe(true);
		expect(card.getAttribute("data-test-account-state")).toBe("inactive");
		expect(planTitle(doc)).toBe("Subscription");
		expect(planChips(doc)).toEqual([["Inactive", "chip chip--status chip--error"]]);
		expect(doc.querySelector("[data-test-account-status]")?.textContent).toBe("");
		expect(actionKeys(doc)).toEqual(["subscribe"]);
	});

	it("byte-for-byte identical card DOM for trial-expired vs cancelled — reason does not leak", async () => {
		const fixtureA = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harnessA = useApp(fixtureA);
		const { agent: agentA, userId: userIdA } = await loginUser(harnessA, "expired@example.com");
		await harnessA.subscriptionProviders.upsertTrialing({
			userId: userIdA,
			trialEndsAt: new Date(Date.now() - ONE_DAY_MS).toISOString(),
		});
		const responseA = await agentA.get("/account");
		const cardA = new JSDOM(responseA.text).window.document
			.querySelector("[data-test-account-card]")?.outerHTML;
		assert(cardA, "card A must render");

		const fixtureB = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harnessB = useApp(fixtureB);
		const { agent: agentB, userId: userIdB } = await loginUser(harnessB, "cancelled@example.com");
		await harnessB.subscriptionProviders.upsertActive({
			userId: userIdB,
			subscriptionId: "sub_cancelled",
			customerId: "cus_cancelled",
		});
		await harnessB.subscriptionProviders.markCancelledByUserId({ userId: userIdB });
		const responseB = await agentB.get("/account");
		const cardB = new JSDOM(responseB.text).window.document
			.querySelector("[data-test-account-card]")?.outerHTML;
		assert(cardB, "card B must render");

		expect(cardA).toEqual(cardB);
	});
});

describe("GET /account (plan-chooser popover wiring)", () => {
	function expectPlanChooser(doc: Document) {
		const trigger = findCard(doc).querySelector('[data-test-action="subscribe-plans-open"]');
		assert(trigger, "the card must render the plan-chooser trigger");
		expect(trigger.getAttribute("popovertarget")).toBe(SUBSCRIBE_PLANS_POPOVER_ID);
		expect(trigger.classList.contains("subscribe-plans__trigger")).toBe(true);
		const fallback = findAction(doc, "subscribe");
		expect(fallback.classList.contains("subscribe-plans__fallback")).toBe(true);
		expect(confirmPopoverKeys(doc)).toEqual(["account-profile", "delete-account", "subscribe-plans"]);
		expect(subscribePlanKeys(doc)).toEqual(["yearly", "monthly", "triennial"]);
	}

	it("offers a trialing user the three-plan chooser: the trigger opens the popover and the subscribe form stays as the no-JS fallback", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "trial-plans@example.com");
		await subscriptionProviders.upsertTrialing({
			userId,
			trialEndsAt: new Date(Date.now() + 7 * ONE_DAY_MS).toISOString(),
		});

		const response = await agent.get("/account");

		expect(response.status).toBe(200);
		expectPlanChooser(new JSDOM(response.text).window.document);
	});

	it("offers a cancelled user the same three-plan chooser on the re-subscribe path", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "cancelled-plans@example.com");
		await subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_plans_cancelled",
			customerId: "cus_plans_cancelled",
		});
		await subscriptionProviders.markCancelledByUserId({ userId });

		const response = await agent.get("/account");

		expect(response.status).toBe(200);
		expectPlanChooser(new JSDOM(response.text).window.document);
	});

	it("starts a returning reader's chooser on the plan their cancelled subscription carried, the plan the no-JS fallback charges", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders, subscriptionBilling } = harness;
		const { agent, userId } = await loginUser(harness, "cancelled-monthly-plans@example.com");
		await subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_was_monthly",
			customerId: "cus_was_monthly",
			plan: "monthly",
		});
		await subscriptionProviders.markCancelledByUserId({ userId });

		const response = await agent.get("/account");
		const doc = new JSDOM(response.text).window.document;
		await agent.post(findAction(doc, "subscribe").getAttribute("action") ?? "");

		expect(checkedSubscribePlanKeys(doc)).toEqual(["monthly"]);
		expect(subscriptionBilling.createdSubscriptions().map((s) => s.priceId)).toEqual([
			"price_test_monthly",
		]);
	});

	it("renders no plan popover for an active subscriber — beside the profile and delete dialogs, the page's popover key list carries exactly what the card's actions declare", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "active-plans@example.com");
		await subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_plans_active",
			customerId: "cus_plans_active",
		});

		const response = await agent.get("/account");

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		expect(actionKeys(doc)).toEqual(["manage-subscription", "view-invoices"]);
		expect(confirmPopoverKeys(doc)).toEqual(["account-profile", "delete-account"]);
	});
});

function cancelButton(doc: Document): HTMLButtonElement {
	const button = findAction(doc, "cancel-form").querySelector("button");
	assert(button, "the cancel form must contain a submit button");
	return button;
}

describe("GET /account?cancelling=1 (the pending page after POST /account/cancel)", () => {
	it("keeps the Cancel button but renders it disabled, and polls itself — clicking again would enqueue a duplicate command", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "cancelling@example.com");
		await subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_in_flight",
			customerId: "cus_in_flight",
		});

		const response = await agent.get("/account?cancelling=1");

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		const notice = doc.querySelector("[data-test-cancelling-notice]");
		assert(notice, "cancelling notice must render");
		expect(notice.textContent).toContain("Cancellation in progress");
		const panel = managePanel(doc, "subscription");
		expect(panel.getAttribute("data-manage-panel-state")).toBe("open");
		expect(panel.contains(notice)).toBe(true);
		expect(actionKeys(panel)).toEqual(["cancel-form"]);
		expect(trailingActionKeys(doc)).toEqual([]);
		expect(cancelButton(doc).disabled).toBe(true);
		expect(cancelButton(doc).textContent).toBe("Cancelling…");
		expect(findCard(doc).getAttribute("data-test-account-poll")).toBe("polling");
		expect(findCard(doc).getAttribute("hx-get")).toBe("/account/status?cancelling=1&poll=1");
	});

	it("disables the Cancel button for the duration of its own POST, so a double-click can't submit twice", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "double-click@example.com");
		await subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_dbl",
			customerId: "cus_dbl",
		});

		const response = await agent.get("/account?manage=subscription");

		const doc = new JSDOM(response.text).window.document;
		const form = findAction(doc, "cancel-form");
		expect(form.getAttribute("hx-disabled-elt")).toBe("find button");
		expect(cancelButton(doc).disabled).toBe(false);
		expect(findCard(doc).getAttribute("data-test-account-poll")).toBe("idle");
	});

	it("renders an enabled Cancel button, no polling, and no in-progress notice when ?cancelling=1 is absent", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "no-notice@example.com");
		await subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_no_notice",
			customerId: "cus_no_notice",
		});

		const response = await agent.get("/account?manage=subscription");

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		expect(findCard(doc).getAttribute("data-test-account-poll")).toBe("idle");
		expect(cancelButton(doc).textContent).toBe("Cancel subscription");
		expect(cancelButton(doc).disabled).toBe(false);
		expect(managePanel(doc, "subscription").querySelectorAll("[data-test-cancelling-notice]")).toHaveLength(0);
	});
});

describe("GET /account/status — the poll fragment the cancelling card swaps itself with", () => {
	it("keeps polling while the row is still active, without touching Stripe — the async chain has not landed yet", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		let cardReads = 0;
		const listCards = fixture.paymentMethods.listCards;
		fixture.paymentMethods.listCards = async (input) => {
			cardReads += 1;
			return listCards(input);
		};
		const harness = useApp(fixture);
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "poll-active@example.com");
		await subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_poll",
			customerId: "cus_poll",
			plan: "yearly",
		});

		const response = await agent.get("/account/status?cancelling=1&poll=1");

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		expect(planTitle(doc)).toBe("Yearly plan");
		expect(planChips(doc)).toEqual([["Active", "chip chip--status chip--success"]]);
		expect(findCard(doc).getAttribute("data-test-account-poll")).toBe("polling");
		expect(findCard(doc).getAttribute("hx-get")).toBe("/account/status?cancelling=1&poll=2");
		expect(cancelButton(doc).disabled).toBe(true);
		expect(cardReads).toBe(0);
	});

	it("stops polling and offers reactivation once the cancellation has landed", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "poll-landed@example.com");
		await subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_landed",
			customerId: "cus_landed",
		});
		await subscriptionProviders.markPendingCancellation({
			userId,
			cancellationEffectiveAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
		});

		const response = await agent.get("/account/status?cancelling=1&poll=2");

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		expect(actionKeys(doc)).toEqual(["reactivate-form"]);
		expect(findCard(doc).getAttribute("data-test-account-poll")).toBe("idle");
		expect(findCard(doc).getAttribute("hx-get")).toBeNull();
	});

	it("gives up rather than polling forever when the async chain never lands", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "poll-wedged@example.com");
		await subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_wedged",
			customerId: "cus_wedged",
		});

		const response = await agent.get(
			`/account/status?cancelling=1&poll=${ACCOUNT_CANCEL_MAX_POLLS}`,
		);

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		expect(findCard(doc).getAttribute("data-test-account-poll")).toBe("idle");
		const notice = doc.querySelector("[data-test-cancelling-notice]");
		assert(notice, "the stalled notice must render");
		expect(notice.textContent).toContain("taking longer than usual");
	});

	it("carries ?platform=ios onto the next poll, so an in-app cancelling card cannot poll its way back onto the web surface", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "poll-ios@example.com");
		await subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_poll_ios",
			customerId: "cus_poll_ios",
		});

		const response = await agent.get("/account/status?cancelling=1&poll=1&platform=ios");

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		expect(findCard(doc).getAttribute("hx-get")).toBe(
			"/account/status?cancelling=1&poll=2&platform=ios",
		);
		expect(actionKeys(doc)).toEqual(["cancel-form"]);
		expect(findAction(doc, "cancel-form").getAttribute("action")).toBe(
			"/account/cancel?utm_source=account&utm_medium=internal&utm_content=cancel-form&platform=ios",
		);
		expect(cancelButton(doc).disabled).toBe(true);
	});

	it("stamps the shell marker alongside it, so the app sheet's poll keeps both markers on every hop", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "poll-shell@example.com");
		await subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_poll_shell",
			customerId: "cus_poll_shell",
		});

		const response = await agent.get(
			"/account/status?cancelling=1&poll=1&platform=ios&shell=app",
		);

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		expect(findCard(doc).getAttribute("hx-get")).toBe(
			"/account/status?cancelling=1&poll=2&platform=ios&shell=app",
		);
		expect(findAction(doc, "cancel-form").getAttribute("action")).toBe(
			"/account/cancel?utm_source=account&utm_medium=internal&utm_content=cancel-form&platform=ios&shell=app",
		);
	});

	it("strips the Reactivate CTA when the cancellation lands mid-poll — an in-app poll must not surface a purchase path (Guideline 3.1.1)", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "poll-ios-landed@example.com");
		await subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_ios_landed",
			customerId: "cus_ios_landed",
		});
		await subscriptionProviders.markPendingCancellation({
			userId,
			cancellationEffectiveAt: new Date(Date.now() + 5 * ONE_DAY_MS).toISOString(),
		});

		const response = await agent.get("/account/status?cancelling=1&poll=2&platform=ios");

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		expect(actionKeys(doc)).toEqual([]);
		expect(findCard(doc).getAttribute("data-test-account-poll")).toBe("idle");
		expect(findCard(doc).getAttribute("hx-get")).toBeNull();
	});
});

describe("POST /account/cancel — single entrypoint, redirects to the pending page", () => {
	it("publishes CancelSubscriptionCommand and redirects to /account?cancelling=1 — does NOT call Stripe from the HTTP layer", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const published: Array<{ userId: string }> = [];
		fixture.events.publishCancelSubscriptionCommand = async ({ userId }) => {
			published.push({ userId });
		};
		const harness = useApp(fixture);
		const { agent, userId } = await loginUser(harness, "cancel-me@example.com");
		await harness.subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_active_xyz",
			customerId: "cus_active_xyz",
		});

		const response = await agent.post("/account/cancel");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account?cancelling=1");
		expect(published).toHaveLength(1);
		expect(published[0].userId).toBe(userId);
	});

	it("publishes the command even for trial users (handler decides the branch downstream)", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const published: Array<{ userId: string }> = [];
		fixture.events.publishCancelSubscriptionCommand = async ({ userId }) => {
			published.push({ userId });
		};
		const harness = useApp(fixture);
		const { agent, userId } = await loginUser(harness, "trial-cancel@example.com");
		await harness.subscriptionProviders.upsertTrialing({
			userId,
			trialEndsAt: new Date(Date.now() + 5 * ONE_DAY_MS).toISOString(),
		});

		const response = await agent.post("/account/cancel");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account?cancelling=1");
		expect(published).toHaveLength(1);
	});

	it("noop POST still redirects to the pending page (idempotent — POST-redirect-GET)", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const published: Array<{ userId: string }> = [];
		fixture.events.publishCancelSubscriptionCommand = async ({ userId }) => {
			published.push({ userId });
		};
		const harness = useApp(fixture);
		// Founding member — no subscription row to cancel. POST is still safe:
		// it publishes the command (handler is idempotent) and lands the user
		// on the pending page rather than 4xx-ing.
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.post("/account/cancel");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account?cancelling=1");
		expect(published).toHaveLength(1);
	});

	it("redirects unauthenticated POST /account/cancel to /login", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).post("/account/cancel");
		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/login?return=%2Faccount%2Fcancel");
	});
});

describe("POST /account/subscribe", () => {
	it("creates a Stripe checkout session for a trialing user and 303s to checkout", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "trial-subscribe@example.com");
		await subscriptionProviders.upsertTrialing({
			userId,
			trialEndsAt: new Date(Date.now() + 5 * ONE_DAY_MS).toISOString(),
		});

		const response = await agent.post("/account/subscribe");

		expect(response.status).toBe(303);
		const location = response.headers.location;
		assert(typeof location === "string" && location.includes("checkout.stripe.test"));

		const started = harness.subscriptionEvents.events.filter((e) => e.event === "checkout_started");
		expect(started).toHaveLength(1);
		expect(started[0].variant).toBe(CHECKOUT_VARIANTS.trialCheckout);
		expect(started[0].user_id).toBe(userId);
		expect(started[0].checkout_session_id).toMatch(/^cs_test_/);
	});

	it("creates a Stripe checkout session for a trial-expired user (no second free trial)", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "trial-expired-subscribe@example.com");
		await subscriptionProviders.upsertTrialing({
			userId,
			trialEndsAt: new Date(Date.now() - ONE_DAY_MS).toISOString(),
		});

		const response = await agent.post("/account/subscribe");

		expect(response.status).toBe(303);
		const location = response.headers.location;
		assert(typeof location === "string" && location.includes("checkout.stripe.test"));
	});

	it("threads trialEndsAt into the checkout session AND the pending signup when ≥48h of trial remains, so Stripe attaches the card without forfeiting the trial", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const realCreateCheckoutSession = fixture.hostedCheckout.createCheckoutSession;
		const checkoutCalls: { trialEndsAt?: string }[] = [];
		const createdSessionIds: Parameters<
			typeof fixture.pendingSignup.consumePendingSignup
		>[0][] = [];
		fixture.hostedCheckout.createCheckoutSession = async (params) => {
			checkoutCalls.push(params);
			const session = await realCreateCheckoutSession(params);
			createdSessionIds.push(session.id);
			return session;
		};
		const harness = useApp(fixture);
		const { subscriptionProviders, pendingSignup } = harness;
		const { agent, userId } = await loginUser(harness, "trial-keeps-trial@example.com");
		const trialEndsAt = new Date(Date.now() + 5 * ONE_DAY_MS).toISOString();
		await subscriptionProviders.upsertTrialing({ userId, trialEndsAt });

		const response = await agent.post("/account/subscribe");

		expect(response.status).toBe(303);
		expect(checkoutCalls).toHaveLength(1);
		expect(checkoutCalls[0].trialEndsAt).toBe(trialEndsAt);
		expect(createdSessionIds).toHaveLength(1);
		const pending = await pendingSignup.consumePendingSignup(createdSessionIds[0]);
		assert(pending, "pending signup must be stored for the checkout session");
		expect(pending.trialEndsAt).toBe(trialEndsAt);
	});

	it("omits trialEndsAt when under 48h of trial remains — Stripe rejects a trial_end that close, so the checkout charges immediately", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const realCreateCheckoutSession = fixture.hostedCheckout.createCheckoutSession;
		const checkoutCalls: { trialEndsAt?: string }[] = [];
		fixture.hostedCheckout.createCheckoutSession = async (params) => {
			checkoutCalls.push(params);
			return realCreateCheckoutSession(params);
		};
		const harness = useApp(fixture);
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "trial-almost-over@example.com");
		await subscriptionProviders.upsertTrialing({
			userId,
			trialEndsAt: new Date(Date.now() + ONE_DAY_MS).toISOString(),
		});

		const response = await agent.post("/account/subscribe");

		expect(response.status).toBe(303);
		expect(checkoutCalls).toHaveLength(1);
		expect(checkoutCalls[0].trialEndsAt).toBeUndefined();
	});

	it("never threads a trialEndsAt through the cancelled-user checkout fallback, even when the row carries a stale one", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const realCreateCheckoutSession = fixture.hostedCheckout.createCheckoutSession;
		const checkoutCalls: { trialEndsAt?: string }[] = [];
		fixture.hostedCheckout.createCheckoutSession = async (params) => {
			checkoutCalls.push(params);
			return realCreateCheckoutSession(params);
		};
		const harness = useApp(fixture);
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "cancelled-stale-trial@example.com");
		subscriptionProviders.seedRow({
			userId,
			provider: "stripe",
			status: "cancelled",
			trialEndsAt: new Date(Date.now() + 5 * ONE_DAY_MS).toISOString(),
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		});

		const response = await agent.post("/account/subscribe");

		expect(response.status).toBe(303);
		expect(checkoutCalls).toHaveLength(1);
		expect(checkoutCalls[0].trialEndsAt).toBeUndefined();
	});

	it("Phase 3: cancelled user with customerId resubscribes in ONE click via Stripe subscriptions.create (NO checkout UI)", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders, subscriptionBilling } = harness;
		const { agent, userId } = await loginUser(harness, "one-click@example.com");
		await subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_was_paid",
			customerId: "cus_was_paid",
		});
		await subscriptionProviders.markCancelledByUserId({ userId });

		const response = await agent.post("/account/subscribe");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account");
		// The one-click path calls Stripe subscriptions.create with the saved customer.
		const created = subscriptionBilling.createdSubscriptions();
		expect(created).toHaveLength(1);
		expect(created[0].customerId).toBe("cus_was_paid");
		expect(created[0].priceId).toBe("price_test_yearly");
		// userId rides into Stripe metadata so the subscription is traceable to this account.
		expect(created[0].userId).toBe(userId);
		expect(created[0].onUnpaidFirstInvoice).toBe("refuse");

		// Row is now active with the NEW subscriptionId, replacing sub_was_paid.
		const row = await subscriptionProviders.findByUserId(userId);
		assert(row, "row must exist");
		expect(row.status).toBe("active");
		expect(row.subscriptionId).toBe(created[0].subscriptionId);
		expect(row.customerId).toBe("cus_was_paid");

		expect(harness.subscriptionEvents.events.filter((e) => e.event === "checkout_started")).toHaveLength(0);

		const resubscribed = harness.subscriptionEvents.events.filter(
			(e) => e.event === "resubscribe_completed",
		);
		expect(resubscribed).toHaveLength(1);
		expect(resubscribed[0].user_id).toBe(userId);
		expect(resubscribed[0].subscription_id).toBe(created[0].subscriptionId);
		expect(resubscribed[0].paid_now).toBe(true);
	});

	it("cancelled user with customerId — saved-card Stripe call throws → fall back to Stripe Checkout (not the dead-end error page), row stays cancelled until the new checkout completes", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		// Replace the stripe subscriptions wrapper with one that throws —
		// simulates a declined/expired saved card.
		fixture.subscriptionBilling.createSubscriptionOnExistingCustomer = async () => {
			throw new Error(
				"Stripe createSubscriptionOnExistingCustomer failed (402): Your card was declined.",
			);
		};
		const errorLines: string[] = [];
		fixture.shared.logError = (message: string) => {
			errorLines.push(message);
		};
		const harness = useApp(fixture);
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "card-declined@example.com");
		await subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_was_paid",
			customerId: "cus_will_fail",
		});
		await subscriptionProviders.markCancelledByUserId({ userId });

		const response = await agent.post("/account/subscribe");

		expect(response.status).toBe(303);
		const location = response.headers.location;
		assert(
			typeof location === "string" && location.includes("checkout.stripe.test"),
			"on saved-card failure the user is sent to Stripe Checkout to enter a new card",
		);

		// Row must remain cancelled until the new Checkout completes — the
		// checkout-success handler is what upserts the new subscriptionId.
		const row = await subscriptionProviders.findByUserId(userId);
		assert(row, "row must still exist");
		expect(row.status).toBe("cancelled");

		const started = harness.subscriptionEvents.events.filter((e) => e.event === "checkout_started");
		expect(started).toHaveLength(1);
		expect(started[0].variant).toBe(CHECKOUT_VARIANTS.cardDeclineFallback);
		expect(started[0].user_id).toBe(userId);

		const declineLines = errorLines.filter((line) => line.includes("[subscribe/cancelled]"));
		expect(declineLines).toHaveLength(1);
		expect(declineLines[0]).toContain(userId);
		expect(declineLines[0]).toContain(
			"Stripe createSubscriptionOnExistingCustomer failed (402): Your card was declined.",
		);
	});

	it("cancelled user — saved-card charge SUCCEEDS but the active-row upsert throws → 303 /account?error=payment_method, and NOT a card_decline_fallback checkout (the card was already charged, so it is not a decline)", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.subscriptionProviders.upsertActive = async () => {
			throw new Error("dynamo down");
		};
		const harness = useApp(fixture);
		const { subscriptionProviders, subscriptionBilling } = harness;
		const { agent, userId } = await loginUser(harness, "resub-upsert-fails@example.com");
		// Seed the cancelled-after-paid row directly — upsertActive is rigged to throw.
		subscriptionProviders.seedRow({
			userId,
			provider: "stripe",
			status: "cancelled",
			subscriptionId: "sub_was_paid",
			customerId: "cus_was_paid",
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		});

		const response = await agent.post("/account/subscribe");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account?error=payment_method");
		expect(subscriptionBilling.createdSubscriptions()).toHaveLength(1);
		expect(
			harness.subscriptionEvents.events.filter((e) => e.event === "checkout_started"),
		).toHaveLength(0);
		expect(
			harness.subscriptionEvents.events.filter((e) => e.event === "resubscribe_completed"),
		).toHaveLength(0);
	});

	it("trialing user via HTMX (hx-boost) — 200 with HX-Redirect to Stripe, not 303 Location (HTMX would XHR-follow cross-origin and fail to navigate)", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "trial-htmx@example.com");
		await subscriptionProviders.upsertTrialing({
			userId,
			trialEndsAt: new Date(Date.now() + 5 * ONE_DAY_MS).toISOString(),
		});

		const response = await agent.post("/account/subscribe").set("HX-Request", "true");

		expect(response.status).toBe(200);
		expect(response.headers.location).toBeUndefined();
		const hxRedirect = response.headers["hx-redirect"];
		assert(typeof hxRedirect === "string", "HX-Redirect header must be set for HTMX clients");
		expect(hxRedirect).toContain("checkout.stripe.test");
		expect(response.headers["content-type"]).toContain("text/html");
	});

	it("cancelled user without customerId via HTMX (hx-boost) — fallback to checkout also uses HX-Redirect", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "cancelled-fallback-htmx@example.com");
		subscriptionProviders.seedRow({
			userId,
			provider: "stripe",
			status: "cancelled",
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		});

		const response = await agent.post("/account/subscribe").set("HX-Request", "true");

		expect(response.status).toBe(200);
		const hxRedirect = response.headers["hx-redirect"];
		assert(typeof hxRedirect === "string", "HX-Redirect header must be set for HTMX clients");
		expect(hxRedirect).toContain("checkout.stripe.test");
	});

	it("trialing user — Stripe Checkout throws → 303 to the retryable error, never the card-on-file one, because a trialing reader has never given a card", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.hostedCheckout.createCheckoutSession = async () => {
			throw new Error("Stripe createCheckoutSession failed (400): something bad");
		};
		const harness = useApp(fixture);
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "trial-stripe-down@example.com");
		await subscriptionProviders.upsertTrialing({
			userId,
			trialEndsAt: new Date(Date.now() + 5 * ONE_DAY_MS).toISOString(),
		});

		const response = await agent.post("/account/subscribe");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account?error=subscribe_failed");

		expect(harness.subscriptionEvents.events.filter((e) => e.event === "checkout_started")).toHaveLength(0);
	});

	it("keeps the card-on-file error for a lapsed subscriber whose saved card is the plausible cause", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.subscriptionBilling.createSubscriptionOnExistingCustomer = async () => {
			throw new Error("card_declined");
		};
		fixture.hostedCheckout.createCheckoutSession = async () => {
			throw new Error("Stripe createCheckoutSession failed (400): something bad");
		};
		const harness = useApp(fixture);
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "lapsed-card-error@example.com");
		await subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_was_paid",
			customerId: "cus_was_paid",
		});
		await subscriptionProviders.markCancelledByUserId({ userId });

		const response = await agent.post("/account/subscribe");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account?error=payment_method");
	});

	it("cancelled user without customerId — checkout fallback throws → the retryable error, since a row with no saved customer has no card to blame", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.hostedCheckout.createCheckoutSession = async () => {
			throw new Error("Stripe createCheckoutSession failed (400): something bad");
		};
		const harness = useApp(fixture);
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "cancelled-fallback-stripe-down@example.com");
		subscriptionProviders.seedRow({
			userId,
			provider: "stripe",
			status: "cancelled",
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		});

		const response = await agent.post("/account/subscribe");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account?error=subscribe_failed");
	});

	it("Phase 3: cancelled user WITHOUT customerId (defensive) falls back to checkout", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "no-customer@example.com");
		subscriptionProviders.seedRow({
			userId,
			provider: "stripe",
			status: "cancelled",
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		});

		const response = await agent.post("/account/subscribe");

		expect(response.status).toBe(303);
		const location = response.headers.location;
		assert(typeof location === "string" && location.includes("checkout.stripe.test"));

		const started = harness.subscriptionEvents.events.filter((e) => e.event === "checkout_started");
		expect(started).toHaveLength(1);
		expect(started[0].variant).toBe(CHECKOUT_VARIANTS.cancelledResubscribe);
		expect(started[0].user_id).toBe(userId);
	});

	it("redirects active users back to /account instead of creating a Stripe checkout session", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "already-active@example.com");
		await subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_already_active",
			customerId: "cus_already_active",
		});

		const response = await agent.post("/account/subscribe");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account");

		expect(harness.subscriptionEvents.events).toHaveLength(0);
	});

	it("returns 400 for a founding member (no row) trying to subscribe", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.post("/account/subscribe");

		expect(response.status).toBe(400);

		expect(harness.subscriptionEvents.events).toHaveLength(0);
	});

	it("redirects unauthenticated POST /account/subscribe to /login", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).post("/account/subscribe");
		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/login?return=%2Faccount%2Fsubscribe");
	});

	it("treats pending_cancellation as noop on /subscribe — the Reactivate route owns un-cancel, /subscribe must NOT create a second Stripe subscription", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders, subscriptionBilling } = harness;
		const { agent, userId } = await loginUser(harness, "pending-cancel-subscribe@example.com");
		await subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_pending_subscribe",
			customerId: "cus_pending_subscribe",
		});
		await subscriptionProviders.markPendingCancellation({
			userId,
			cancellationEffectiveAt: new Date(Date.now() + 5 * ONE_DAY_MS).toISOString(),
		});

		const response = await agent.post("/account/subscribe");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account");
		// No NEW subscription created — the user still has the existing one
		// with cancel-at-period-end set; Reactivate is the only un-cancel path.
		expect(subscriptionBilling.createdSubscriptions()).toHaveLength(0);
	});

	it("records the resubscribe_completed of a signed-in card charge carrying a crawler User-Agent, since only an authenticated account has a card to charge", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders, subscriptionBilling } = harness;
		const { agent, userId } = await loginUser(harness, "crawler-one-click@example.com");
		await subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_was_paid",
			customerId: "cus_was_paid",
		});
		await subscriptionProviders.markCancelledByUserId({ userId });

		const response = await agent.post("/account/subscribe").set("User-Agent", GOOGLEBOT);

		expect(response.status).toBe(303);
		expect(subscriptionBilling.createdSubscriptions()).toHaveLength(1);
		assert.equal(
			harness.subscriptionEvents.events.filter((e) => e.event === "resubscribe_completed").length,
			1,
			"the account that paid is proof enough of a person; the User-Agent is not consulted",
		);
	});

	it("records exactly one resubscribe_completed for the identical one-click resubscribe from a browser", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "browser-one-click@example.com");
		await subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_was_paid",
			customerId: "cus_was_paid",
		});
		await subscriptionProviders.markCancelledByUserId({ userId });

		const response = await agent.post("/account/subscribe").set("User-Agent", BROWSER_USER_AGENT);

		expect(response.status).toBe(303);
		assert.equal(
			harness.subscriptionEvents.events.filter((e) => e.event === "resubscribe_completed").length,
			1,
			"a browser resubscribe records exactly one resubscribe_completed",
		);
	});

	it("emits the checkout_started when a signed-in account submits the Subscribe form under a crawler User-Agent, so paid-conversion reporting keeps the reader it can identify", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "crawler-subscribe@example.com");
		await subscriptionProviders.upsertTrialing({
			userId,
			trialEndsAt: new Date(Date.now() + 5 * ONE_DAY_MS).toISOString(),
		});

		const response = await agent.post("/account/subscribe").set("User-Agent", GOOGLEBOT);

		expect(response.status).toBe(303);
		assert.equal(
			harness.subscriptionEvents.events.length,
			1,
			"an identified checkout leaves its subscription event behind whatever the User-Agent says",
		);
	});

	it("emits exactly one checkout_started for the identical request from a browser, so the bot gate cannot silence a paying reader", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "browser-subscribe@example.com");
		await subscriptionProviders.upsertTrialing({
			userId,
			trialEndsAt: new Date(Date.now() + 5 * ONE_DAY_MS).toISOString(),
		});

		const response = await agent
			.post("/account/subscribe")
			.set("User-Agent", BROWSER_USER_AGENT);

		expect(response.status).toBe(303);
		assert.equal(
			harness.subscriptionEvents.events.filter((e) => e.event === "checkout_started").length,
			1,
			"a browser checkout must record exactly one checkout_started",
		);
	});
});

describe("POST /account/subscribe (which plan gets charged)", () => {
	it("opens checkout against the plan the reader picked", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders, hostedCheckout } = harness;
		const { agent, userId } = await loginUser(harness, "picks-monthly@example.com");
		await subscriptionProviders.upsertTrialing({
			userId,
			trialEndsAt: new Date(Date.now() + 5 * ONE_DAY_MS).toISOString(),
		});

		const response = await agent.post("/account/subscribe").type("form").send({ plan: "monthly" });

		expect(response.status).toBe(303);
		expect(hostedCheckout.createdCheckoutSessions().map((s) => s.priceId)).toEqual([
			"price_test_monthly",
		]);
		const started = harness.subscriptionEvents.events.filter(
			(e) => e.event === "checkout_started",
		);
		expect(started.map((e) => e.plan)).toEqual(["monthly"]);
	});

	it("remembers the chosen plan on the pending signup, so returning from Stripe records the plan the subscription was created on", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders, pendingSignup, hostedCheckout } = harness;
		const { agent, userId } = await loginUser(harness, "remembers-plan@example.com");
		await subscriptionProviders.upsertTrialing({
			userId,
			trialEndsAt: new Date(Date.now() + 5 * ONE_DAY_MS).toISOString(),
		});

		await agent.post("/account/subscribe").type("form").send({ plan: "triennial" });

		const [session] = hostedCheckout.createdCheckoutSessions();
		const pending = await pendingSignup.consumePendingSignup(session.id);
		assert(pending, "pending signup must be stored for the checkout session");
		expect(pending.plan).toBe("triennial");
	});

	it("charges the featured plan when the form carries none, so the no-JS fallback and an older client still land on the plan the page pushes", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders, hostedCheckout } = harness;
		const { agent, userId } = await loginUser(harness, "no-plan-field@example.com");
		await subscriptionProviders.upsertTrialing({
			userId,
			trialEndsAt: new Date(Date.now() + 5 * ONE_DAY_MS).toISOString(),
		});

		await agent.post("/account/subscribe");

		expect(hostedCheckout.createdCheckoutSessions().map((s) => s.priceId)).toEqual([
			"price_test_yearly",
		]);
	});

	it("refuses a plan it does not sell rather than silently charging the default", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders, hostedCheckout } = harness;
		const { agent, userId } = await loginUser(harness, "unknown-plan@example.com");
		await subscriptionProviders.upsertTrialing({
			userId,
			trialEndsAt: new Date(Date.now() + 5 * ONE_DAY_MS).toISOString(),
		});

		const response = await agent
			.post("/account/subscribe")
			.type("form")
			.send({ plan: "fortnightly" });

		expect(response.status).toBe(400);
		expect(hostedCheckout.createdCheckoutSessions()).toEqual([]);
	});

	it("charges a resubscriber the plan they pick now, in preference to the one their cancelled subscription carried", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders, subscriptionBilling } = harness;
		const { agent, userId } = await loginUser(harness, "resub-picks@example.com");
		await subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_was_paid",
			customerId: "cus_was_paid",
			plan: "monthly",
		});
		await subscriptionProviders.markCancelledByUserId({ userId });

		await agent.post("/account/subscribe").type("form").send({ plan: "triennial" });

		expect(subscriptionBilling.createdSubscriptions().map((s) => s.priceId)).toEqual([
			"price_test_triennial",
		]);
		const row = await subscriptionProviders.findByUserId(userId);
		assert(row, "row must exist");
		expect(row.plan).toBe("triennial");
	});

	it("falls back to the plan a resubscriber's cancelled subscription carried when they pick none", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders, subscriptionBilling } = harness;
		const { agent, userId } = await loginUser(harness, "resub-remembers@example.com");
		await subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_was_paid",
			customerId: "cus_was_paid",
			plan: "monthly",
		});
		await subscriptionProviders.markCancelledByUserId({ userId });

		await agent.post("/account/subscribe");

		expect(subscriptionBilling.createdSubscriptions().map((s) => s.priceId)).toEqual([
			"price_test_monthly",
		]);
	});
});

describe("POST /account/subscribe (where the plan was chosen)", () => {
	function planFormAction(html: string): string {
		const form = new JSDOM(html).window.document.querySelector('[data-test-form="subscribe-plans"]');
		assert(form, "the page must offer the plans through the plan form");
		const action = form.getAttribute("action");
		assert(action, "the plan form must carry an action");
		return action;
	}

	async function trialingReader(email: string) {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, userId } = await loginUser(harness, email);
		await harness.subscriptionProviders.upsertTrialing({
			userId,
			trialEndsAt: new Date(Date.now() + 5 * ONE_DAY_MS).toISOString(),
		});
		const entrySources = () =>
			harness.subscriptionEvents.events
				.filter((e) => e.event === "checkout_started")
				.map((e) => e.entry_source);
		return { agent, entrySources };
	}

	it("records the plans page as the checkout's entry source when the reader chose a plan from its form", async () => {
		const { agent, entrySources } = await trialingReader("entry-plans-page@example.com");

		const page = await agent.get("/account/plans");
		const response = await agent.post(planFormAction(page.text)).type("form").send({ plan: "yearly" });

		expect(response.status).toBe(303);
		expect(entrySources()).toEqual(["plans-page"]);
	});

	it("records the account page as the checkout's entry source when the reader chose a plan from its popover", async () => {
		const { agent, entrySources } = await trialingReader("entry-account@example.com");

		const page = await agent.get("/account");
		const response = await agent.post(planFormAction(page.text)).type("form").send({ plan: "yearly" });

		expect(response.status).toBe(303);
		expect(entrySources()).toEqual(["account"]);
	});

	it("records a null entry source when the form names no plan surface, as the no-JS subscribe fallback does", async () => {
		const { agent, entrySources } = await trialingReader("entry-none@example.com");

		await agent.post("/account/subscribe");

		expect(entrySources()).toEqual([null]);
	});

	it("records a null entry source for a utm_source that is not a plan surface, rather than trusting whatever the query says", async () => {
		const { agent, entrySources } = await trialingReader("entry-unknown@example.com");

		await agent.post("/account/subscribe?utm_source=newsletter&utm_medium=internal");

		expect(entrySources()).toEqual([null]);
	});
});

describe("GET /account (cancellation-scheduled state)", () => {
	it("renders the cancellation-scheduled card with a Reactivate button (no Cancel — the user has already cancelled) and a status line that carries the cutoff date", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "scheduled-cancel-render@example.com");
		await subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_paid_scheduled",
			customerId: "cus_paid_scheduled",
			plan: "yearly",
		});
		const cancellationEffectiveAt = new Date(Date.now() + 5 * ONE_DAY_MS).toISOString();
		await subscriptionProviders.markPendingCancellation({
			userId,
			cancellationEffectiveAt,
		});

		const response = await agent.get("/account");

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		const card = findCard(doc);
		expect(card.classList.contains("account-card--cancellation-scheduled")).toBe(true);
		expect(card.getAttribute("data-test-account-state")).toBe("cancellation-scheduled");
		const status = doc.querySelector("[data-test-account-status]")?.textContent ?? "";
		expect(status).toContain("Your subscription ends on");
		expect(planTitle(doc)).toBe("Yearly plan");
		expect(planChips(doc)).toEqual([["Cancelled", "chip chip--status chip--error"]]);
		expect(planPrice(doc).getAttribute("data-price-state")).toBe("hidden");

		expect(actionKeys(card)).toEqual(["reactivate-form"]);
		const reactivate = findAction(doc, "reactivate-form");
		expect(reactivate.tagName.toLowerCase()).toBe("form");
		expect(reactivate.getAttribute("action")).toBe("/account/reactivate?utm_source=account&utm_medium=internal&utm_content=reactivate-form");
	});
});

describe("POST /account/reactivate", () => {
	it("paid happy path — Stripe reverseScheduledCancellation called, deferred-cancellation schedule deleted, row flipped to active, SubscriptionReactivated emitted, 303 /account", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const reactivatedEvents: Array<{ userId: string; subscriptionId?: string }> = [];
		fixture.events.publishSubscriptionReactivated = async (params) => {
			reactivatedEvents.push(params);
		};
		const harness = useApp(fixture);
		const { subscriptionProviders, trialScheduler, subscriptionBilling } = harness;
		const { agent, userId } = await loginUser(harness, "reactivate-paid@example.com");
		await subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_to_reactivate",
			customerId: "cus_to_reactivate",
		});
		await subscriptionProviders.markPendingCancellation({
			userId,
			cancellationEffectiveAt: new Date(Date.now() + 5 * ONE_DAY_MS).toISOString(),
		});

		const response = await agent.post("/account/reactivate");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account");
		// Stripe was told to undo the scheduled cancel.
		expect(subscriptionBilling.reversedCancellations()).toEqual(["sub_to_reactivate"]);
		// Deferred-cancellation schedule deleted so it doesn't fire later.
		expect(trialScheduler.deferredCancellationDeleteCalls()).toEqual([userId]);
		// Row back to active.
		const row = await subscriptionProviders.findByUserId(userId);
		assert(row, "row must exist");
		expect(row.status).toBe("active");
		expect(row.subscriptionId).toBe("sub_to_reactivate");
		expect(row.cancellationEffectiveAt).toBeUndefined();
		// SubscriptionReactivated emitted with subscriptionId.
		expect(reactivatedEvents).toEqual([
			{ userId, subscriptionId: "sub_to_reactivate" },
		]);
		// A subscription Stripe already charges has no upcoming first charge.
		expect(trialScheduler.allChargeReminderSchedules()).toEqual([]);
	});

	it("paid reactivation of a still-trialing Stripe subscription re-arms the pre-charge reminder — the cancel path deleted it, but Stripe will still charge at trial end", async () => {
		const trialEndsAt = new Date(Date.now() + 12 * ONE_DAY_MS).toISOString();
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.subscriptionBilling = {
			...fixture.subscriptionBilling,
			reverseScheduledCancellation: async () => ({ trialEndsAt }),
		};
		const harness = useApp(fixture);
		const { subscriptionProviders, trialScheduler } = harness;
		const { agent, userId } = await loginUser(harness, "reactivate-trialing@example.com");
		await subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_still_trialing",
			customerId: "cus_still_trialing",
		});
		await subscriptionProviders.markPendingCancellation({ userId, cancellationEffectiveAt: trialEndsAt });

		const response = await agent.post("/account/reactivate");

		expect(response.status).toBe(303);
		expect(trialScheduler.getChargeReminderSchedule(userId)).toEqual({
			firesAt: new Date(Date.parse(trialEndsAt) - 7 * ONE_DAY_MS).toISOString(),
			chargeAt: trialEndsAt,
		});
	});

	it("paid reactivation inside the final 7 days re-arms the reminder to fire right away — the charge is still coming and the reader has not been told", async () => {
		const trialEndsAt = new Date(Date.now() + ONE_DAY_MS).toISOString();
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.subscriptionBilling = {
			...fixture.subscriptionBilling,
			reverseScheduledCancellation: async () => ({ trialEndsAt }),
		};
		const harness = useApp(fixture);
		const { subscriptionProviders, trialScheduler } = harness;
		const { agent, userId } = await loginUser(harness, "reactivate-late@example.com");
		await subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_late_trial",
			customerId: "cus_late_trial",
		});
		await subscriptionProviders.markPendingCancellation({ userId, cancellationEffectiveAt: trialEndsAt });

		const response = await agent.post("/account/reactivate");

		expect(response.status).toBe(303);
		const schedule = trialScheduler.getChargeReminderSchedule(userId);
		assert(schedule, "the reminder must be re-armed");
		expect(schedule.chargeAt).toBe(trialEndsAt);
		expect(Date.parse(schedule.firesAt)).toBeLessThan(Date.now() + 10 * 60 * 1000);
		expect(Date.parse(schedule.firesAt)).toBeLessThan(Date.parse(trialEndsAt));
	});

	it("paid reactivation still succeeds when re-arming the pre-charge reminder fails — the subscription is already restored", async () => {
		const trialEndsAt = new Date(Date.now() + 5 * ONE_DAY_MS).toISOString();
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.subscriptionBilling = {
			...fixture.subscriptionBilling,
			reverseScheduledCancellation: async () => ({ trialEndsAt }),
		};
		fixture.trialScheduler.createChargeReminderSchedule = async () => {
			throw new Error("EventBridge Scheduler unavailable");
		};
		const harness = useApp(fixture);
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "reactivate-schedule-down@example.com");
		await subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_schedule_down",
			customerId: "cus_schedule_down",
		});
		await subscriptionProviders.markPendingCancellation({ userId, cancellationEffectiveAt: trialEndsAt });

		const response = await agent.post("/account/reactivate");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account");
		const row = await subscriptionProviders.findByUserId(userId);
		assert(row, "row must exist");
		expect(row.status).toBe("active");
	});

	it("trial happy path — recreates trial-end schedule, deletes deferred-cancellation schedule, row flipped back to trialing with original trialEndsAt, SubscriptionReactivated emitted (no subscriptionId)", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const reactivatedEvents: Array<{ userId: string; subscriptionId?: string }> = [];
		fixture.events.publishSubscriptionReactivated = async (params) => {
			reactivatedEvents.push(params);
		};
		const harness = useApp(fixture);
		const { subscriptionProviders, trialScheduler, subscriptionBilling } = harness;
		const { agent, userId } = await loginUser(harness, "reactivate-trial@example.com");
		const trialEndsAt = new Date(Date.now() + 5 * ONE_DAY_MS).toISOString();
		await subscriptionProviders.upsertTrialing({ userId, trialEndsAt });
		await subscriptionProviders.markPendingCancellation({
			userId,
			cancellationEffectiveAt: trialEndsAt,
		});

		const response = await agent.post("/account/reactivate");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account");
		// No Stripe call for the trial path.
		expect(subscriptionBilling.reversedCancellations()).toEqual([]);
		// Deferred-cancellation schedule deleted.
		expect(trialScheduler.deferredCancellationDeleteCalls()).toEqual([userId]);
		// Trial-end auto-charge schedule recreated.
		expect(trialScheduler.getSchedule(userId)).toBe(trialEndsAt);
		// Row back to trialing with original trialEndsAt.
		const row = await subscriptionProviders.findByUserId(userId);
		assert(row, "row must exist");
		expect(row.status).toBe("trialing");
		expect(row.trialEndsAt).toBe(trialEndsAt);
		expect(row.subscriptionId).toBeUndefined();
		// SubscriptionReactivated emitted without subscriptionId.
		expect(reactivatedEvents).toEqual([{ userId }]);
		// Trial-reminder schedule recreated at trialEndsAt minus 2 days (>2d remain).
		const reminderFiresAt = trialScheduler.getTrialReminderSchedule(userId);
		assert(reminderFiresAt, "reminder schedule must be recreated when >2d remain");
		expect(new Date(reminderFiresAt).getTime()).toBe(
			new Date(trialEndsAt).getTime() - 2 * ONE_DAY_MS,
		);
	});

	it("trial reactivate — does NOT recreate the reminder when trialEndsAt is under two days away", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.events.publishSubscriptionReactivated = async () => {};
		const harness = useApp(fixture);
		const { subscriptionProviders, trialScheduler } = harness;
		const { agent, userId } = await loginUser(harness, "reactivate-trial-soon@example.com");
		const trialEndsAt = new Date(Date.now() + ONE_DAY_MS).toISOString();
		await subscriptionProviders.upsertTrialing({ userId, trialEndsAt });
		await subscriptionProviders.markPendingCancellation({
			userId,
			cancellationEffectiveAt: trialEndsAt,
		});

		const response = await agent.post("/account/reactivate");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account");
		// Trial-end schedule still recreated, but the reminder would fire in the
		// past (EventBridge rejects at() in the past) so it is skipped.
		expect(trialScheduler.getSchedule(userId)).toBe(trialEndsAt);
		expect(trialScheduler.getTrialReminderSchedule(userId)).toBeUndefined();
		const row = await subscriptionProviders.findByUserId(userId);
		assert(row, "row must exist");
		expect(row.status).toBe("trialing");
	});

	it("noop for an already-active user (double-click race or stale form) — 303 /account, no Stripe call, no event, no schedule mutation", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const reactivatedEvents: unknown[] = [];
		fixture.events.publishSubscriptionReactivated = async (params) => {
			reactivatedEvents.push(params);
		};
		const harness = useApp(fixture);
		const { subscriptionProviders, trialScheduler, subscriptionBilling } = harness;
		const { agent, userId } = await loginUser(harness, "reactivate-already-active@example.com");
		await subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_already",
			customerId: "cus_already",
		});

		const response = await agent.post("/account/reactivate");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account");
		expect(subscriptionBilling.reversedCancellations()).toEqual([]);
		expect(trialScheduler.deferredCancellationDeleteCalls()).toEqual([]);
		expect(reactivatedEvents).toEqual([]);
	});

	it("noop when no subscription row exists (founding member sending a stale form)", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.post("/account/reactivate");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account");
	});

	it("Stripe reverseScheduledCancellation failure — 303 /account?error=payment_method, row stays pending_cancellation", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.subscriptionBilling.reverseScheduledCancellation = async () => {
			throw new Error("Stripe is down");
		};
		const harness = useApp(fixture);
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "reactivate-stripe-down@example.com");
		await subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_kaboom",
			customerId: "cus_kaboom",
		});
		const cancellationEffectiveAt = new Date(Date.now() + 5 * ONE_DAY_MS).toISOString();
		await subscriptionProviders.markPendingCancellation({
			userId,
			cancellationEffectiveAt,
		});

		const response = await agent.post("/account/reactivate");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account?error=payment_method");
		// Row stays pending_cancellation so the user can retry.
		const row = await subscriptionProviders.findByUserId(userId);
		assert(row, "row must still exist");
		expect(row.status).toBe("pending_cancellation");
		expect(row.cancellationEffectiveAt).toBe(cancellationEffectiveAt);
	});

	it("trial reactivate — schedule-create failure leaves the row pending_cancellation (the user can retry)", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const failingScheduler = fixture.trialScheduler.createTrialEndSchedule;
		fixture.trialScheduler.createTrialEndSchedule = async () => {
			void failingScheduler;
			throw new Error("EventBridge Scheduler down");
		};
		const harness = useApp(fixture);
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "reactivate-trial-scheduler-down@example.com");
		const trialEndsAt = new Date(Date.now() + 5 * ONE_DAY_MS).toISOString();
		await subscriptionProviders.upsertTrialing({ userId, trialEndsAt });
		await subscriptionProviders.markPendingCancellation({
			userId,
			cancellationEffectiveAt: trialEndsAt,
		});

		const response = await agent.post("/account/reactivate");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account?error=payment_method");
		const row = await subscriptionProviders.findByUserId(userId);
		assert(row, "row must still exist");
		expect(row.status).toBe("pending_cancellation");
		expect(row.trialEndsAt).toBe(trialEndsAt);
	});

	it("redirects unauthenticated POST /account/reactivate to /login", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).post("/account/reactivate");
		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/login?return=%2Faccount%2Freactivate");
	});
});

async function activeUserWithCards(
	harness: ReturnType<ReturnType<typeof useTestServer>>,
	email: string,
	cards: SavedCard[],
	customerId = "cus_cards",
) {
	const { agent, userId } = await loginUser(harness, email);
	await harness.subscriptionProviders.upsertActive({
		userId,
		subscriptionId: "sub_cards",
		customerId,
	});
	harness.paymentMethods.seedCards({ customerId, cards });
	return { agent, userId, customerId };
}

describe("GET /account — card management section", () => {
	it("always loads the account-cards client bundle", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get("/account");

		const doc = new JSDOM(response.text).window.document;
		const script = doc.querySelector('script[src="/client-dist/account-cards.client.js"]');
		assert(script, "account-cards.client.js bundle must be loaded on /account");
	});

	it("hides the payment section, with nothing inside it, for a founding member with no Stripe customer", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get("/account");

		const doc = new JSDOM(response.text).window.document;
		const section = doc.querySelector("[data-test-cards-section]");
		assert(section, "card section must render");
		expect(section.getAttribute("data-test-cards-state")).toBe("hidden");
		expect(section.className).toBe("account-billing__payment account-billing__payment--hidden");
		expect(section.textContent?.trim()).toBe("");
		expect(cardRows(doc)).toHaveLength(0);
	});

	it("renders the primary card as the row and, in the open panel, each backup carrying promote + remove", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await activeUserWithCards(harness, "cards-list@example.com", [
			card("pm_primary", true, "4242"),
			card("pm_backup", false, "1111"),
		]);

		const response = await agent.get("/account?manage=payment");

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		expect(cardRows(doc)).toHaveLength(2);

		const primaryRow = doc.querySelector("[data-test-card-primary]");
		assert(primaryRow, "primary row must be addressable");
		expect(primaryRow.querySelector(".account-billing__tile")?.textContent).toBe("VISA");
		expect(primaryRow.querySelector("h3")?.textContent).toBe("Visa •••• 4242");
		expect(primaryRow.querySelector(".account-billing__expiry")?.textContent).toBe("Expires 12/30");
		const badge = primaryRow.querySelector("[data-test-card-badge]");
		assert(badge, "the primary card must carry its badge");
		expect(badge.textContent).toBe("Primary");
		expect(badge.className).toBe("chip chip--badge chip--accent");
		expect(cardActionKeys(primaryRow)).toEqual([]);

		const backupRow = cardRows(doc).find((row) => !row.hasAttribute("data-test-card-primary"));
		assert(backupRow, "backup row must render");
		expect(managePanel(doc, "payment").contains(backupRow)).toBe(true);
		expect(backupRow.textContent).toContain("1111");
		expect(cardActionKeys(backupRow)).toEqual(["promote", "remove"]);
	});

	it("tags every card-management CTA with its own utm_source, from the saved-card rows to the add-card cancel", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await activeUserWithCards(harness, "cards-utm@example.com", [
			card("pm_primary", true, "4242"),
			card("pm_backup", false, "1111"),
		]);

		const listingDoc = new JSDOM((await agent.get("/account?manage=payment")).text).window.document;
		const addingDoc = new JSDOM((await agent.post("/account/cards/new")).text).window.document;

		const listingSection = listingDoc.querySelector("[data-test-cards-section]");
		assert(listingSection, "the card section must render");
		const backupRow = cardRows(listingDoc).find((row) => !row.hasAttribute("data-test-card-primary"));
		assert(backupRow, "backup row must render");
		expect(cardActionKeys(backupRow)).toEqual(["promote", "remove"]);
		assert(listingSection.querySelector("[data-test-add-card]"), "the add-card form must render below the cap");
		const addingSection = addingDoc.querySelector("[data-test-cards-section]");
		assert(addingSection, "the card section must render in the adding state");
		assert(addingSection.querySelector("[data-card-cancel]"), "the adding state must render its cancel link");

		const untracked = [listingSection, addingSection].flatMap((section) =>
			describeUntrackedCtas(findUntrackedCtas(section.outerHTML, { skipSelectors: [], ownOrigin: TEST_APP_ORIGIN })),
		);
		expect(untracked).toEqual([]);
	});

	it("renders the add-card button in the open panel when below the cap", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await activeUserWithCards(harness, "cards-add@example.com", [
			card("pm_primary", true, "4242"),
		]);

		const response = await agent.get("/account?manage=payment");

		const doc = new JSDOM(response.text).window.document;
		const addForm = doc.querySelector("[data-test-add-card]");
		assert(addForm, "add-card button must render below the cap");
		expect(managePanel(doc, "payment").contains(addForm)).toBe(true);
	});

	it("disables htmx history push on the add-card form (boosted POST renders 200, not a redirect) so a refresh can't 404 on /account/cards/new", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await activeUserWithCards(harness, "cards-add-history@example.com", [
			card("pm_primary", true, "4242"),
		]);
		const { agent: noCardAgent, userId: noCardUserId } = await loginUser(harness, "cards-add-history-none@example.com");
		await harness.subscriptionProviders.upsertActive({
			userId: noCardUserId,
			subscriptionId: "sub_no_card",
			customerId: "cus_no_card",
		});

		const panelDoc = new JSDOM((await agent.get("/account?manage=payment")).text).window.document;
		const rowDoc = new JSDOM((await noCardAgent.get("/account")).text).window.document;

		const panelAddForm = managePanel(panelDoc, "payment").querySelector("[data-test-add-card]");
		assert(panelAddForm, "add-card form must render in the open panel below the cap");
		expect(panelAddForm.getAttribute("hx-push-url")).toBe("false");
		const noCardRow = rowDoc.querySelector("[data-test-no-card]");
		assert(noCardRow, "a customer with no saved card must see the no-card row");
		expect(noCardRow.querySelector("h3")?.textContent).toBe("No card on file");
		expect(noCardRow.querySelector(".account-billing__detail")?.textContent).toBe("Add a card to keep your plan running.");
		const rowAddForm = noCardRow.querySelector("[data-test-add-card]");
		assert(rowAddForm, "the no-card row must offer Add a card while the panel is shut");
		expect(rowAddForm.getAttribute("action")).toBe(
			"/account/cards/new?utm_source=account&utm_medium=internal&utm_content=add-card",
		);
		expect(rowAddForm.getAttribute("hx-push-url")).toBe("false");
		expect(managePanel(rowDoc, "payment").getAttribute("data-manage-panel-state")).toBe("closed");
	});

	it.each<[string, SavedCard[]]>([
		["one saved card", [card("pm_a", false, "1111")]],
		["the 3-card cap", [card("pm_a", false, "1111"), card("pm_b", false, "2222"), card("pm_c", false, "3333")]],
	])("offers Update payment method on the row when no saved card is primary, at %s, and it leads to Make primary", async (_label, cards) => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await activeUserWithCards(harness, "cards-no-primary@example.com", cards);

		const rowDoc = new JSDOM((await agent.get("/account")).text).window.document;

		const noCardRow = rowDoc.querySelector("[data-test-no-card]");
		assert(noCardRow, "saved cards with none primary must render the no-card row");
		expect(noCardRow.querySelector("h3")?.textContent).toBe("No primary card");
		expect(noCardRow.querySelector(".account-billing__detail")?.textContent).toBe(
			"Make one of your saved cards primary to keep your plan running.",
		);
		expect(Array.from(noCardRow.querySelectorAll("form")).map((form) => form.getAttribute("action"))).toEqual([
			"/account",
		]);
		expect(actionKeys(noCardRow)).toEqual(["update-payment"]);
		expect(hiddenFields(findAction(rowDoc, "update-payment"))).toEqual([
			["utm_source", "account"],
			["utm_medium", "internal"],
			["utm_content", "update-payment"],
			["manage", "payment"],
		]);
		expect(managePanel(rowDoc, "payment").getAttribute("data-manage-panel-state")).toBe("closed");

		const panelDoc = new JSDOM((await agent.get("/account?manage=payment")).text).window.document;

		expect(cardRows(managePanel(panelDoc, "payment")).map(cardActionKeys)).toEqual(
			cards.map(() => ["promote", "remove"]),
		);
	});

	it("degrades gracefully when the live card read fails — still renders the subscription card", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.paymentMethods.listCards = async () => {
			throw new Error("Stripe is down");
		};
		const harness = useApp(fixture);
		const { agent, userId } = await loginUser(harness, "cards-error@example.com");
		await harness.subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_err",
			customerId: "cus_err",
		});

		const response = await agent.get("/account");

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		expect(
			doc.querySelector("[data-test-cards-section]")?.getAttribute("data-test-cards-state"),
		).toBe("provider-error");
		const providerAlert = doc.querySelector('[data-test-alert="payment-methods"]');
		assert(providerAlert, "provider error must render inside the resting payment card");
		expect(providerAlert.getAttribute("data-test-alert-variant")).toBe("error");
		expect(providerAlert.getAttribute("role")).toBe("alert");
		expect(providerAlert.classList.contains("alert--visible")).toBe(true);
		expect(providerAlert.querySelector("[data-test-alert-message]")?.textContent).toBe(
			"Couldn't load your saved cards. Refresh the page to try again.",
		);
		assert(doc.querySelector("[data-test-account-card]"), "subscription card still renders");
	});
});

describe("POST /account/cards/:id/primary", () => {
	it("promotes a backup to primary and redirects back to the open payment panel", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, customerId } = await activeUserWithCards(harness, "promote@example.com", [
			card("pm_primary", true, "4242"),
			card("pm_backup", false, "1111"),
		]);

		const response = await agent.post("/account/cards/pm_backup/primary");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account?manage=payment");
		const cards = await harness.paymentMethods.listCards({ customerId });
		expect(cards.find((c) => c.id === "pm_backup")?.isPrimary).toBe(true);
		expect(cards.find((c) => c.id === "pm_primary")?.isPrimary).toBe(false);
	});

	it("noops when the card is already primary", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, customerId } = await activeUserWithCards(harness, "promote-noop@example.com", [
			card("pm_primary", true, "4242"),
		]);

		const response = await agent.post("/account/cards/pm_primary/primary");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account?manage=payment");
		const cards = await harness.paymentMethods.listCards({ customerId });
		expect(cards.find((c) => c.id === "pm_primary")?.isPrimary).toBe(true);
	});

	it("answers a failed provider call with the payment panel still open, leaving the cards as they were", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.paymentMethods.setPrimaryCard = async () => {
			throw new Error("Stripe is down");
		};
		const harness = useApp(fixture);
		const { agent, customerId } = await activeUserWithCards(harness, "promote-fail@example.com", [
			card("pm_primary", true, "4242"),
			card("pm_backup", false, "1111"),
		]);

		const response = await agent.post("/account/cards/pm_backup/primary");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account?manage=payment");
		const cards = await harness.paymentMethods.listCards({ customerId });
		expect(cards.map((c) => [c.id, c.isPrimary])).toEqual([
			["pm_primary", true],
			["pm_backup", false],
		]);
	});

	it("redirects unauthenticated callers to /login", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).post("/account/cards/pm_x/primary");
		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/login?return=%2Faccount%2Fcards%2Fpm_x%2Fprimary");
	});
});

describe("POST /account/cards/:id/remove", () => {
	it("removes a backup and redirects back to the open payment panel", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, customerId } = await activeUserWithCards(harness, "remove@example.com", [
			card("pm_primary", true, "4242"),
			card("pm_backup", false, "1111"),
		]);

		const response = await agent.post("/account/cards/pm_backup/remove");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account?manage=payment");
		const cards = await harness.paymentMethods.listCards({ customerId });
		expect(cards.map((c) => c.id)).toEqual(["pm_primary"]);
	});

	it("noops on a card that is no longer saved and keeps the panel open", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, customerId } = await activeUserWithCards(harness, "remove-gone@example.com", [
			card("pm_primary", true, "4242"),
			card("pm_backup", false, "1111"),
		]);

		const response = await agent.post("/account/cards/pm_gone/remove");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account?manage=payment");
		const cards = await harness.paymentMethods.listCards({ customerId });
		expect(cards.map((c) => c.id)).toEqual(["pm_primary", "pm_backup"]);
	});

	it("answers a failed provider call with the payment panel still open, leaving the cards as they were", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.paymentMethods.removeCard = async () => {
			throw new Error("Stripe is down");
		};
		const harness = useApp(fixture);
		const { agent, customerId } = await activeUserWithCards(harness, "remove-fail@example.com", [
			card("pm_primary", true, "4242"),
			card("pm_backup", false, "1111"),
		]);

		const response = await agent.post("/account/cards/pm_backup/remove");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account?manage=payment");
		const cards = await harness.paymentMethods.listCards({ customerId });
		expect(cards.map((c) => c.id)).toEqual(["pm_primary", "pm_backup"]);
	});

	it("refuses to remove the primary card", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, customerId } = await activeUserWithCards(harness, "remove-primary@example.com", [
			card("pm_primary", true, "4242"),
			card("pm_backup", false, "1111"),
		]);

		const response = await agent.post("/account/cards/pm_primary/remove");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account?error=cannot_remove_primary");
		const cards = await harness.paymentMethods.listCards({ customerId });
		expect(cards.map((c) => c.id)).toEqual(["pm_primary", "pm_backup"]);
	});

	it("redirects unauthenticated callers to /login", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).post("/account/cards/pm_x/remove");
		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/login?return=%2Faccount%2Fcards%2Fpm_x%2Fremove");
	});
});

describe("POST /account/cards/new", () => {
	it("creates a SetupIntent and re-renders /account in the adding state", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await activeUserWithCards(harness, "add-new@example.com", [
			card("pm_primary", true, "4242"),
		]);

		const response = await agent.post("/account/cards/new");

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		const elements = doc.querySelector("[data-test-card-elements]");
		assert(elements, "Elements container must render in the adding state");
		expect(elements.getAttribute("data-publishable-key")).toBe("pk_test_default");
		const secret = elements.getAttribute("data-client-secret") ?? "";
		assert(secret.length > 0, "client secret must be embedded for Stripe.js");
		const setupId = elements.getAttribute("data-setup-id") ?? "";
		expect(setupId).toMatch(/^seti_inmem_/);

		const mount = elements.querySelector("[data-card-element]");
		assert(mount, "the Stripe card field must have a mount point");
		expect(mount.classList.contains("form-input__control")).toBe(true);
		const field = mount.parentElement;
		assert(field, "the card mount must be wrapped in the field it draws inside");
		expect(field.classList.contains("form-input")).toBe(true);
		expect(field.classList.contains("form-input--within")).toBe(true);
		const error = elements.querySelector("[data-card-error]");
		assert(error, "the Stripe card field must have an error slot");
		expect(error.classList.contains("form-field__error")).toBe(true);
		expect(error.getAttribute("role")).toBe("alert");
	});

	it("hands the Save card button a tagged confirm URL that still reaches the confirm route", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, customerId } = await activeUserWithCards(harness, "add-confirm-url@example.com", [
			card("pm_primary", true, "4242"),
		]);

		const doc = new JSDOM((await agent.post("/account/cards/new")).text).window.document;
		const setupId = doc.querySelector("[data-test-card-elements]")?.getAttribute("data-setup-id");
		const confirmUrl = doc.querySelector("[data-card-submit]")?.getAttribute("data-card-confirm-url");
		assert(setupId, "the adding state must carry a setup id");
		assert(confirmUrl, "the Save card button must carry its confirm URL");
		expect(confirmUrl).toBe(
			"/account/cards/confirm?utm_source=account&utm_medium=internal&utm_content=save-card",
		);
		harness.paymentMethods.completeCardSetup({ setupId: CardSetupIdSchema.parse(setupId), card: card("pm_new", false, "9999") });

		const confirm = await agent.post(confirmUrl).type("form").send({ setupId });

		expect(confirm.status).toBe(303);
		expect(confirm.headers.location).toBe("/account?manage=payment");
		const cards = await harness.paymentMethods.listCards({ customerId });
		expect(cards.map((c) => c.id)).toEqual(["pm_primary", "pm_new"]);
	});

	it("points the add-card Cancel back at the open payment panel, as every other card flow returns", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await activeUserWithCards(harness, "add-cancel@example.com", [
			card("pm_primary", true, "4242"),
		]);

		const addingDoc = new JSDOM((await agent.post("/account/cards/new")).text).window.document;

		const cancel = addingDoc.querySelector("[data-card-cancel]");
		assert(cancel, "the adding state must render its cancel link");
		const cancelHref = cancel.getAttribute("href");
		assert(cancelHref, "the cancel link must carry an href");
		expect(cancelHref).toBe(
			"/account?manage=payment&utm_source=account&utm_medium=internal&utm_content=cancel-add-card",
		);
		const landingDoc = new JSDOM((await agent.get(cancelHref)).text).window.document;
		expect(managePanel(landingDoc, "payment").getAttribute("data-manage-panel-state")).toBe("open");
	});

	it("redirects to the card-limit error when already at 3 cards", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await activeUserWithCards(harness, "add-limit@example.com", [
			card("pm_a", true, "4242"),
			card("pm_b", false, "1111"),
			card("pm_c", false, "2222"),
		]);

		const response = await agent.post("/account/cards/new");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account?error=card_limit");
	});

	it("surfaces a card-scoped add-failed notice — not the resubscribe error — when beginAddCard throws", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.paymentMethods.beginAddCard = async () => {
			throw new Error("Stripe is down");
		};
		const harness = useApp(fixture);
		const { agent } = await activeUserWithCards(harness, "add-failed@example.com", [
			card("pm_primary", true, "4242"),
		]);

		const response = await agent.post("/account/cards/new");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account?error=add_card_failed");
	});

	it("renders the add-failed notice scoped to the card section, leaving the subscription card untouched", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await activeUserWithCards(harness, "add-failed-render@example.com", [
			card("pm_primary", true, "4242"),
		]);

		const response = await agent.get("/account?error=add_card_failed");

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		const notice = doc.querySelector('[data-test-alert="card-notice"]');
		assert(notice, "card-section notice must render for add_card_failed");
		expect(notice.getAttribute("role")).toBe("alert");
		expect(notice.getAttribute("data-test-alert-variant")).toBe("error");
		expect(notice.classList.contains("alert--visible")).toBe(true);
		expect(notice.textContent).toContain("couldn't start adding a card");
		expect(findCard(doc).getAttribute("data-test-account-state")).toBe("active");
	});

	it("redirects unauthenticated callers to /login", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).post("/account/cards/new");
		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/login?return=%2Faccount%2Fcards%2Fnew");
	});
});

describe("POST /account/cards/confirm — server-side setup verification and cap reconciliation", () => {
	it("keeps a verified card within the cap and redirects back to the open payment panel", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, customerId } = await activeUserWithCards(harness, "confirm-ok@example.com", [
			card("pm_a", true, "4242"),
			card("pm_b", false, "1111"),
		]);
		const { setupId } = await harness.paymentMethods.beginAddCard({ customerId });
		harness.paymentMethods.completeCardSetup({ setupId, card: card("pm_new", false, "9999") });

		const response = await agent
			.post("/account/cards/confirm")
			.type("form")
			.send({ setupId });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account?manage=payment");
		const cards = await harness.paymentMethods.listCards({ customerId });
		expect(cards.map((c) => c.id)).toEqual(["pm_a", "pm_b", "pm_new"]);
	});

	it("surfaces the setup-failed error when the provider declined the setup and no card was attached", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, customerId } = await activeUserWithCards(harness, "confirm-declined@example.com", [
			card("pm_a", true, "4242"),
		]);
		const { setupId } = await harness.paymentMethods.beginAddCard({ customerId });
		harness.paymentMethods.failCardSetup({ setupId, reason: "card_declined" });

		const response = await agent
			.post("/account/cards/confirm")
			.type("form")
			.send({ setupId });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account?error=card_setup_failed");
		const cards = await harness.paymentMethods.listCards({ customerId });
		expect(cards.map((c) => c.id)).toEqual(["pm_a"]);
	});

	it("detaches an attached card when its setup did not verify", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, customerId } = await activeUserWithCards(harness, "confirm-revoked@example.com", [
			card("pm_a", true, "4242"),
		]);
		const { setupId } = await harness.paymentMethods.beginAddCard({ customerId });
		harness.paymentMethods.completeCardSetup({ setupId, card: card("pm_sneak", false, "6666") });
		harness.paymentMethods.failCardSetup({ setupId, reason: "verification_revoked" });

		const response = await agent
			.post("/account/cards/confirm")
			.type("form")
			.send({ setupId });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account?error=card_setup_failed");
		const cards = await harness.paymentMethods.listCards({ customerId });
		expect(cards.map((c) => c.id)).toEqual(["pm_a"]);
	});

	it("rejects a setup that belongs to another customer without touching that customer's cards", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, customerId } = await activeUserWithCards(harness, "confirm-foreign@example.com", [
			card("pm_a", true, "4242"),
		]);
		harness.paymentMethods.seedCards({
			customerId: "cus_other",
			cards: [card("pm_other", true, "7777")],
		});
		const { setupId } = await harness.paymentMethods.beginAddCard({ customerId: "cus_other" });
		harness.paymentMethods.completeCardSetup({ setupId, card: card("pm_other_new", false, "8888") });

		const response = await agent
			.post("/account/cards/confirm")
			.type("form")
			.send({ setupId });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account?error=card_setup_failed");
		const otherCards = await harness.paymentMethods.listCards({ customerId: "cus_other" });
		expect(otherCards.map((c) => c.id)).toEqual(["pm_other", "pm_other_new"]);
		const ownCards = await harness.paymentMethods.listCards({ customerId });
		expect(ownCards.map((c) => c.id)).toEqual(["pm_a"]);
	});

	it("rejects a setup that was begun but never confirmed", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, customerId } = await activeUserWithCards(harness, "confirm-pending@example.com", [
			card("pm_a", true, "4242"),
		]);
		const { setupId } = await harness.paymentMethods.beginAddCard({ customerId });

		const response = await agent
			.post("/account/cards/confirm")
			.type("form")
			.send({ setupId });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account?error=card_setup_failed");
		const cards = await harness.paymentMethods.listCards({ customerId });
		expect(cards.map((c) => c.id)).toEqual(["pm_a"]);
	});

	it("rejects a setup id the provider has never seen", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, customerId } = await activeUserWithCards(harness, "confirm-unknown@example.com", [
			card("pm_a", true, "4242"),
		]);

		const response = await agent
			.post("/account/cards/confirm")
			.type("form")
			.send({ setupId: "seti_never_created" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account?error=card_setup_failed");
		const cards = await harness.paymentMethods.listCards({ customerId });
		expect(cards.map((c) => c.id)).toEqual(["pm_a"]);
	});

	it("detaches the just-verified card and surfaces the limit error when a concurrent add pushed past the cap", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, customerId } = await activeUserWithCards(harness, "confirm-over@example.com", [
			card("pm_a", true, "4242"),
			card("pm_b", false, "1111"),
			card("pm_c", false, "2222"),
		]);
		const { setupId } = await harness.paymentMethods.beginAddCard({ customerId });
		harness.paymentMethods.completeCardSetup({ setupId, card: card("pm_d", false, "3333") });

		const response = await agent
			.post("/account/cards/confirm")
			.type("form")
			.send({ setupId });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account?error=card_limit");
		const cards = await harness.paymentMethods.listCards({ customerId });
		expect(cards.map((c) => c.id)).toEqual(["pm_a", "pm_b", "pm_c"]);
	});

	it("is idempotent on a double POST after the over-cap detach", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, customerId } = await activeUserWithCards(harness, "confirm-double@example.com", [
			card("pm_a", true, "4242"),
			card("pm_b", false, "1111"),
			card("pm_c", false, "2222"),
		]);
		const { setupId } = await harness.paymentMethods.beginAddCard({ customerId });
		harness.paymentMethods.completeCardSetup({ setupId, card: card("pm_d", false, "3333") });
		await agent.post("/account/cards/confirm").type("form").send({ setupId });

		const response = await agent
			.post("/account/cards/confirm")
			.type("form")
			.send({ setupId });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account?manage=payment");
		const cards = await harness.paymentMethods.listCards({ customerId });
		expect(cards.map((c) => c.id)).toEqual(["pm_a", "pm_b", "pm_c"]);
	});

	it("never detaches the funding (primary) card even when the verified setup names it over the cap", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.paymentMethods.getCardSetupResult = async () => ({
			status: "succeeded",
			customerId: "cus_cards",
			cardId: PaymentMethodIdSchema.parse("pm_a"),
			failureReason: undefined,
		});
		const harness = useApp(fixture);
		const { agent, customerId } = await activeUserWithCards(harness, "confirm-primary@example.com", [
			card("pm_a", true, "4242"),
			card("pm_b", false, "1111"),
			card("pm_c", false, "2222"),
			card("pm_d", false, "3333"),
		]);

		const response = await agent
			.post("/account/cards/confirm")
			.type("form")
			.send({ setupId: "seti_stub" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account?manage=payment");
		const cards = await harness.paymentMethods.listCards({ customerId });
		expect(cards.map((c) => c.id)).toEqual(["pm_a", "pm_b", "pm_c", "pm_d"]);
	});

	it("never detaches the primary card when a failed setup names it", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.paymentMethods.getCardSetupResult = async () => ({
			status: "failed",
			customerId: "cus_cards",
			cardId: PaymentMethodIdSchema.parse("pm_a"),
			failureReason: "issuer_revoked",
		});
		const harness = useApp(fixture);
		const { agent, customerId } = await activeUserWithCards(harness, "confirm-primary-failed@example.com", [
			card("pm_a", true, "4242"),
		]);

		const response = await agent
			.post("/account/cards/confirm")
			.type("form")
			.send({ setupId: "seti_stub" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account?error=card_setup_failed");
		const cards = await harness.paymentMethods.listCards({ customerId });
		expect(cards.map((c) => c.id)).toEqual(["pm_a"]);
	});

	it("rejects a setup still processing at the provider", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.paymentMethods.getCardSetupResult = async () => ({
			status: "processing",
			customerId: "cus_cards",
			cardId: undefined,
			failureReason: undefined,
		});
		const harness = useApp(fixture);
		const { agent, customerId } = await activeUserWithCards(harness, "confirm-processing@example.com", [
			card("pm_a", true, "4242"),
		]);

		const response = await agent
			.post("/account/cards/confirm")
			.type("form")
			.send({ setupId: "seti_stub" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account?error=card_setup_failed");
		const cards = await harness.paymentMethods.listCards({ customerId });
		expect(cards.map((c) => c.id)).toEqual(["pm_a"]);
	});

	it("redirects to /account without detaching when no setup id is posted", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, customerId } = await activeUserWithCards(harness, "confirm-nobody@example.com", [
			card("pm_a", true, "4242"),
			card("pm_b", false, "1111"),
			card("pm_c", false, "2222"),
			card("pm_d", false, "3333"),
		]);

		const response = await agent.post("/account/cards/confirm");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account");
		const cards = await harness.paymentMethods.listCards({ customerId });
		expect(cards.map((c) => c.id)).toEqual(["pm_a", "pm_b", "pm_c", "pm_d"]);
	});

	it("redirects a member with no Stripe customer back to /account", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent
			.post("/account/cards/confirm")
			.type("form")
			.send({ setupId: "seti_x" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account");
	});

	it("surfaces the unverified notice when the setup outcome read fails (no crash)", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.paymentMethods.getCardSetupResult = async () => {
			throw new Error("Stripe is down");
		};
		const harness = useApp(fixture);
		const { agent } = await activeUserWithCards(harness, "confirm-error@example.com", [
			card("pm_a", true, "4242"),
		]);

		const response = await agent
			.post("/account/cards/confirm")
			.type("form")
			.send({ setupId: "seti_x" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account?error=card_setup_unverified");
	});

	it("surfaces the unverified notice when the live read fails after a verified setup (no crash)", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.paymentMethods.listCards = async () => {
			throw new Error("Stripe is down");
		};
		const harness = useApp(fixture);
		const { agent, userId } = await loginUser(harness, "confirm-read-error@example.com");
		await harness.subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_confirm_err",
			customerId: "cus_confirm_err",
		});
		const { setupId } = await harness.paymentMethods.beginAddCard({
			customerId: "cus_confirm_err",
		});
		harness.paymentMethods.completeCardSetup({ setupId, card: card("pm_new", false, "9999") });

		const response = await agent
			.post("/account/cards/confirm")
			.type("form")
			.send({ setupId });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account?error=card_setup_unverified");
	});

	it("surfaces the unverified notice when the detach of a failed setup's card fails (no crash)", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.paymentMethods.removeCard = async () => {
			throw new Error("detach failed");
		};
		const harness = useApp(fixture);
		const { agent, customerId } = await activeUserWithCards(harness, "confirm-detach-error@example.com", [
			card("pm_a", true, "4242"),
		]);
		const { setupId } = await harness.paymentMethods.beginAddCard({ customerId });
		harness.paymentMethods.completeCardSetup({ setupId, card: card("pm_sneak", false, "6666") });
		harness.paymentMethods.failCardSetup({ setupId });

		const response = await agent
			.post("/account/cards/confirm")
			.type("form")
			.send({ setupId });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account?error=card_setup_unverified");
	});

	it("renders the setup-failed notice scoped to the card section, leaving the subscription card untouched", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await activeUserWithCards(harness, "confirm-failed-render@example.com", [
			card("pm_a", true, "4242"),
		]);

		const response = await agent.get("/account?error=card_setup_failed");

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		const notice = doc.querySelector('[data-test-alert="card-notice"]');
		assert(notice, "card-section notice must render for card_setup_failed");
		expect(notice.getAttribute("data-test-alert-variant")).toBe("error");
		expect(notice.getAttribute("role")).toBe("alert");
		expect(notice.classList.contains("alert--visible")).toBe(true);
		expect(notice.textContent).toContain("couldn't verify your new card");
		expect(findCard(doc).getAttribute("data-test-account-state")).toBe("active");
	});

	it("redirects unauthenticated callers to /login", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).post("/account/cards/confirm");
		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/login?return=%2Faccount%2Fcards%2Fconfirm");
	});
});

describe("GET /account/invoices", () => {
	function paidInvoices(count: number): InvoiceSummary[] {
		return Array.from({ length: count }, (_, index) => {
			const n = String(index + 1).padStart(3, "0");
			return {
				id: InvoiceIdSchema.parse(`in_route${n}`),
				number: `RP-${n}`,
				issuedAt: new Date(Date.UTC(2026, 8 - index, 18)).toISOString(),
				amountPaidMinor: 1000,
				currency: "usd",
				hostedInvoiceUrl: `https://invoice.stripe.com/i/acct_test/in_route${n}`,
			};
		});
	}

	async function subscriberWithInvoices(
		harness: ReturnType<ReturnType<typeof useTestServer>>,
		email: string,
		invoices: InvoiceSummary[],
	) {
		const { agent, userId } = await loginUser(harness, email);
		await harness.subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_invoices",
			customerId: "cus_invoices",
			plan: "monthly",
		});
		harness.subscriptionBilling.seedInvoices({ customerId: "cus_invoices", invoices });
		return { agent };
	}

	function invoiceRows(doc: Document): Element[] {
		return Array.from(doc.querySelectorAll("[data-test-invoice-row]"));
	}

	function invoicesState(doc: Document): string {
		const card = doc.querySelector("[data-test-invoices-state]");
		assert(card, "the invoices card must always render");
		return card.getAttribute("data-test-invoices-state") ?? "";
	}

	function pagerStep(doc: Document, step: "newer" | "older"): Element {
		const element = doc.querySelector(`[data-test-invoices-${step}]`);
		assert(element, `the ${step} step must always render`);
		return element;
	}

	it("lists the newest twelve paid invoices with their date, number, amount and a View invoice link to Stripe's hosted page", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await subscriberWithInvoices(harness, "invoices-list@example.com", paidInvoices(13));

		const response = await agent.get("/account/invoices");

		expect(response.status).toBe(200);
		expect(response.headers["cache-control"]).toBe("private, no-cache");
		const doc = new JSDOM(response.text).window.document;
		expect(doc.body.classList.contains("page-account-invoices")).toBe(true);
		expect(doc.title).toBe("Invoices — Readplace");
		expect(doc.querySelector("h1")?.textContent).toBe("Invoices");
		expect(doc.querySelector("[data-test-invoices-back]")?.getAttribute("href")).toBe(
			"/account?utm_source=account-invoices&utm_medium=internal&utm_content=back",
		);
		expect(invoicesState(doc)).toBe("list");
		const rows = invoiceRows(doc);
		expect(rows).toHaveLength(12);
		const [newest] = rows;
		const date = newest.querySelector("time[data-local-time='date']");
		assert(date, "each invoice date must render as a localisable <time>");
		expect(date.getAttribute("datetime")).toBe("2026-09-18T00:00:00.000Z");
		expect(date.textContent).toBe("Sep 18, 2026");
		expect(newest.querySelector(".account-invoices__number")?.textContent).toBe("RP-001");
		expect(newest.querySelector(".account-invoices__amount")?.textContent).toBe("$10.00");
		const link = newest.querySelector("[data-test-invoice-link]");
		assert(link, "each invoice must link to its hosted page");
		expect(link.getAttribute("href")).toBe("https://invoice.stripe.com/i/acct_test/in_route001");
		expect(link.getAttribute("rel")).toBe("noreferrer");
		expect(link.textContent).toBe("View invoice RP-001");
		expect(harness.subscriptionBilling.invoiceLookups()).toEqual(["cus_invoices"]);
	});

	it("pages to the older invoices, with Newer disabled on the first page", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await subscriberWithInvoices(harness, "invoices-pager@example.com", paidInvoices(13));

		const doc = new JSDOM((await agent.get("/account/invoices")).text).window.document;

		const pager = doc.querySelector("[data-test-invoices-pagination]");
		assert(pager, "the pager must always render");
		expect(pager.className).toBe("pagination pagination--visible");
		expect(pagerStep(doc, "newer").tagName).toBe("SPAN");
		expect(pagerStep(doc, "newer").getAttribute("aria-disabled")).toBe("true");
		expect(pagerStep(doc, "older").getAttribute("href")).toBe(
			"/account/invoices?after=in_route012&utm_source=account-invoices&utm_medium=internal&utm_content=older",
		);
		expect(pagerStep(doc, "older").getAttribute("rel")).toBe("next");
	});

	it("follows the after cursor to the older page, where Newer leads back and Older is the end", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await subscriberWithInvoices(harness, "invoices-after@example.com", paidInvoices(13));

		const doc = new JSDOM((await agent.get("/account/invoices?after=in_route012")).text).window.document;

		expect(invoiceRows(doc).map((row) => row.querySelector(".account-invoices__number")?.textContent)).toEqual([
			"RP-013",
		]);
		expect(pagerStep(doc, "newer").getAttribute("href")).toBe(
			"/account/invoices?before=in_route013&utm_source=account-invoices&utm_medium=internal&utm_content=newer",
		);
		expect(pagerStep(doc, "newer").getAttribute("rel")).toBe("prev");
		expect(pagerStep(doc, "older").getAttribute("aria-disabled")).toBe("true");
	});

	it("follows the before cursor back to the newest page", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await subscriberWithInvoices(harness, "invoices-before@example.com", paidInvoices(13));

		const doc = new JSDOM((await agent.get("/account/invoices?before=in_route013")).text).window.document;

		expect(invoiceRows(doc)).toHaveLength(12);
		expect(invoiceRows(doc)[0].querySelector(".account-invoices__number")?.textContent).toBe("RP-001");
		expect(pagerStep(doc, "newer").getAttribute("aria-disabled")).toBe("true");
		expect(pagerStep(doc, "older").getAttribute("href")).toBe(
			"/account/invoices?after=in_route012&utm_source=account-invoices&utm_medium=internal&utm_content=older",
		);
	});

	it.each([
		["an after cursor that is not an invoice id", "?after=not-an-invoice"],
		["a before cursor that is not an invoice id", "?before=in_bad-id"],
		["both cursors at once", "?after=in_route001&before=in_route002"],
		["a repeated cursor", "?after=in_route001&after=in_route002"],
	])("refuses %s with a 400, before asking Stripe anything", async (_case, query) => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await subscriberWithInvoices(harness, "invoices-bad-cursor@example.com", paidInvoices(13));

		const response = await agent.get(`/account/invoices${query}`);

		expect(response.status).toBe(400);
		expect(response.text).toBe("Unknown invoice cursor");
		expect(harness.subscriptionBilling.invoiceLookups()).toEqual([]);
	});

	it("lists a $0.00 invoice — a fully discounted period still has a receipt", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const [discounted] = paidInvoices(1);
		const { agent } = await subscriberWithInvoices(harness, "invoices-zero@example.com", [
			{ ...discounted, amountPaidMinor: 0 },
		]);

		const doc = new JSDOM((await agent.get("/account/invoices")).text).window.document;

		expect(invoiceRows(doc).map((row) => row.querySelector(".account-invoices__amount")?.textContent)).toEqual([
			"$0.00",
		]);
		const pager = doc.querySelector("[data-test-invoices-pagination]");
		assert(pager, "the pager must always render");
		expect(pager.className).toBe("pagination pagination--hidden");
	});

	it("shows the empty state when the customer has no paid invoice yet", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await subscriberWithInvoices(harness, "invoices-empty@example.com", []);

		const doc = new JSDOM((await agent.get("/account/invoices")).text).window.document;

		expect(invoicesState(doc)).toBe("empty");
		const empty = doc.querySelector("[data-test-invoices-empty]");
		assert(empty, "the empty state must render");
		expect(empty.querySelector("h2")?.textContent).toBe("No invoices yet");
		expect(empty.querySelector("p")?.textContent).toBe("Your invoices appear here after your first payment.");
		expect(invoiceRows(doc)).toHaveLength(0);
	});

	it("shows the empty state, without asking Stripe, to a reader with no billing customer", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get("/account/invoices");

		expect(response.status).toBe(200);
		expect(invoicesState(new JSDOM(response.text).window.document)).toBe("empty");
		expect(harness.subscriptionBilling.invoiceLookups()).toEqual([]);
	});

	it("degrades a failed invoice read to an error alert in place of the list", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await subscriberWithInvoices(harness, "invoices-error@example.com", paidInvoices(3));
		harness.subscriptionBilling.failInvoiceLookup();

		const response = await agent.get("/account/invoices");

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		expect(invoicesState(doc)).toBe("provider-error");
		const alert = doc.querySelector('[data-test-alert="account-invoices"]');
		assert(alert, "the provider error must render as an alert");
		expect(alert.getAttribute("data-test-alert-variant")).toBe("error");
		expect(alert.querySelector("[data-test-alert-message]")?.textContent).toBe(
			"Couldn't load your invoices. Refresh the page to try again.",
		);
		expect(invoiceRows(doc)).toHaveLength(0);
	});

	it("redirects unauthenticated visitors to /login", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server).get("/account/invoices");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/login?return=%2Faccount%2Finvoices");
	});
});

describe("POST /account/delete", () => {
	it("destroys the session, clears the cookie, and redirects to the logged-out home when the confirmation phrase is typed", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const revocations: Array<{ userId: string; cause: string }> = [];
		const revoke = fixture.oauth.revokeAllUserOAuthTokens;
		fixture.oauth.revokeAllUserOAuthTokens = async (userId, cause) => {
			revocations.push({ userId, cause });
			await revoke(userId, cause);
		};
		const harness = useApp(fixture);
		const { agent, userId } = await loginUser(harness, "delete-me@example.com");

		const response = await agent
			.post("/account/delete")
			.type("form")
			.send({ confirmation: "delete my account permanently" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/");
		expect(revocations).toEqual([{ userId, cause: "account-deletion" }]);
		const rawSetCookie = response.headers["set-cookie"];
		const setCookie = Array.isArray(rawSetCookie) ? rawSetCookie : [];
		assert(
			setCookie.some((c) => c.startsWith("hutch_sid=")),
			"the session cookie must be cleared",
		);

		// The session was destroyed, so the agent's cookie no longer authenticates.
		const after = await agent.get("/account");
		expect(after.status).toBe(303);
		expect(after.headers.location).toBe("/login?return=%2Faccount");
	});

	it("marks the identity deleted before publishing, so the same password cannot mint a fresh session while the scrub runs", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const email = "delete-then-login@example.com";
		const { agent } = await loginUser(harness, email);

		const deleteResponse = await agent
			.post("/account/delete")
			.type("form")
			.send({ confirmation: "delete my account permanently" });
		expect(deleteResponse.status).toBe(303);

		// The async scrub has not run (the fixture's publish is a no-op), so the
		// identity row still exists — only the deletedAt marker stands between the
		// raw credential and a fresh session.
		expect(await harness.auth.findUserByEmail(email)).toBeNull();

		const relogin = await request(harness.server)
			.post("/login")
			.type("form")
			.send({ email, password: "password123" });
		expect(relogin.status).toBe(422);
		const doc = new JSDOM(relogin.text).window.document;
		const globalError = doc.querySelector('[data-test-alert="global-error"]');
		assert(globalError, "the account failure must render a global error alert");
		expect(globalError.getAttribute("data-test-alert-variant")).toBe("error");
		expect(globalError.getAttribute("role")).toBe("alert");
		expect(globalError.classList.contains("alert--visible")).toBe(true);
		expect(globalError.textContent).toContain(
			"Invalid email or password",
		);
	});

	it("returns an HX-Redirect to the logged-out home for a boosted (HTMX) request", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await loginUser(harness, "delete-hx@example.com");

		const response = await agent
			.post("/account/delete")
			.set("HX-Request", "true")
			.type("form")
			.send({ confirmation: "delete my account permanently" });

		expect(response.status).toBe(200);
		expect(response.headers["hx-redirect"]).toBe("/");
	});

	it.each([
		["a plain form post", {}, 303],
		["a boosted (HTMX) request", { "HX-Request": "true" }, 200],
	])("tells the browser to clear the origin's storage on %s, so articles kept for offline reading do not outlive the account on a shared device", async (_name, headers, status) => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await loginUser(harness, "delete-offline@example.com");

		const response = await agent
			.post("/account/delete")
			.set(headers)
			.type("form")
			.send({ confirmation: "delete my account permanently" });

		expect(response.status).toBe(status);
		expect(response.headers["clear-site-data"]).toBe('"storage"');
	});

	it("rejects a delete without the confirmation phrase — session survives and the account page shows the notice", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await loginUser(harness, "delete-unconfirmed@example.com");

		const response = await agent.post("/account/delete");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account?error=delete_confirmation");

		// The session was never destroyed — the agent is still signed in.
		const after = await agent.get("/account?error=delete_confirmation");
		expect(after.status).toBe(200);
		const doc = new JSDOM(after.text).window.document;
		const danger = doc.querySelector("[data-test-account-danger]");
		assert(danger, "the danger zone must render");
		expect(danger.getAttribute("data-test-danger-presentation")).toBe("inline");
		const inlineForm = dangerForm(doc, "inline");
		assert(danger.contains(inlineForm), "the refused form must render in the danger card, where no popover has to open");
		const notice = inlineForm.querySelector("[data-test-danger-notice]");
		assert(notice, "the rejected-delete notice must render");
		expect(notice.getAttribute("role")).toBe("alert");
		expect(notice.classList.contains("form-field__error")).toBe(true);
		expect(notice.textContent).toBe(
			'Your account was not deleted. Type "delete my account permanently" exactly to confirm.',
		);
		const input = inlineForm.querySelector("[data-test-danger-confirm-input]");
		assert(input, "the typed-confirmation input must render beside its notice");
		expect(input.getAttribute("aria-invalid")).toBe("true");
		const describedBy = input.getAttribute("aria-describedby");
		assert(describedBy, "the refused input must point at its notice");
		expect(doc.getElementById(describedBy)).toBe(notice);
	});

	it("rejects a delete whose confirmation phrase does not match exactly", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await loginUser(harness, "delete-typo@example.com");

		const response = await agent
			.post("/account/delete")
			.type("form")
			.send({ confirmation: "Delete My Account Permanently" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account?error=delete_confirmation");

		const after = await agent.get("/account");
		expect(after.status).toBe(200);
	});

	it("preserves the iOS surface across a rejected delete so the notice re-renders commerce-free (Guideline 3.1.1)", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await loginUser(harness, "ios-delete-reject@example.com");

		// The in-app delete form posts with ?platform=ios, so the rejection redirect
		// must carry it forward — a bare /account?error=… would bounce the WKWebView
		// to the web surface with its subscribe CTAs.
		const response = await agent.post("/account/delete?platform=ios");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account?error=delete_confirmation&platform=ios");
	});

	it("preserves the app shell across a rejected delete so the notice re-renders chromeless", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await loginUser(harness, "shell-delete-reject@example.com");

		const response = await agent.post("/account/delete?platform=ios&shell=app");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(
			"/account?error=delete_confirmation&platform=ios&shell=app",
		);
	});

	it("sends the app shell to the sign-out deep link instead of the logged-out home, which would be marketing chrome inside the sheet", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await loginUser(harness, "shell-delete@example.com");

		// The in-app form is hx-boosted, so the app's WKWebView reaches the deep link
		// through HX-Redirect — the delegate sees a navigation and cancels it.
		const response = await agent
			.post("/account/delete?platform=ios&shell=app")
			.set("HX-Request", "true")
			.type("form")
			.send({ confirmation: "delete my account permanently" });

		expect(response.status).toBe(200);
		expect(response.headers["hx-redirect"]).toBe("readplace://account/logout");
	});

	it("sends the same sign-out deep link on the plain 303 path, for an app shell whose htmx failed to load", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await loginUser(harness, "shell-delete-303@example.com");

		const response = await agent
			.post("/account/delete?platform=ios&shell=app")
			.type("form")
			.send({ confirmation: "delete my account permanently" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("readplace://account/logout");

		// The account is still deleted — the session no longer authenticates.
		const after = await agent.get("/account");
		expect(after.status).toBe(303);
		expect(after.headers.location).toBe("/login?return=%2Faccount");
	});

	it("keeps sending a pre-marker app build to the logged-out home — it cannot execute a deep link", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await loginUser(harness, "ios-delete-oldbuild@example.com");

		const response = await agent
			.post("/account/delete?platform=ios")
			.type("form")
			.send({ confirmation: "delete my account permanently" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/");
	});

	it("redirects unauthenticated callers to /login", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).post("/account/delete");
		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/login?return=%2Faccount%2Fdelete");
	});
});

describe("GET /account (export)", () => {
	function expectExportLink(doc: Document) {
		const card = doc.querySelector("[data-test-account-export]");
		assert(card, "the export card must render");
		const link = card.querySelector("[data-test-account-export-link]");
		assert(link, "the export link must render");
		expect(link.tagName).toBe("A");
		expect(link.getAttribute("href")).toBe(
			"/export?utm_source=account&utm_medium=internal&utm_content=export",
		);
		expect(link.textContent).toBe("Export data");
	}

	it("offers the data export, which no longer has a header-nav entry of its own", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get("/account");
		const doc = new JSDOM(response.text).window.document;

		expectExportLink(doc);
		expect(doc.querySelector('[data-test-nav-item="export"]')).toBeNull();
	});

	it("keeps the export a link on the app shell, which the iOS sheet opens in the browser instead of loading the web header's commerce in-app", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get("/account?platform=ios&shell=app");
		const doc = new JSDOM(response.text).window.document;

		expectExportLink(doc);
	});

	it("keeps the export reachable for a read-only user, whose data is still theirs to take", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "export-expired@example.com");
		await subscriptionProviders.upsertTrialing({
			userId,
			trialEndsAt: new Date(Date.now() - ONE_DAY_MS).toISOString(),
		});

		const response = await agent.get("/account");
		const doc = new JSDOM(response.text).window.document;

		expectExportLink(doc);
	});
});

describe("GET /account (import)", () => {
	const EXPORT = ["Export data", "/export?utm_source=account&utm_medium=internal&utm_content=export"];
	const IMPORT = ["Import links", "/import?utm_source=account&utm_medium=internal&utm_content=import"];

	function dataCardLinks(doc: Document) {
		const section = doc.querySelector('[data-test-account-section="data"]');
		assert(section, "the data section must render");
		return Array.from(
			section.querySelectorAll("[data-test-account-export-link], [data-test-account-import-link]"),
		).map((link) => [link.textContent, link.getAttribute("href")]);
	}

	it("offers Import after Export in the data card for a full-access user", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get("/account");
		const doc = new JSDOM(response.text).window.document;

		expect(dataCardLinks(doc)).toEqual([EXPORT, IMPORT]);
	});

	it("offers Import on the app shell too, where the header nav never renders", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get("/account?platform=ios&shell=app");
		const doc = new JSDOM(response.text).window.document;

		expect(dataCardLinks(doc)).toEqual([EXPORT, IMPORT]);
	});

	it("offers only Export to a read-only user, since committing an import saves links and saving is a write", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "import-expired@example.com");
		await subscriptionProviders.upsertTrialing({
			userId,
			trialEndsAt: new Date(Date.now() - ONE_DAY_MS).toISOString(),
		});

		const response = await agent.get("/account");
		const doc = new JSDOM(response.text).window.document;

		expect(dataCardLinks(doc)).toEqual([EXPORT]);
	});
});

describe("GET /account (danger zone)", () => {
	function expectConfirmationField(form: Element, inputId: string, opensFocused: boolean) {
		const input = form.querySelector("[data-test-danger-confirm-input]");
		assert(input, "the typed-confirmation input must render");
		expect(input.getAttribute("id")).toBe(inputId);
		expect(input.getAttribute("name")).toBe("confirmation");
		expect(input.hasAttribute("required")).toBe(true);
		expect(input.getAttribute("pattern")).toBe("delete my account permanently");
		expect(input.getAttribute("title")).toBe("Type the phrase exactly: delete my account permanently");
		expect(input.classList.contains("form-input")).toBe(true);
		expect(input.hasAttribute("aria-invalid")).toBe(false);
		expect(input.hasAttribute("aria-describedby")).toBe(false);
		expect(input.hasAttribute("autofocus")).toBe(opensFocused);

		const label = form.querySelector(`label[for="${inputId}"]`);
		assert(label, "the confirmation input must be labelled");
		expect(label.textContent).toBe('Type "delete my account permanently" to confirm');
		expect(label.classList.contains("form-field__label")).toBe(true);
		const field = input.closest(".form-field");
		assert(field, "the confirmation input must sit in a form field");
		assert(field.contains(label), "the label must share the confirmation input's form field");
	}

	it("opens a delete dialog from the row, and keeps the same delete form in the card for a browser without popovers", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get("/account");
		const doc = new JSDOM(response.text).window.document;

		const danger = doc.querySelector("[data-test-account-danger]");
		assert(danger, "the danger zone must render");
		expect(danger.getAttribute("data-test-danger-presentation")).toBe("dialog");
		const trigger = danger.querySelector("[data-test-danger-open]");
		assert(trigger, "the row must render the dialog trigger");
		expect(trigger.getAttribute("type")).toBe("button");
		expect(trigger.getAttribute("popovertarget")).toBe("delete-account");
		expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
		const dialog = doc.querySelector('[data-test-confirm-popover="delete-account"]');
		assert(dialog, "the delete dialog must render");
		expect(dialog.getAttribute("id")).toBe("delete-account");

		const fallback = dangerForm(doc, "fallback");
		const dialogForm = dangerForm(doc, "dialog");
		assert(danger.contains(fallback), "the no-popover fallback must render in the danger card");
		assert(dialog.contains(dialogForm), "the dialog's form must render in the dialog");
		for (const form of [dialogForm, fallback]) {
			expect(form.getAttribute("method")).toBe("POST");
			expect(form.getAttribute("action")).toBe(
				"/account/delete?utm_source=account&utm_medium=internal&utm_content=delete-account",
			);
			expect(form.getAttribute("hx-target")).toBe("main");
		}
	});

	it("warns the deletion is irreversible and loses all data, and requires typing the confirmation phrase in either form", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get("/account");
		const doc = new JSDOM(response.text).window.document;

		const danger = doc.querySelector("[data-test-account-danger]");
		assert(danger, "the danger zone must render");
		expect(danger.textContent).toContain("This can't be undone — you will lose all your data.");

		expectConfirmationField(dangerForm(doc, "dialog"), "delete-account-confirmation-dialog", true);
		expectConfirmationField(dangerForm(doc, "fallback"), "delete-account-confirmation", false);
	});

	it("puts Cancel before the commit in the dialog, and only the commit shows the in-flight dots", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get("/account");
		const doc = new JSDOM(response.text).window.document;

		const buttons = Array.from(dangerForm(doc, "dialog").querySelectorAll("button"));
		expect(buttons.map((button) => [button.getAttribute("data-test-action"), button.getAttribute("type")])).toEqual([
			["delete-account-cancel", "button"],
			["delete-account-confirm", "submit"],
		]);
		const cancel = buttons[0];
		expect(cancel.getAttribute("popovertarget")).toBe("delete-account");
		expect(cancel.getAttribute("popovertargetaction")).toBe("hide");
		expect(cancel.innerHTML).toBe("Cancel");
		const commit = buttons[1];
		expect(commit.querySelector(".account__action-label")?.textContent).toBe("Delete account");
		assert(commit.querySelector(".account__action-loader"), "the commit must carry the in-flight dots");

		const fallbackSubmit = dangerForm(doc, "fallback").querySelector('button[type="submit"]');
		assert(fallbackSubmit, "the fallback form must render its submit");
		expect(fallbackSubmit.getAttribute("data-test-action")).toBe("delete-account-submit");
		expect(fallbackSubmit.querySelector(".account__action-label")?.textContent).toBe("Delete account");
	});
});

describe("GET /account (Profile row)", () => {
	function profileCard(doc: Document): Element {
		const card = doc.querySelector("[data-test-account-profile]");
		assert(card, "the Profile section must render its card");
		return card;
	}

	function profileRow(doc: Document): Element {
		const row = profileCard(doc).querySelector(".account-row");
		assert(row, "the Profile card must render its row");
		return row;
	}

	function leadingClasses(parent: Element): string[] {
		return Array.from(parent.children).map((child) => child.classList[0]);
	}

	it("gives the web row an Edit that opens a one-field dialog, with the same form inline as the no-popover fallback", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, userId } = await loginUser(harness, "profile-web@example.com");
		await harness.auth.setUserDisplayName({ userId, displayName: DisplayNameSchema.parse("Reader Name") });

		const doc = new JSDOM((await agent.get("/account")).text).window.document;

		expect(leadingClasses(profileRow(doc))).toEqual(["account-row__icon", "account-row__text", "account-row__actions"]);
		expect(leadingClasses(profileCard(doc))).toEqual(["account-row", "account-profile__fallback"]);
		const trigger = profileRow(doc).querySelector('[data-test-action="account-profile-edit"]');
		assert(trigger, "the web Profile row must render its Edit trigger");
		expect(trigger.getAttribute("popovertarget")).toBe("account-profile-edit");
		const panel = doc.getElementById("account-profile-edit");
		assert(panel, "the Edit trigger must target the profile dialog");
		expect(panel.getAttribute("data-test-confirm-popover")).toBe("account-profile");
		const dialogForm = panel.querySelector('[data-test-form="account-profile"]');
		assert(dialogForm, "the dialog must render the profile form");
		const fallbackForm = profileCard(doc).querySelector('[data-test-form="account-profile-fallback"]');
		assert(fallbackForm, "the Profile card must render the fallback form");
		const fields = [dialogForm, fallbackForm].map((form) => {
			const field = form.querySelector<HTMLInputElement>("input.form-input");
			assert(field, "each profile form must render its name field");
			return [
				form.getAttribute("method"),
				form.getAttribute("action"),
				field.name,
				field.getAttribute("maxlength"),
				field.getAttribute("autocomplete"),
				field.value,
				doc.querySelector(`label[for="${field.id}"]`)?.textContent,
				field.hasAttribute("autofocus"),
			];
		});
		const formAction = "/account/profile?utm_source=account&utm_medium=internal&utm_content=edit-profile";
		expect(fields).toEqual([
			["POST", formAction, "displayName", "64", "name", "Reader Name", "Name", true],
			["POST", formAction, "displayName", "64", "name", "Reader Name", "Name", false],
		]);
	});

	it.each([
		["the iOS surface", "/account?platform=ios"],
		["the Android surface", "/account?platform=android"],
		["the app shell", "/account?shell=app"],
		["the iOS app's in-app web sheet", "/account?platform=ios&shell=app"],
	])("shows %s the Profile row read-only, with no Edit and no form", async (_surface, path) => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await loginUser(harness, "profile-native@example.com");

		const doc = new JSDOM((await agent.get(path)).text).window.document;

		expect(
			Array.from(doc.querySelectorAll("[data-test-account-section]")).map((section) =>
				section.getAttribute("data-test-account-section"),
			)[0],
		).toBe("profile");
		expect(profileLineTexts(doc)).toEqual(["profile-native@example.com"]);
		expect(leadingClasses(profileRow(doc))).toEqual(["account-row__icon", "account-row__text"]);
		expect(leadingClasses(profileCard(doc))).toEqual(["account-row"]);
		const section = doc.querySelector('[data-test-account-section="profile"]');
		assert(section, "the Profile section must render");
		expect(section.querySelectorAll("form")).toHaveLength(0);
		expect(confirmPopoverKeys(doc)).toEqual(["delete-account"]);
	});
});

describe("GET /account (security section)", () => {
	const CHANGE_HREF = "/account/password?utm_source=account&utm_medium=internal&utm_content=change-password";

	function securitySection(doc: Document): Element {
		const section = doc.querySelector('[data-test-account-section="security"]');
		assert(section, "the account page must always render the security slot");
		return section;
	}

	function passwordRow(doc: Document): Element {
		const row = securitySection(doc).querySelector('[data-test-settings-row="password"]');
		assert(row, "the security section must render the password row");
		return row;
	}

	function changeLink(doc: Document): Element {
		const link = passwordRow(doc).querySelector('[data-test-action="account-change-password"]');
		assert(link, "the password row must render its change action");
		return link;
	}

	function updatedLine(doc: Document): Element {
		const line = passwordRow(doc).querySelector("[data-test-password-updated-line]");
		assert(line, "the password row must always render its last-updated slot");
		return line;
	}

	function passwordChangedAlert(doc: Document): Element {
		const alert = securitySection(doc).querySelector('[data-test-alert="password-changed"]');
		assert(alert, "the security section must always render its confirmation slot");
		return alert;
	}

	async function signInWithGoogle(harness: ReturnType<ReturnType<typeof useTestServer>>) {
		const userId = UserIdSchema.parse("google-account-reader");
		await harness.auth.createGoogleUser({ email: "google-account-reader@example.com", userId });
		const sessionId = await harness.auth.createSession({ userId, emailVerified: true });
		return { cookie: `hutch_sid=${sessionId}` };
	}

	it("shows a password account its Password row, with a boosted link to the change page", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await loginUser(harness, "security-web@example.com");

		const doc = new JSDOM((await agent.get("/account")).text).window.document;

		const section = securitySection(doc);
		expect(section.classList.contains("account-security--visible")).toBe(true);
		expect(section.querySelector(".account-section__heading")?.textContent).toBe("Security");
		expect(passwordRow(doc).querySelector(".account-row__title")?.textContent).toBe("Password");
		const link = changeLink(doc);
		expect(link.textContent).toBe("Change password");
		expect(
			["href", "hx-boost", "hx-target", "hx-select", "hx-swap"].map((name) => link.getAttribute(name)),
		).toEqual([CHANGE_HREF, "true", "main", "main", "outerHTML show:none scroll:html:top"]);
		expect(link.parentElement?.classList.contains("account-row__actions")).toBe(true);
	});

	it("reads when the password last changed, with the instant on the time element", async () => {
		const now = new Date("2026-10-15T12:00:00.000Z");
		const changedAt = new Date(now.getTime() - 180 * ONE_DAY_MS).toISOString();
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.shared.now = () => now;
		const harness = useApp(fixture);
		const { agent } = await loginUser(harness, "security-stamp@example.com");
		await harness.auth.updatePassword({
			email: "security-stamp@example.com",
			password: "password123",
			updatedAt: changedAt,
		});

		const doc = new JSDOM((await agent.get("/account")).text).window.document;

		const line = updatedLine(doc);
		expect(line.textContent).toBe("Last updated 6 months ago.");
		expect(line.classList.contains("account-security__updated--visible")).toBe(true);
		const time = line.querySelector("[data-test-password-updated]");
		assert(time, "the last-updated line must name the instant");
		expect([time.tagName, time.getAttribute("datetime"), time.getAttribute("data-local-time")]).toEqual([
			"TIME",
			changedAt,
			"relative",
		]);
	});

	it("leaves the last-updated line off for a password Readplace never recorded a change for", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.auth.findUserPasswordStatus = async () => ({ kind: "set", updatedAt: undefined });
		const harness = useApp(fixture);
		const { agent } = await loginUser(harness, "security-legacy@example.com");

		const doc = new JSDOM((await agent.get("/account")).text).window.document;

		expect(passwordRow(doc).querySelector(".account-row__title")?.textContent).toBe("Password");
		expect(changeLink(doc).getAttribute("href")).toBe(CHANGE_HREF);
		const line = updatedLine(doc);
		expect(line.classList.contains("account-security__updated--hidden")).toBe(true);
		expect(line.innerHTML).toBe("");
	});

	it("hides the section for an account that signs in with Google and has no password", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { cookie } = await signInWithGoogle(harness);

		const response = await request(harness.server).get("/account").set("Cookie", cookie);

		expect(response.status).toBe(200);
		const section = securitySection(new JSDOM(response.text).window.document);
		expect(section.classList.contains("account-security--hidden")).toBe(true);
		expect(section.innerHTML).toBe("");
	});

	it("confirms a just-changed password with a success alert in the section", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await loginUser(harness, "security-changed@example.com");

		const doc = new JSDOM((await agent.get("/account?password=changed")).text).window.document;

		const alert = passwordChangedAlert(doc);
		expect([
			alert.classList.contains("alert--visible"),
			alert.getAttribute("data-test-alert-variant"),
			alert.getAttribute("role"),
			alert.querySelector("[data-test-alert-title]")?.textContent,
			alert.querySelector("[data-test-alert-message]")?.textContent,
		]).toEqual([true, "success", "status", "Password changed", "Other browsers were signed out and your other connected apps were disconnected."]);
		const card = securitySection(doc).querySelector("[data-test-account-security]");
		assert(card, "the security section must render its card");
		expect(alert.nextElementSibling).toBe(card);
	});

	it("keeps the confirmation slot hidden without the flag", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await loginUser(harness, "security-quiet@example.com");

		const doc = new JSDOM((await agent.get("/account")).text).window.document;

		expect(passwordChangedAlert(doc).classList.contains("alert--hidden")).toBe(true);
	});

	it.each([
		["the iOS app sheet", "/account?platform=ios&shell=app", "platform=ios&shell=app&"],
		["the Android app sheet", "/account?platform=android&shell=app", "platform=android&shell=app&"],
		["the iOS surface", "/account?platform=ios", "platform=ios&"],
	])("carries %s's markers onto the same boosted change link", async (_surface, path, markers) => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await loginUser(harness, "security-surface@example.com");

		const doc = new JSDOM((await agent.get(path)).text).window.document;

		const link = changeLink(doc);
		expect(["href", "hx-boost", "hx-target", "hx-select"].map((name) => link.getAttribute(name))).toEqual([
			`/account/password?${markers}utm_source=account&utm_medium=internal&utm_content=change-password`,
			"true",
			"main",
			"main",
		]);
	});
});

describe("POST /account/profile", () => {
	function navUserNames(doc: Document): string[] {
		return Array.from(doc.querySelectorAll("[data-test-nav-user-name]")).map((name) => name.textContent ?? "");
	}

	function accountMenuSummary(doc: Document): Element {
		const summary = doc.querySelector('[data-test-nav-group="account"] summary.nav__user-summary');
		assert(summary, "the header must render the account menu trigger");
		return summary;
	}

	it("saves a display name, which then titles the Profile row and replaces the email in the header", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await loginUser(harness, "reader@example.com");

		const post = await agent
			.post("/account/profile?utm_source=account&utm_medium=internal&utm_content=edit-profile")
			.type("form")
			.send({ displayName: "  Reader Name  " });

		expect(post.status).toBe(303);
		expect(post.headers.location).toBe("/account");
		const doc = new JSDOM((await agent.get("/account")).text).window.document;
		expect(profileLineTexts(doc)).toEqual(["Reader Name", "reader@example.com"]);
		expect(navUserNames(doc)).toEqual(["Reader Name", "Reader Name"]);
		expect(accountMenuSummary(doc).querySelector(".nav__avatar")?.textContent).toBe("RN");
		expect(accountMenuSummary(doc).getAttribute("aria-label")).toBe(
			"Account menu for Reader Name (reader@example.com)",
		);
	});

	it("clears the name on a blank save, so the email names the account again", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, userId } = await loginUser(harness, "reader@example.com");
		await harness.auth.setUserDisplayName({ userId, displayName: DisplayNameSchema.parse("Reader Name") });

		const post = await agent.post("/account/profile").type("form").send({ displayName: "   " });

		expect(post.status).toBe(303);
		expect(post.headers.location).toBe("/account");
		const doc = new JSDOM((await agent.get("/account")).text).window.document;
		expect(profileLineTexts(doc)).toEqual(["reader@example.com"]);
		expect(navUserNames(doc)).toEqual(["reader@example.com", "reader@example.com"]);
		expect(accountMenuSummary(doc).getAttribute("aria-label")).toBe("Account menu for reader@example.com");
	});

	it("refuses a name over 64 characters and keeps the saved one", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, userId } = await loginUser(harness, "reader@example.com");
		await harness.auth.setUserDisplayName({ userId, displayName: DisplayNameSchema.parse("Reader Name") });

		const post = await agent.post("/account/profile").type("form").send({ displayName: "R".repeat(65) });

		expect(post.status).toBe(400);
		expect(post.text).toBe("Names are 64 characters or fewer.");
		const doc = new JSDOM((await agent.get("/account")).text).window.document;
		expect(profileLineTexts(doc)).toEqual(["Reader Name", "reader@example.com"]);
	});

	it("refuses a post that carries no name field", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await loginUser(harness, "reader@example.com");

		const post = await agent.post("/account/profile").type("form").send({});

		expect(post.status).toBe(400);
		expect(post.text).toBe("Missing name");
	});
});

describe("Account appearance preference", () => {
	function appearanceOption(doc: Document, value: string): Element {
		const el = doc.querySelector(`[data-test-appearance-option="${value}"]`);
		assert(el, `appearance option "${value}" must be rendered`);
		return el;
	}

	it("renders the appearance control with Auto active by default and no theme class pinned", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await loginUser(harness, "appearance-default@example.com");

		const response = await agent.get("/account");

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		const section = doc.querySelector("[data-test-account-appearance]");
		assert(section, "appearance section must be rendered");
		const options = Array.from(section.querySelectorAll("[data-test-appearance-option]"));
		expect(options.map((option) => option.getAttribute("data-test-appearance-option"))).toEqual([
			"light",
			"dark",
			"system",
		]);
		expect(options.map((option) => option.classList.contains("btn--neutral"))).toEqual([true, true, true]);
		expect(
			options.filter((option) => option.getAttribute("aria-pressed") === "true").map((option) => option.textContent),
		).toEqual(["Auto"]);
		const group = section.querySelector('[role="group"]');
		assert(group, "the options must be grouped");
		const labelledBy = group.getAttribute("aria-labelledby");
		assert(labelledBy, "the group must be labelled by its row title");
		expect(doc.getElementById(labelledBy)?.textContent).toBe("Theme");
		expect(appearanceOption(doc, "system").getAttribute("aria-pressed")).toBe("true");
		expect(appearanceOption(doc, "light").getAttribute("aria-pressed")).toBe("false");
		expect(appearanceOption(doc, "dark").getAttribute("aria-pressed")).toBe("false");
		expect(doc.body.classList.contains("theme-light")).toBe(false);
		expect(doc.body.classList.contains("theme-dark")).toBe(false);
	});

	it("persists a chosen preference and re-renders it active with the theme pinned on the body", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await loginUser(harness, "appearance-dark@example.com");

		const post = await agent.post("/account/appearance").type("form").send({ appearance: "dark" });
		expect(post.status).toBe(303);
		expect(post.headers.location).toBe("/account");

		const response = await agent.get("/account");
		const doc = new JSDOM(response.text).window.document;
		expect(appearanceOption(doc, "dark").getAttribute("aria-pressed")).toBe("true");
		expect(appearanceOption(doc, "system").getAttribute("aria-pressed")).toBe("false");
		expect(doc.body.classList.contains("theme-dark")).toBe(true);
	});

	it("ignores an unrecognised appearance value and leaves the preference unchanged", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await loginUser(harness, "appearance-invalid@example.com");

		const post = await agent.post("/account/appearance").type("form").send({ appearance: "purple" });
		expect(post.status).toBe(303);

		const response = await agent.get("/account");
		const doc = new JSDOM(response.text).window.document;
		expect(appearanceOption(doc, "system").getAttribute("aria-pressed")).toBe("true");
	});
});
