/** Structural request shape rather than express's Request, so the shell stays
 * framework-free and any deployable's handler can pass its request through. */
export type FeatureToggleSource = { query: Record<string, unknown> };

export class QuerystringFeatureToggle {
	isEnabled(req: FeatureToggleSource, feature: string): boolean {
		return req.query.feature === feature;
	}
}
