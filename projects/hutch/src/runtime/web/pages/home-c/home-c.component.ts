import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@packages/web-shell";
import type { PageBody } from "@packages/web-shell";

import { SAVES_STAY_STATEMENT } from "../../price-statement";
import type { SaveTip } from "../../shared/save-tip/save-tip.component";
import { buildHomePageFrame, buildHomeView, trackedLink } from "../home/home-view.component";

import { HOME_C_CONTENT } from "./home-c.content";
import { HOME_C_STYLES } from "./home-c.styles";

const HOME_C_TEMPLATE = readFileSync(join(__dirname, "home-c.template.html"), "utf-8");

const { hero, capabilities } = HOME_C_CONTENT;

export function HomeVariantCPage(params: {
	staticBaseUrl: string;
	saveTip: SaveTip;
	lastViewUrl: string | undefined;
}): PageBody {
	return {
		...buildHomePageFrame({ staticBaseUrl: params.staticBaseUrl, styles: HOME_C_STYLES }),
		content: {
			html: render(HOME_C_TEMPLATE, {
				...buildHomeView({ ...params, hero }),
				heroSavesStay: SAVES_STAY_STATEMENT,
				capabilitiesAriaLabel: capabilities.ariaLabel,
				capabilitiesTitle: capabilities.title,
				capabilities: capabilities.items.map((item) => ({
					key: item.key,
					name: item.name,
					body: item.body,
					link:
						item.link === undefined
							? undefined
							: trackedLink({ ...item.link, source: "home-capabilities" }),
				})),
			}),
		},
	};
}
