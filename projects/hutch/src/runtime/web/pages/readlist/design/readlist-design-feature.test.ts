import { ReadlistSlugSchema } from "@packages/domain/readlist";
import {
	designFeatureParams,
	designFeatureParamsFrom,
	readlistDesignEnabled,
	readlistDesignReturnQuery,
	withDesignFeature,
} from "./readlist-design-feature";

describe("readlist design feature toggle", () => {
	it("is on for ?feature=design, and unconditionally on when the environment defaults to it", () => {
		expect(readlistDesignEnabled({ feature: "design" }, false)).toBe(true);
		expect(readlistDesignEnabled({ feature: "pref" }, false)).toBe(false);
		expect(readlistDesignEnabled({}, false)).toBe(false);
		expect(readlistDesignEnabled({}, true)).toBe(true);
		expect(readlistDesignEnabled({ feature: "pref" }, true)).toBe(true);
	});

	it("yields the link param only while enabled", () => {
		expect(designFeatureParams(true)).toEqual([["feature", "design"]]);
		expect(designFeatureParams(false)).toEqual([]);
		expect(designFeatureParamsFrom({ feature: "design" }, false)).toEqual([["feature", "design"]]);
		expect(designFeatureParamsFrom({ feature: "other" }, false)).toEqual([]);
		expect(designFeatureParamsFrom({ feature: "other" }, true)).toEqual([["feature", "design"]]);
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
