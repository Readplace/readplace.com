import assert from "node:assert/strict";
import { ADMIN_DASHBOARDS_ENV } from "./lambda.env";

const tuples = {
	ADMIN_DASHBOARDS_ENV,
};

describe("Lambda environment tuples", () => {
	for (const [name, names] of Object.entries(tuples)) {
		it(`${name} names each variable once`, () => {
			assert.equal(new Set(names).size, names.length);
		});
	}
});
