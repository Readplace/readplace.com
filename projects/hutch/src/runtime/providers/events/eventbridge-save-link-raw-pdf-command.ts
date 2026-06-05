/* c8 ignore start -- thin SDK wrapper, only used in prod path */
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import { SaveLinkRawPdfCommand } from "@packages/hutch-infra-components";
import type { PublishSaveLinkRawPdfCommand } from "@packages/test-fixtures/providers/events";

export function initEventBridgeSaveLinkRawPdfCommand(deps: {
	publishEvent: PublishEvent;
}): { publishSaveLinkRawPdfCommand: PublishSaveLinkRawPdfCommand } {
	return {
		publishSaveLinkRawPdfCommand: (params) =>
			deps.publishEvent(SaveLinkRawPdfCommand, params),
	};
}
/* c8 ignore stop */
