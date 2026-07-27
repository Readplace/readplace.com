import type { PageBody } from "@packages/web-shell";

import type { HomepageVariantMarker } from "../../experiments/homepage-split";
import type { InstallBrowser } from "../../onboarding/onboarding.types";
import type { FoundingAllocation } from "../../shared/founding-progress/founding-allocation";
import { HomeVariantBPage } from "../home-b";
import { HomePage } from "./home.component";

export interface HomepageArmInput {
	readonly userCount: number;
	readonly staticBaseUrl: string;
	readonly browser: InstallBrowser;
	readonly foundingAllocation: FoundingAllocation;
	readonly lastViewUrl: string | undefined;
	readonly variant: HomepageVariantMarker;
}

/**
 * Which page each arm renders. `satisfies Record<HomepageVariantMarker, …>` makes
 * a third arm a compile error until it earns a renderer, and keeps the two arms
 * free to render entirely different components — the whole point of the split.
 * Arm A is the incumbent homepage; arm B is the trial-first rewrite, which reads
 * the last-view cookie so a reader-view arrival gets the arrival treatment.
 */
const ARM_RENDERERS = {
	a: (input: HomepageArmInput): PageBody =>
		HomePage({
			userCount: input.userCount,
			staticBaseUrl: input.staticBaseUrl,
			browser: input.browser,
			foundingAllocation: input.foundingAllocation,
			variant: input.variant,
		}),
	b: (input: HomepageArmInput): PageBody =>
		HomeVariantBPage({
			staticBaseUrl: input.staticBaseUrl,
			variant: input.variant,
			lastViewUrl: input.lastViewUrl,
		}),
} satisfies Record<HomepageVariantMarker, (input: HomepageArmInput) => PageBody>;

export function buildHomepageArmBody(input: HomepageArmInput): PageBody {
	return ARM_RENDERERS[input.variant](input);
}
