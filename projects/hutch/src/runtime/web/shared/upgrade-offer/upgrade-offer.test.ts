import { parseHTML } from "linkedom";
import type { EffectiveAccess } from "@packages/subscription-access";
import type { Request } from "express";
import { NATIVE_CLIENT_HEADER } from "../../onboarding/native-client";
import { type UpgradeOffer, lockFor, renderedLockFor, standingOf, upgradeOfferFor } from "./upgrade-offer";

const FOUNDING: EffectiveAccess = { tier: "founding", access: "full", banner: "none" };
const PAID: EffectiveAccess = { tier: "paid", access: "full", banner: "none" };
const PAID_ENDING: EffectiveAccess = {
	tier: "paid",
	access: "full",
	banner: "cancellation-scheduled",
	cancellationEffectiveAt: "2026-01-06T00:00:00.000Z",
};
const TRIAL: EffectiveAccess = {
	tier: "trial",
	access: "full",
	banner: "trial-countdown",
	trialEndsAt: "2026-01-04T00:00:00.000Z",
};
const TRIAL_EXPIRED: EffectiveAccess = {
	tier: "inactive",
	access: "read-only",
	banner: "inactive",
	reason: "trial-expired",
};
const CANCELLED_TRIENNIAL: EffectiveAccess = {
	tier: "inactive",
	access: "read-only",
	banner: "inactive",
	reason: "subscription-cancelled",
	plan: "triennial",
};

function browserRequest(input: { query?: Record<string, string>; client?: string }): Pick<Request, "query" | "get"> {
	return {
		query: input.query ?? {},
		get: ((name: string) => (name === NATIVE_CLIENT_HEADER ? input.client : undefined)) as Request["get"],
	};
}

const WEB = browserRequest({});
const NATIVE_SURFACES = [
	{ surface: "?platform=ios", req: browserRequest({ query: { platform: "ios" } }) },
	{ surface: "?platform=android", req: browserRequest({ query: { platform: "android" } }) },
	{ surface: "?shell=app", req: browserRequest({ query: { shell: "app" } }) },
	{ surface: "the ios client header", req: browserRequest({ client: "ios" }) },
];

const OFFER: UpgradeOffer = {
	popoverId: "subscribe-plans",
	plansPath: "/account/plans",
	checkedPlan: "yearly",
};

describe("upgradeOfferFor", () => {
	it.each([
		{ tier: "trial", access: TRIAL, checkedPlan: "yearly" },
		{ tier: "inactive after a trial", access: TRIAL_EXPIRED, checkedPlan: "yearly" },
		{ tier: "inactive after a cancelled subscription", access: CANCELLED_TRIENNIAL, checkedPlan: "triennial" },
	])("offers an upgrade on the web to a reader on $tier, starting on the plan they would be charged", ({ access, checkedPlan }) => {
		expect(upgradeOfferFor({ req: WEB, access })).toEqual({
			popoverId: "subscribe-plans",
			plansPath: "/account/plans",
			checkedPlan,
		});
	});

	it.each([
		{ tier: "founding", access: FOUNDING },
		{ tier: "paid", access: PAID },
		{ tier: "paid with a cancellation scheduled", access: PAID_ENDING },
	])("offers nothing on the web to a reader on $tier, who has nothing to upgrade to", ({ access }) => {
		expect(upgradeOfferFor({ req: WEB, access })).toBeUndefined();
	});

	describe.each(NATIVE_SURFACES)("on the native surface marked by $surface", ({ req }) => {
		it.each([
			{ tier: "founding", access: FOUNDING },
			{ tier: "paid", access: PAID },
			{ tier: "trial", access: TRIAL },
			{ tier: "inactive", access: TRIAL_EXPIRED },
		])("offers nothing to a reader on $tier", ({ access }) => {
			expect(upgradeOfferFor({ req, access })).toBeUndefined();
		});
	});

	it("reads an unknown platform marker as the web, so an offer still shows", () => {
		const req = browserRequest({ query: { platform: "windows" } });

		expect(upgradeOfferFor({ req, access: TRIAL })).toBeDefined();
	});
});

describe("standingOf", () => {
	it.each([
		{ gated: false, offer: OFFER, standing: "open" },
		{ gated: false, offer: undefined, standing: "open" },
		{ gated: true, offer: OFFER, standing: "needs-upgrade" },
		{ gated: true, offer: undefined, standing: "withheld" },
	])("gated=$gated with offer=$offer stands $standing", ({ gated, offer, standing }) => {
		expect(standingOf({ gated, offer })).toBe(standing);
	});
});

describe("lockFor", () => {
	const CONTROL = { key: "add-link", label: "Add link", controlClass: "btn btn--neutral btn--s", source: "queue-add-link" };

	it("builds a lock that opens the offer's popover and falls back to a tracked plans link", () => {
		expect(lockFor({ ...CONTROL, offer: OFFER, gated: true })).toEqual({
			key: "add-link",
			label: "Add link",
			controlClass: "btn btn--neutral btn--s",
			popoverId: "subscribe-plans",
			fallbackHref: "/account/plans?utm_source=queue-add-link&utm_medium=internal&utm_content=upgrade-add-link",
		});
	});

	it("builds no lock for a control the reader may use", () => {
		expect(lockFor({ ...CONTROL, offer: OFFER, gated: false })).toBeUndefined();
	});

	it("builds no lock where no offer may be shown", () => {
		expect(lockFor({ ...CONTROL, offer: undefined, gated: true })).toBeUndefined();
	});
});

describe("renderedLockFor", () => {
	const CONTROL = { key: "import", label: "Import links", controlClass: "btn", source: "account" };
	const OFFERED: UpgradeOffer = { popoverId: "subscribe-plans", plansPath: "/account/plans", checkedPlan: "monthly" };

	it("renders the trigger and fallback pair of a gated control that can be upgraded", () => {
		const [html, ...rest] = renderedLockFor({ ...CONTROL, offer: OFFERED, gated: true });
		const { document } = parseHTML(`<div>${html}</div>`);

		expect(rest).toEqual([]);
		expect(document.querySelector('[data-test-action="upgrade-open"]')?.getAttribute("popovertarget")).toBe("subscribe-plans");
		expect(document.querySelector('[data-test-action="upgrade-fallback"]')?.getAttribute("href")).toBe(
			"/account/plans?utm_source=account&utm_medium=internal&utm_content=upgrade-import",
		);
	});

	it.each([
		["an open control", { offer: OFFERED, gated: false }],
		["a gated control with no offer", { offer: undefined, gated: true }],
	])("renders nothing for %s", (_case, standing) => {
		expect(renderedLockFor({ ...CONTROL, ...standing })).toEqual([]);
	});
});
