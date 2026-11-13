import assert from "node:assert/strict";
import type { GetParameterCommand } from "@aws-sdk/client-ssm";
import { parseAdminTotpSecretsParameter } from "../../web/pages/admin/admin-totp-secrets";
import { initSsmAdminTotpSecrets } from "./ssm-admin-totp-secrets";

describe("initSsmAdminTotpSecrets", () => {
	it("reads the named parameter decrypted and returns what the injected parser made of its value", async () => {
		const requested: GetParameterCommand[] = [];
		const parsedSecrets = new Map([["admin@example.com", Buffer.alloc(20, 1)]]);
		const readAdminTotpSecrets = initSsmAdminTotpSecrets({
			getParameter: async (command) => {
				requested.push(command);
				return { Parameter: { Value: "{\"entries\":\"stored\"}" } };
			},
			parameterName: "/readplace/admin-totp-secrets",
			parseAdminTotpSecretsParameter: (value) => {
				assert.equal(value, "{\"entries\":\"stored\"}");
				return parsedSecrets;
			},
		});

		assert.equal(await readAdminTotpSecrets(), parsedSecrets);
		assert.deepEqual(
			requested.map((command) => command.input),
			[{ Name: "/readplace/admin-totp-secrets", WithDecryption: true }],
		);
	});

	it("fails the request when the parameter holds no value", async () => {
		const readAdminTotpSecrets = initSsmAdminTotpSecrets({
			getParameter: async () => ({ Parameter: {} }),
			parameterName: "/readplace/admin-totp-secrets",
			parseAdminTotpSecretsParameter,
		});

		await assert.rejects(readAdminTotpSecrets(), /SSM parameter \/readplace\/admin-totp-secrets must hold a value/);
	});
});
