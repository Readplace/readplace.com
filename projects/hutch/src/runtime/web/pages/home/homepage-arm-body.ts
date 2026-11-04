import type { PageBody } from "@packages/web-shell";

import type { HomepageVariantMarker } from "../../experiments/homepage-split";
import type { SaveTip } from "../../shared/save-tip/save-tip.component";
import { HomeVariantBPage } from "../home-b";
import { HomeVariantCPage } from "../home-c";

export interface HomepageArmInput {
	readonly staticBaseUrl: string;
	readonly lastViewUrl: string | undefined;
	readonly saveTip: SaveTip;
	readonly variant: HomepageVariantMarker;
}

const ARM_RENDERERS = {
	b: (input: HomepageArmInput): PageBody => HomeVariantBPage(input),
	c: (input: HomepageArmInput): PageBody => HomeVariantCPage(input),
} satisfies Record<HomepageVariantMarker, (input: HomepageArmInput) => PageBody>;

export function buildHomepageArmBody(input: HomepageArmInput): PageBody {
	const body = ARM_RENDERERS[input.variant](input);
	return { ...body, bodyClass: `page-home variant-${input.variant}` };
}
