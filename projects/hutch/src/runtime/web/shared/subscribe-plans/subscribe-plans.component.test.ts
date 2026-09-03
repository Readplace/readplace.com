import assert from "node:assert/strict";
import { PRICING_PANELS, PRICING_PLANS } from "@packages/web-shell";

const featuredPanel = PRICING_PANELS.find((panel) => panel.featured);
assert(featuredPanel, "the pricing model must feature one panel");
assert(featuredPanel.badge, "the featured panel must carry the badge");
const FEATURED_PLAN = featuredPanel.key;
const FEATURED_PLAN_BADGE = featuredPanel.badge;
import { parseHTML } from "linkedom";
import {
	SUBSCRIBE_PLANS_POPOVER_ID,
	renderSubscribePlansPopover,
	type SubscribePlansSource,
} from "./subscribe-plans.component";

const PLAN_ORDER = ["monthly", "yearly", "triennial"] as const;

function panelFor(source: SubscribePlansSource = "queue-banner") {
	const { document } = parseHTML(`<div>${renderSubscribePlansPopover({ source })}</div>`);
	return document;
}

type PanelRoot = Pick<ReturnType<typeof panelFor>, "querySelector" | "querySelectorAll">;

function planKeys(root: PanelRoot): (string | null)[] {
	return [...root.querySelectorAll("[data-test-plan]")].map((panel) =>
		panel.getAttribute("data-test-plan"),
	);
}

function planKeysContaining(root: PanelRoot, selector: string): (string | null)[] {
	return [...root.querySelectorAll("[data-test-plan]")]
		.filter((panel) => panel.querySelector(selector) !== null)
		.map((panel) => panel.getAttribute("data-test-plan"));
}

describe("renderSubscribePlansPopover", () => {
	it("offers the three plans in the order the money model anchors them", () => {
		expect(planKeys(panelFor())).toEqual([...PLAN_ORDER]);
	});

	it("badges only the plan the pricing anchors on, with the wording the money model owns", () => {
		const doc = panelFor();

		expect(planKeysContaining(doc, "[data-test-plan-badge]")).toEqual([FEATURED_PLAN]);
		const badge = doc.querySelector(`[data-test-plan="${FEATURED_PLAN}"] [data-test-plan-badge]`);
		assert(badge, "the featured plan must carry its badge");
		expect(badge.textContent).toBe(FEATURED_PLAN_BADGE);
	});

	it("spends the single primary button on the featured plan and leaves the rest secondary", () => {
		const doc = panelFor();

		expect(planKeysContaining(doc, "button.btn.btn--primary")).toEqual([FEATURED_PLAN]);
		expect(planKeysContaining(doc, "button.btn.btn--secondary")).toEqual([
			"monthly",
			"triennial",
		]);
		const featured = doc.querySelector(`[data-test-plan="${FEATURED_PLAN}"]`);
		assert(featured, "the featured panel must be rendered");
		expect(featured.classList.contains("subscribe-plans__panel--featured")).toBe(true);
	});

	it("quotes every panel per month and names the interval it actually bills on underneath", () => {
		const priced = [...panelFor().querySelectorAll("[data-test-plan]")].map((panel) => ({
			key: panel.getAttribute("data-test-plan"),
			name: panel.querySelector(".subscribe-plans__name")?.textContent,
			price: panel.querySelector(".subscribe-plans__price")?.textContent,
			billed: panel.querySelector(".subscribe-plans__billed")?.textContent,
		}));

		expect(priced).toEqual(
			PLAN_ORDER.map((key) => ({
				key,
				name: PRICING_PLANS[key].name,
				price: `${PRICING_PLANS[key].monthlyDisplay}/month`,
				billed: PRICING_PLANS[key].billedNote,
			})),
		);
	});

	it("posts each panel's own plan to the subscribe endpoint, boosted onto main", () => {
		const forms = [...panelFor("account").querySelectorAll("[data-test-plan] form")].map(
			(form) => ({
				method: form.getAttribute("method"),
				action: form.getAttribute("action"),
				plan: form.querySelector("input[name='plan']")?.getAttribute("value"),
				submit: form.querySelector("button[type='submit']")?.getAttribute("data-test-action"),
				label: form.querySelector("button[type='submit']")?.textContent,
				boost: form.getAttribute("hx-boost"),
				target: form.getAttribute("hx-target"),
				select: form.getAttribute("hx-select"),
				swap: form.getAttribute("hx-swap"),
			}),
		);

		expect(forms).toEqual(
			PLAN_ORDER.map((key) => ({
				method: "POST",
				action: `/account/subscribe?utm_source=account&utm_medium=internal&utm_content=plan-${key}`,
				plan: key,
				submit: `subscribe-plan-${key}`,
				label: `Choose ${PRICING_PLANS[key].name}`,
				boost: "true",
				target: "main",
				select: "main",
				swap: "outerHTML show:none",
			})),
		);
	});

	it("attributes the choice to the surface the panel was opened from", () => {
		const queue = panelFor("queue-banner").querySelector("[data-test-plan='yearly'] form");
		const account = panelFor("account").querySelector("[data-test-plan='yearly'] form");

		assert(queue, "the queue banner panel must post through a form");
		assert(account, "the account panel must post through a form");
		expect(queue.getAttribute("action")).toContain("utm_source=queue-banner");
		expect(account.getAttribute("action")).toContain("utm_source=account");
	});

	it("hands the shell one wide actions element that carries the whole plan grid", () => {
		const doc = panelFor();
		const popover = doc.querySelector("[data-test-confirm-popover='subscribe-plans']");
		const actions = doc.querySelector(".confirm-popover__actions");

		assert(popover, "the subscribe panel must be rendered");
		assert(actions, "the panel must hand the shell its actions element");
		expect(popover.getAttribute("id")).toBe(SUBSCRIBE_PLANS_POPOVER_ID);
		expect(popover.getAttribute("popover")).toBe("auto");
		expect(popover.classList.contains("confirm-popover--wide")).toBe(true);
		expect(actions.classList.contains("subscribe-plans__grid")).toBe(true);
		expect(planKeys(actions)).toEqual([...PLAN_ORDER]);
	});

	it("keeps the shell's dismiss control so a reader who opened the panel can close it again", () => {
		const dismiss = panelFor().querySelector("[data-test-action='subscribe-plans-dismiss']");

		assert(dismiss, "the panel must carry the shell's dismiss control");
		expect(dismiss.getAttribute("popovertarget")).toBe(SUBSCRIBE_PLANS_POPOVER_ID);
		expect(dismiss.getAttribute("popovertargetaction")).toBe("hide");
	});
});
