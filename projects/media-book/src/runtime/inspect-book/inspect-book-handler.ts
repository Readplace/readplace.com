import type { Handler, SQSBatchResponse, SQSEvent } from "aws-lambda";
import { MediaUploadStagedEvent } from "@packages/infra-components";
import { initSqsRecordHandler } from "@packages/infra-components/runtime";
import type { Logger } from "@packages/logger";
import type { InspectBook } from "./inspect-book";

export function initInspectBookHandler(deps: { inspectBook: InspectBook; logger: Logger }): Handler<SQSEvent, SQSBatchResponse> {
	return initSqsRecordHandler({
		definition: MediaUploadStagedEvent,
		logger: deps.logger,
		failure: { message: "[inspect-book] record failed" },
		malformed: { policy: "retry" },
		handle: (detail) => deps.inspectBook(detail),
	});
}
