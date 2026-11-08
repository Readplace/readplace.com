import assert from "node:assert";
import type { HeadMediaPendingOriginal, ReadMediaPendingPrefix, ReadTimedDuration } from "@packages/domain";
import { timedFactsOfMetadata } from "./timed-facts-of-metadata";

export function initReadPendingTimedDuration(deps: {
	headMediaPendingOriginal: HeadMediaPendingOriginal;
	readMediaPendingPrefix: ReadMediaPendingPrefix;
	parseTimedMetadata: (bytes: Uint8Array) => Parameters<typeof timedFactsOfMetadata>[0];
}): ReadTimedDuration {
	return async ({ uploadId, etag }) => {
		const head = await deps.headMediaPendingOriginal({ uploadId });
		assert(head, `no pending original ${uploadId}`);
		const bytes = await deps.readMediaPendingPrefix({ uploadId, etag, bytes: head.size });
		return timedFactsOfMetadata(deps.parseTimedMetadata(bytes), { truncated: () => false });
	};
}
