import type { BillingPlan } from "@packages/provider-contracts/subscription-providers";
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

export type SubscribePlansSource = "queue-banner" | "account";

interface SubscribePlanPanel {
	key: BillingPlan;
	name: string;
	monthlyDisplay: string;
	billedNote: string;
	panelClass: string;
	badges: readonly { label: string }[];
	action: string;
	buttonClass: string;
	buttonLabel: string;
	testAction: string;
}

const SUBSCRIBE_PLANS_ACTIONS_TEMPLATE = `<div class="confirm-popover__actions subscribe-plans__grid">
	{{#each panels}}
	<div class="{{panelClass}}" data-test-plan="{{key}}">
		{{#each badges}}
		<span class="subscribe-plans__badge" data-test-plan-badge>{{label}}</span>
		{{/each}}
		<h3 class="subscribe-plans__name">{{name}}</h3>
		<p class="subscribe-plans__price">{{monthlyDisplay}}<span class="subscribe-plans__cadence">/month</span></p>
		<p class="subscribe-plans__billed">{{billedNote}}</p>
		<form class="subscribe-plans__form" method="POST" action="{{action}}" hx-boost="true" hx-target="main" hx-select="main" hx-swap="outerHTML show:none">
			<input type="hidden" name="plan" value="{{key}}">
			<button class="{{buttonClass}}" type="submit" data-test-action="{{testAction}}">{{buttonLabel}}</button>
		</form>
	</div>
	{{/each}}
</div>`;

function toSubscribePlanPanel(input: {
	panel: PricingPanel;
	source: SubscribePlansSource;
}): SubscribePlanPanel {
	const { panel } = input;
	return {
		key: panel.key,
		name: panel.name,
		monthlyDisplay: panel.monthlyDisplay,
		billedNote: panel.billedNote,
		panelClass: panel.featured
			? "subscribe-plans__panel subscribe-plans__panel--featured"
			: "subscribe-plans__panel",
		badges: panel.badge === undefined ? [] : [{ label: panel.badge }],
		action: withInternalTracking(ACCOUNT_SUBSCRIBE_URL, {
			source: input.source,
			content: `plan-${panel.key}`,
		}),
		buttonClass: panel.featured
			? "btn btn--primary subscribe-plans__choose"
			: "btn btn--secondary subscribe-plans__choose",
		buttonLabel: `Choose ${panel.name}`,
		testAction: `subscribe-plan-${panel.key}`,
	};
}

export function renderSubscribePlansPopover({
	source,
}: {
	source: SubscribePlansSource;
}): string {
	return renderConfirmPopover({
		id: SUBSCRIBE_PLANS_POPOVER_ID,
		key: "subscribe-plans",
		title: "How would you like to pay?",
		body: "Every plan is the whole of Readplace. Cancel any time, and everything you have already saved stays readable.",
		wide: true,
		actionsHtml: render(SUBSCRIBE_PLANS_ACTIONS_TEMPLATE, {
			panels: PRICING_PANELS.map((panel) => toSubscribePlanPanel({ panel, source })),
		}),
	});
}
