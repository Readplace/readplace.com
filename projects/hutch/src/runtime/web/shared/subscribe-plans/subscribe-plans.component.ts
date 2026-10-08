import {
	type BillingPlan,
	DEFAULT_BILLING_PLAN,
} from "@packages/provider-contracts/subscription-providers";
import type { EffectiveAccess } from "@packages/subscription-access";
import {
	PRICING_PANELS,
	type PricingPanel,
	render,
	renderConfirmPopover,
	withInternalTracking,
} from "@packages/web-shell";

import { ACCOUNT_SUBSCRIBE_URL } from "../../pages/account/account.url";

export { SUBSCRIBE_PLANS_STYLES } from "./subscribe-plans.styles";

export const SUBSCRIBE_PLANS_POPOVER_ID = "subscribe-plans";

export const SUBSCRIBE_PLANS_SOURCES = ["queue-banner", "account", "plans-page"] as const;

export type SubscribePlansSource = (typeof SUBSCRIBE_PLANS_SOURCES)[number];

interface SubscribePlanRow {
	key: BillingPlan;
	name: string;
	monthlyDisplay: string;
	billedLine: string;
	planClass: string;
	badges: readonly { label: string }[];
}

const SUBSCRIBE_PLANS_FORM_TEMPLATE = `<form class="confirm-popover__actions subscribe-plans__form" method="POST" action="{{action}}" hx-boost="true" hx-target="main" hx-select="main" hx-swap="outerHTML show:none" data-test-form="subscribe-plans">
	<fieldset class="subscribe-plans__plans" aria-labelledby="{{labelledBy}}">
		{{#each plans}}
		<label class="{{planClass}}" data-test-plan="{{key}}">
			{{#each badges}}
			<span class="chip chip--tab subscribe-plans__badge" data-test-plan-badge>{{label}}</span>
			{{/each}}
			<span class="subscribe-plans__row">
				<input class="form-choice" type="radio" name="plan" value="{{key}}"{{#if checked}} checked{{/if}}>
				<span class="subscribe-plans__text">
					<span class="subscribe-plans__name">{{name}}</span>
					<span class="subscribe-plans__billed">{{billedLine}}</span>
				</span>
				<span class="subscribe-plans__price">{{monthlyDisplay}}<span class="subscribe-plans__cadence">/month</span></span>
			</span>
		</label>
		{{/each}}
	</fieldset>
	<div class="confirm-popover__buttons subscribe-plans__buttons">
		{{#each dismissControls}}
		<button class="btn btn--neutral" type="button" popovertarget="{{popoverId}}" popovertargetaction="hide" data-test-action="subscribe-plans-dismiss">Cancel</button>
		{{/each}}
		<button class="btn btn--primary" type="submit" data-test-action="subscribe-plans-submit">Subscribe now</button>
	</div>
</form>`;

function toSubscribePlanRow(panel: PricingPanel): SubscribePlanRow {
	return {
		key: panel.key,
		name: panel.name,
		monthlyDisplay: panel.monthlyDisplay,
		billedLine: panel.billedLine,
		planClass: panel.featured
			? "subscribe-plans__plan subscribe-plans__plan--featured"
			: "subscribe-plans__plan",
		badges: panel.badge === undefined ? [] : [{ label: panel.badge }],
	};
}

const SUBSCRIBE_PLAN_ROWS: readonly SubscribePlanRow[] = [
	...PRICING_PANELS.filter((panel) => panel.featured),
	...PRICING_PANELS.filter((panel) => !panel.featured),
].map(toSubscribePlanRow);

export function planChargedWithoutChoice(access: EffectiveAccess): BillingPlan {
	if (access.banner !== "inactive" || access.reason !== "subscription-cancelled") return DEFAULT_BILLING_PLAN;
	return access.plan ?? DEFAULT_BILLING_PLAN;
}

export function renderSubscribePlansForm(input: {
	source: SubscribePlansSource;
	labelledBy: string;
	dismissControls: readonly { popoverId: string }[];
	checkedPlan: BillingPlan;
}): string {
	return render(SUBSCRIBE_PLANS_FORM_TEMPLATE, {
		action: withInternalTracking(ACCOUNT_SUBSCRIBE_URL, {
			source: input.source,
			content: "choose-plan",
		}),
		labelledBy: input.labelledBy,
		dismissControls: input.dismissControls,
		plans: SUBSCRIBE_PLAN_ROWS.map((row) => ({ ...row, checked: row.key === input.checkedPlan })),
	});
}

export function renderSubscribePlansPopover({
	source,
	checkedPlan,
}: {
	source: SubscribePlansSource;
	checkedPlan: BillingPlan;
}): string {
	return renderConfirmPopover({
		id: SUBSCRIBE_PLANS_POPOVER_ID,
		key: "subscribe-plans",
		title: "Choose your plan",
		body: "Get full access to Readplace. Cancel anytime, and everything you've already saved stays readable.",
		actionsHtml: renderSubscribePlansForm({
			source,
			labelledBy: `${SUBSCRIBE_PLANS_POPOVER_ID}-title`,
			dismissControls: [{ popoverId: SUBSCRIBE_PLANS_POPOVER_ID }],
			checkedPlan,
		}),
	});
}
