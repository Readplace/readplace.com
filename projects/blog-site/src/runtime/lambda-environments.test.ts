import assert from "node:assert/strict";
import { BLOG_SITE_ENV } from "./lambda.env";

const tuples = {
	BLOG_SITE_ENV,
};

describe("Lambda environment tuples", () => {
	for (const [name, names] of Object.entries(tuples)) {
		it(`${name} names each variable once`, () => {
			assert.equal(new Set(names).size, names.length);
		});
	}
});
