import type { PublishMediaUploadStaged } from "@packages/domain";
import { MediaUploadStagedEvent } from "@packages/infra-components";
import type { PublishEvent } from "@packages/infra-components/runtime";

export function initEventBridgeMediaUploadStaged(deps: {
	publishEvent: PublishEvent;
}): { publishMediaUploadStaged: PublishMediaUploadStaged } {
	return {
		publishMediaUploadStaged: (params) => deps.publishEvent(MediaUploadStagedEvent, params),
	};
}
