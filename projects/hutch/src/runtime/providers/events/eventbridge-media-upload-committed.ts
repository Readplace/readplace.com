/* c8 ignore start -- thin SDK wrapper, only used in prod path */
import type { PublishMediaUploadCommitted } from "@packages/domain";
import { MediaUploadCommittedEvent } from "@packages/infra-components";
import type { PublishEvent } from "@packages/infra-components/runtime";

export function initEventBridgeMediaUploadCommitted(deps: {
	publishEvent: PublishEvent;
}): { publishMediaUploadCommitted: PublishMediaUploadCommitted } {
	return {
		publishMediaUploadCommitted: (params) => deps.publishEvent(MediaUploadCommittedEvent, params),
	};
}
/* c8 ignore stop */
