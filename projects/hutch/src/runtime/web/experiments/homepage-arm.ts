import type { Request } from "express";

import { readHomepageAssignment } from "./homepage-assignment";
import {
	assignVariant,
	type HomepageSplitConfig,
	type HomepageSplitVariant,
} from "./homepage-split";

export interface HomepageArm {
	readonly variant: HomepageSplitVariant;
	/** Whether this render counts as an experiment exposure — the caller stamps
	 * the assignment cookie and tags the pageview only when it does. False keeps
	 * a request out of the measurement entirely rather than silently folding it
	 * into the control's numbers. */
	readonly participating: boolean;
}

/**
 * Picks the arm to render, server-side, so the visitor's first paint is already
 * their arm — the client-side bucket-then-redirect this replaced showed the
 * incumbent homepage first and swapped it a full page load later.
 *
 * A recorded assignment wins over a fresh draw, so the arm survives across
 * visits; `readHomepageAssignment` already discards one from another campaign or
 * a bumped epoch, which reads here as "not yet assigned".
 */
export function resolveHomepageArm(input: {
	req: Request;
	config: HomepageSplitConfig;
	eligible: boolean;
	drawRandomByte: () => number;
}): HomepageArm {
	const { req, config, eligible, drawRandomByte } = input;
	if (!config.active || !eligible) {
		return { variant: config.variants[0], participating: false };
	}
	const recorded = readHomepageAssignment(req, config);
	return {
		variant: recorded ?? assignVariant(config, drawRandomByte()),
		participating: true,
	};
}
