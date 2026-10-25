import assert from "node:assert";
import { GetParameterCommand } from "@aws-sdk/client-ssm";
import type { ReadExcludedIdentities } from "@packages/provider-contracts/logs-insights";
import type { ExcludedIdentities } from "../../observability/excluded-identities";

export type GetSsmParameter = (command: GetParameterCommand) => Promise<{ Parameter?: { Value?: string } }>;

export function initSsmExcludedIdentities(deps: {
	getParameter: GetSsmParameter;
	parameterName: string;
	parseExcludedIdentities: (json: string) => ExcludedIdentities;
}): ReadExcludedIdentities {
	return async () => {
		const response = await deps.getParameter(new GetParameterCommand({ Name: deps.parameterName }));
		const value = response.Parameter?.Value;
		assert(value, `SSM parameter ${deps.parameterName} must hold a value`);
		return deps.parseExcludedIdentities(value);
	};
}
