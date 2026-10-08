import assert from "node:assert/strict";
import {
	BILLING_PLANS,
	type BillingPlan,
	DEFAULT_BILLING_PLAN,
} from "@packages/provider-contracts/subscription-providers";
import type { EffectiveAccess } from "@packages/subscription-access";
import { PRICING_PANELS, PRICING_PLANS } from "@packages/web-shell";
import { parseHTML } from "linkedom";
import {
	SUBSCRIBE_PLANS_POPOVER_ID,
	SUBSCRIBE_PLANS_SOURCES,
	planChargedWithoutChoice,
	renderSubscribePlansForm,
	renderSubscribePlansPopover,
	type SubscribePlansSource,
} from "./subscribe-plans.component";

const featuredPanel = PRICING_PANELS.find((panel) => panel.featured);
assert(featuredPanel, "the pricing model must feature one panel");
assert(featuredPanel.badge, "the featured panel must carry the badge");
const FEATURED_PLAN = featuredPanel.key;
const FEATURED_PLAN_BADGE = featuredPanel.badge;

const ROW_ORDER = [
	FEATURED_PLAN,
	...PRICING_PANELS.map((panel) => panel.key).filter((key) => key !== FEATURED_PLAN),
];

function panelFor(input: { source?: SubscribePlansSource; checkedPlan?: BillingPlan } = {}) {
	const { document } = parseHTML(
		`<div>${renderSubscribePlansPopover({
			source: input.source ?? "queue-banner",
			checkedPlan: input.checkedPlan ?? DEFAULT_BILLING_PLAN,
		})}</div>`,
	);
	return document;
}

function formFor(input: { source: SubscribePlansSource; checkedPlan?: BillingPlan }) {
	const { document } = parseHTML(
		`<div>${renderSubscribePlansForm({
			source: input.source,
			labelledBy: "plans-heading",
			dismissControls: [],
			checkedPlan: input.checkedPlan ?? DEFAULT_BILLING_PLAN,
		})}</div>`,
	);
	return document;
}

type Root = Pick<ReturnType<typeof panelFor>, "querySelector" | "querySelectorAll">;

function planKeys(root: Root): (string | null)[] {
	return [...root.querySelectorAll("[data-test-plan]")].map((plan) =>
		plan.getAttribute("data-test-plan"),
	);
}

function planKeysContaining(root: Root, selector: string): (string | null)[] {
	return [...root.querySelectorAll("[data-test-plan]")]
		.filter((plan) => plan.querySelector(selector) !== null)
		.map((plan) => plan.getAttribute("data-test-plan"));
}

function testActions(root: Root, selector: string): (string | null)[] {
	return [...root.querySelectorAll(selector)].map((control) =>
		control.getAttribute("data-test-action"),
	);
}

function planForm(root: Root) {
	const form = root.querySelector("[data-test-form='subscribe-plans']");
	assert(form, "the plans must post through the plan form");
	return form;
}

describe("renderSubscribePlansPopover", () => {
	it("offers the featured plan first, then the rest in the money model's order", () => {
		expect(planKeys(panelFor())).toEqual(ROW_ORDER);
	});

	it.each(BILLING_PLANS)(
		"checks exactly the plan it is handed (%s), so the caller picks the one an untouched submit sends",
		(plan) => {
			const checked = [
				...panelFor({ checkedPlan: plan }).querySelectorAll("input[name='plan']:checked"),
			].map((radio) => radio.getAttribute("value"));

			expect(checked).toEqual([plan]);
		},
	);

	it("badges only the featured plan, with the wording the money model owns", () => {
		const doc = panelFor();

		expect(planKeysContaining(doc, "[data-test-plan-badge]")).toEqual([FEATURED_PLAN]);
		const badge = doc.querySelector(`[data-test-plan="${FEATURED_PLAN}"] [data-test-plan-badge]`);
		assert(badge, "the featured plan must carry its badge");
		expect(badge.textContent).toBe(FEATURED_PLAN_BADGE);
		expect(badge.classList.contains("chip--tab")).toBe(true);
		const featured = doc.querySelector(`[data-test-plan="${FEATURED_PLAN}"]`);
		assert(featured, "the featured plan must be rendered");
		expect(featured.classList.contains("subscribe-plans__plan--featured")).toBe(true);
	});

	it("quotes every row per month and names the charge and its cadence", () => {
		const priced = [...panelFor().querySelectorAll("[data-test-plan]")].map((plan) => ({
			key: plan.getAttribute("data-test-plan"),
			name: plan.querySelector(".subscribe-plans__name")?.textContent,
			price: plan.querySelector(".subscribe-plans__price")?.textContent,
			billed: plan.querySelector(".subscribe-plans__billed")?.textContent,
		}));

		expect(priced).toEqual(
			ROW_ORDER.map((key) => ({
				key,
				name: PRICING_PLANS[key].name,
				price: `${PRICING_PLANS[key].monthlyDisplay}/month`,
				billed: PRICING_PLANS[key].billedLine,
			})),
		);
	});

	it("posts the checked plan through one boosted form", () => {
		const doc = panelFor({ source: "account" });
		const form = planForm(doc);
		const radios = [...doc.querySelectorAll("input[type='radio']")];
		const submits = [...form.querySelectorAll("[type='submit']")];

		expect([...doc.querySelectorAll("form")].map((each) => each.getAttribute("data-test-form"))).toEqual([
			"subscribe-plans",
		]);
		expect({
			method: form.getAttribute("method"),
			action: form.getAttribute("action"),
			boost: form.getAttribute("hx-boost"),
			target: form.getAttribute("hx-target"),
			select: form.getAttribute("hx-select"),
			swap: form.getAttribute("hx-swap"),
		}).toEqual({
			method: "POST",
			action: "/account/subscribe?utm_source=account&utm_medium=internal&utm_content=choose-plan",
			boost: "true",
			target: "main",
			select: "main",
			swap: "outerHTML show:none",
		});
		expect(radios.map((radio) => radio.getAttribute("value"))).toEqual(ROW_ORDER);
		expect(radios.map((radio) => radio.getAttribute("name"))).toEqual(ROW_ORDER.map(() => "plan"));
		expect(radios.map((radio) => radio.closest("form")?.getAttribute("data-test-form"))).toEqual(
			ROW_ORDER.map(() => "subscribe-plans"),
		);
		expect(
			submits.map((submit) => ({
				action: submit.getAttribute("data-test-action"),
				label: submit.textContent,
			})),
		).toEqual([{ action: "subscribe-plans-submit", label: "Subscribe now" }]);
	});

	it("spends the one primary button on the commit", () => {
		expect(testActions(panelFor(), ".btn--primary")).toEqual(["subscribe-plans-submit"]);
	});

	it("closes from Cancel without JavaScript, and offers no other close control", () => {
		const doc = panelFor();
		const dismiss = doc.querySelector("[data-test-action='subscribe-plans-dismiss']");

		expect(testActions(doc, "[popovertargetaction='hide']")).toEqual(["subscribe-plans-dismiss"]);
		assert(dismiss, "the panel must carry its Cancel control");
		expect(dismiss.textContent).toBe("Cancel");
		expect(dismiss.getAttribute("class")).toBe("btn btn--neutral");
		expect(dismiss.getAttribute("type")).toBe("button");
		expect(dismiss.getAttribute("popovertarget")).toBe(SUBSCRIBE_PLANS_POPOVER_ID);
	});

	it("names the plan group by the dialog title", () => {
		const doc = panelFor();
		const title = doc.querySelector(".confirm-popover__title");
		const group = doc.querySelector("fieldset");

		assert(title, "the panel must render its title");
		assert(group, "the plans must be one group");
		expect(title.textContent).toBe("Choose your plan");
		expect(group.getAttribute("aria-labelledby")).toBe(title.getAttribute("id"));
	});

	it("hands the shell one actions element that carries the whole plan form", () => {
		const doc = panelFor();
		const popover = doc.querySelector("[data-test-confirm-popover='subscribe-plans']");

		assert(popover, "the subscribe panel must be rendered");
		expect(popover.getAttribute("id")).toBe(SUBSCRIBE_PLANS_POPOVER_ID);
		expect(popover.getAttribute("popover")).toBe("auto");
		const actions = [...popover.querySelectorAll(".confirm-popover__actions")];
		expect(actions.map((element) => element.tagName)).toEqual(["FORM"]);
		expect(actions.map((element) => element.getAttribute("data-test-form"))).toEqual(["subscribe-plans"]);
		expect(planKeys(planForm(doc))).toEqual(ROW_ORDER);
	});
});

describe("renderSubscribePlansForm", () => {
	it("renders one plan form a page can show inline, named by the page's heading, with no dismiss", () => {
		const doc = formFor({ source: "plans-page" });
		const wrapper = doc.querySelector("div");
		assert(wrapper, "the test wraps the form in a <div>");
		const [only, ...rest] = [...wrapper.children];
		const group = doc.querySelector("fieldset");

		assert(only, "the form renders a root element");
		assert(group, "the plans must be one group");
		expect(rest).toEqual([]);
		expect(only).toBe(planForm(doc));
		expect(group.getAttribute("aria-labelledby")).toBe("plans-heading");
		expect(testActions(only, "[data-test-action]")).toEqual(["subscribe-plans-submit"]);
	});

	it("offers the rows the popover hands the shell, so both surfaces offer identical plans", () => {
		const inline = [
			...formFor({ source: "account", checkedPlan: "monthly" }).querySelectorAll("[data-test-plan]"),
		].map((plan) => plan.outerHTML);
		const inPopover = [
			...panelFor({ source: "account", checkedPlan: "monthly" }).querySelectorAll("[data-test-plan]"),
		].map((plan) => plan.outerHTML);

		expect(inline).toEqual(inPopover);
		expect(inline).toHaveLength(ROW_ORDER.length);
	});

	it.each(SUBSCRIBE_PLANS_SOURCES)("attributes the choice to the %s surface the plans were chosen on", (source) => {
		expect(planForm(formFor({ source })).getAttribute("action")).toBe(
			`/account/subscribe?utm_source=${source}&utm_medium=internal&utm_content=choose-plan`,
		);
	});
});

describe("planChargedWithoutChoice", () => {
	const trialing: EffectiveAccess = {
		tier: "trial",
		access: "full",
		banner: "trial-countdown",
		trialEndsAt: "2026-10-20T00:00:00.000Z",
	};
	const trialExpired: EffectiveAccess = {
		tier: "inactive",
		access: "read-only",
		banner: "inactive",
		reason: "trial-expired",
	};
	const returningFromMonthly: EffectiveAccess = {
		tier: "inactive",
		access: "read-only",
		banner: "inactive",
		reason: "subscription-cancelled",
		plan: "monthly",
	};
	const returningWithNoPlanOnRecord: EffectiveAccess = {
		tier: "inactive",
		access: "read-only",
		banner: "inactive",
		reason: "subscription-cancelled",
		plan: undefined,
	};

	it.each([
		["a reader in their trial the default plan", trialing, DEFAULT_BILLING_PLAN],
		["a reader whose trial ran out the default plan", trialExpired, DEFAULT_BILLING_PLAN],
		["a returning reader the plan their cancelled subscription carried", returningFromMonthly, "monthly"],
		[
			"a returning reader with no plan on record the default plan",
			returningWithNoPlanOnRecord,
			DEFAULT_BILLING_PLAN,
		],
	])("charges %s, as the subscribe route does when the form names none", (_reader, access, plan) => {
		expect(planChargedWithoutChoice(access)).toBe(plan);
	});
});
