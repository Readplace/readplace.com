/* c8 ignore start -- thin SDK wrapper, only used in prod path */
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import { SaveLinkRawHtmlCommand } from "@packages/hutch-infra-components";
import type { PublishSaveLinkRawHtmlCommand } from "@packages/test-fixtures/providers/events";

export function initEventBridgeSaveLinkRawHtmlCommand(deps: {
	publishEvent: PublishEvent;
}): { publishSaveLinkRawHtmlCommand: PublishSaveLinkRawHtmlCommand } {
	return {
		publishSaveLinkRawHtmlCommand: (params) =>
			deps.publishEvent(SaveLinkRawHtmlCommand, params),
	};
}
/* c8 ignore stop */
