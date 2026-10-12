import type { Request } from "express";

import { readHomepageAssignment } from "./homepage-assignment";
import {
	assignVariant,
	type HomepageSplitConfig,
	type HomepageSplitVariant,
} from "./homepage-split";

export interface HomepageArm {
	readonly variant: HomepageSplitVariant;
	readonly participating: boolean;
}

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
