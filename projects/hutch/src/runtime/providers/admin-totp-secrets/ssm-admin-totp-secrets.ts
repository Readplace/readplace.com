import assert from "node:assert";
import { GetParameterCommand } from "@aws-sdk/client-ssm";
import type { ReadAdminTotpSecrets } from "../../web/pages/admin/admin-totp-secrets";
import type { GetSsmParameter } from "../excluded-identities/ssm-excluded-identities";

export function initSsmAdminTotpSecrets(deps: {
	getParameter: GetSsmParameter;
	parameterName: string;
	parseAdminTotpSecretsParameter: (value: string) => ReadonlyMap<string, Buffer>;
}): ReadAdminTotpSecrets {
	return async () => {
		const response = await deps.getParameter(
			new GetParameterCommand({ Name: deps.parameterName, WithDecryption: true }),
		);
		const value = response.Parameter?.Value;
		assert(value, `SSM parameter ${deps.parameterName} must hold a value`);
		return deps.parseAdminTotpSecretsParameter(value);
	};
}
