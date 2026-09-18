import { ReadlistSlugSchema } from "@packages/domain/readlist";
import {
	designFeatureParams,
	designFeatureParamsFrom,
	readlistDesignEnabled,
	readlistDesignReturnQuery,
	withDesignFeature,
} from "./readlist-design-feature";

describe("readlist design feature toggle", () => {
	it("is on only for ?feature=design", () => {
		expect(readlistDesignEnabled({ feature: "design" })).toBe(true);
		expect(readlistDesignEnabled({ feature: "pref" })).toBe(false);
		expect(readlistDesignEnabled({})).toBe(false);
	});

	it("yields the link param only while enabled", () => {
		expect(designFeatureParams(true)).toEqual([["feature", "design"]]);
		expect(designFeatureParams(false)).toEqual([]);
		expect(designFeatureParamsFrom({ feature: "design" })).toEqual([["feature", "design"]]);
		expect(designFeatureParamsFrom({ feature: "other" })).toEqual([]);
	});

	it("stamps the flag onto a bare path, an existing query, and keeps a fragment", () => {
		expect(withDesignFeature("/queue")).toBe("/queue?feature=design");
		expect(withDesignFeature("/queue?tab=done&page=2")).toBe("/queue?tab=done&page=2&feature=design");
		expect(withDesignFeature("/queue/abc/status?swap=card#latest-saved")).toBe(
			"/queue/abc/status?swap=card&feature=design#latest-saved",
		);
	});

	it("does not double the flag on a link that already carries it", () => {
		expect(withDesignFeature("/queue?feature=design")).toBe("/queue?feature=design");
	});

	it("builds a return query that carries the readlist state and the flag", () => {
		expect(readlistDesignReturnQuery({})).toBe("?feature=design");
		expect(
			readlistDesignReturnQuery({ readlist: ReadlistSlugSchema.parse("ideas"), tab: "done", page: 3 }),
		).toBe("?queue=ideas&tab=done&page=3&feature=design");
	});
});
