import assert from "node:assert/strict";
import { formatEnvMap, parseEnvMap } from "./env-map";

describe("env map", () => {
	it("writes each entry as key=value, comma-separated", () => {
		assert.equal(formatEnvMap({ users: "hutch-users", login: "10/900" }), "users=hutch-users,login=10/900");
	});

	it("reads back what it wrote", () => {
		const entries = { users: "hutch-users", login: "10/900" };

		assert.deepEqual(parseEnvMap(formatEnvMap(entries)), entries);
	});
});
