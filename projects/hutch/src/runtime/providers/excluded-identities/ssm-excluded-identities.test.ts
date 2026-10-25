import assert from "node:assert/strict";
import type { GetParameterCommand } from "@aws-sdk/client-ssm";
import { parseExcludedIdentities } from "../../observability/excluded-identities";
import { initSsmExcludedIdentities } from "./ssm-excluded-identities";

describe("initSsmExcludedIdentities", () => {
	it("reads the named parameter and returns what the injected parser made of its value", async () => {
		const requested: GetParameterCommand[] = [];
		const readExcludedIdentities = initSsmExcludedIdentities({
			getParameter: async (command) => {
				requested.push(command);
				return { Parameter: { Value: "{\"raw\":true}" } };
			},
			parameterName: "/readplace/excluded-identities",
			parseExcludedIdentities: (json) => {
				assert.equal(json, "{\"raw\":true}");
				return { excludedVisitorIds: ["293b32c4-898e-485d-8a92-3f2f32f53289"], excludedUserIds: [] };
			},
		});

		assert.deepEqual(await readExcludedIdentities(), {
			excludedVisitorIds: ["293b32c4-898e-485d-8a92-3f2f32f53289"],
			excludedUserIds: [],
		});
		assert.deepEqual(requested.map((command) => command.input), [{ Name: "/readplace/excluded-identities" }]);
	});

	it("fails the request when the parameter holds no value", async () => {
		const readExcludedIdentities = initSsmExcludedIdentities({
			getParameter: async () => ({ Parameter: {} }),
			parameterName: "/readplace/excluded-identities",
			parseExcludedIdentities,
		});

		await assert.rejects(readExcludedIdentities(), /SSM parameter \/readplace\/excluded-identities must hold a value/);
	});
});
