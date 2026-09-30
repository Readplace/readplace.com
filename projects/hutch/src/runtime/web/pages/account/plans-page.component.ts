import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@packages/web-shell";
import type { PageBody } from "@packages/web-shell";

import {
	SUBSCRIBE_PLANS_STYLES,
	renderSubscribePlansGrid,
} from "../../shared/subscribe-plans/subscribe-plans.component";
import { ACCOUNT_PLANS_URL } from "./account.url";
import { PLANS_PAGE_STYLES } from "./plans-page.styles";
import type { PlansPageViewModel } from "./plans-page.view-model";

const PLANS_PAGE_TEMPLATE = readFileSync(join(__dirname, "plans-page.template.html"), "utf-8");

const PLANS_PAGE_HEADING = "Choose a plan";

export function PlansPage(vm: PlansPageViewModel): PageBody {
	return {
		seo: {
			title: `${PLANS_PAGE_HEADING} — Readplace`,
			description: "Choose a Readplace plan.",
			canonicalUrl: ACCOUNT_PLANS_URL,
			robots: "noindex, nofollow",
		},
		styles: `${PLANS_PAGE_STYLES}\n${SUBSCRIBE_PLANS_STYLES}`,
		bodyClass: "page-plans",
		content: {
			html: render(PLANS_PAGE_TEMPLATE, {
				heading: PLANS_PAGE_HEADING,
				terms: vm.terms,
				termsNote: vm.termsNote,
				plansGridHtml: renderSubscribePlansGrid({ source: "plans-page" }),
			}),
		},
	};
}
