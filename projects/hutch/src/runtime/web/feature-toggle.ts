import type { Request } from "express";

export class QuerystringFeatureToggle {
	isEnabled(req: Request, feature: string): boolean {
		return req.query.feature === feature;
	}
}
