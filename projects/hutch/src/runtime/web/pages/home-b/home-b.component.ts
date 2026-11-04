import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@packages/web-shell";
import type { PageBody } from "@packages/web-shell";

import type { SaveTip } from "../../shared/save-tip/save-tip.component";
import { HOME_CONTENT } from "../home/home.content";
import { buildHomePageFrame, buildHomeView } from "../home/home-view.component";

import { renderHomeCompareSection } from "./home-b-compare.component";
import { HOME_B_COMPARE_STYLES } from "./home-b-compare.styles";

const HOME_B_TEMPLATE = readFileSync(join(__dirname, "home-b.template.html"), "utf-8");

export function HomeVariantBPage(params: {
	staticBaseUrl: string;
	saveTip: SaveTip;
	lastViewUrl: string | undefined;
}): PageBody {
	return {
		...buildHomePageFrame({ staticBaseUrl: params.staticBaseUrl, styles: HOME_B_COMPARE_STYLES }),
		content: {
			html: render(HOME_B_TEMPLATE, {
				...buildHomeView({ ...params, hero: HOME_CONTENT.hero }),
				compareSection: renderHomeCompareSection(),
			}),
		},
	};
}
