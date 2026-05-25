/* c8 ignore start -- thin SDK wrapper, only used in prod path */
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import { SaveLinkRawPdfCommand } from "@packages/hutch-infra-components";
import type { PublishSaveLinkRawPdfCommand } from "@packages/test-fixtures/providers/events";

export function initEventBridgeSaveLinkRawPdfCommand(deps: {
	publishEvent: PublishEvent;
}): { publishSaveLinkRawPdfCommand: PublishSaveLinkRawPdfCommand } {
	const { publishEvent } = deps;

	const publishSaveLinkRawPdfCommand: PublishSaveLinkRawPdfCommand = async (params) => {
		await publishEvent({
			source: SaveLinkRawPdfCommand.source,
			detailType: SaveLinkRawPdfCommand.detailType,
			detail: JSON.stringify({
				url: params.url,
				userId: params.userId,
			}),
		});
	};

	return { publishSaveLinkRawPdfCommand };
}
/* c8 ignore stop */
