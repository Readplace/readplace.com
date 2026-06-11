/* c8 ignore start -- thin SDK wrapper, only used in prod path */
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import { ExportUserDataCommand } from "@packages/hutch-infra-components";
import type { PublishExportUserDataCommand } from "@packages/provider-contracts/events";

export function initEventBridgeExportUserDataCommand(deps: {
	publishEvent: PublishEvent;
}): { publishExportUserDataCommand: PublishExportUserDataCommand } {
	return {
		publishExportUserDataCommand: (params) =>
			deps.publishEvent(ExportUserDataCommand, params),
	};
}
/* c8 ignore stop */
