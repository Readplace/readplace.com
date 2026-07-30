import type { CapturedContent } from "../capture-active-tab-bytes";
import type { UploadJob } from "./upload-job";

/** `read` hands back the raw stored value rather than jobs so the engine can
 * validate it and drop records a previous build wrote in another shape. */
export interface UploadJobStore {
	read: () => Promise<unknown>;
	write: (jobs: UploadJob[]) => Promise<void>;
}

/** Blobs, not base64: a persisted payload must not pay the ~33% inflation an
 * encoded round-trip costs against the storage budget. */
export interface PayloadStore {
	put: (params: { id: string; blob: Blob }) => Promise<void>;
	get: (id: string) => Promise<Blob | undefined>;
	remove: (id: string) => Promise<void>;
	clear: () => Promise<void>;
}

export interface WakeScheduler {
	now: () => number;
	wakeAt: (timestamp: number) => Promise<void>;
	cancel: () => Promise<void>;
}

/** MUST refuse a tab whose URL has moved on from `url`: the bytes are keyed to
 * the byte-identical URL the link save already used, so capturing a navigated
 * tab would enrich the wrong article. */
export type CaptureForJob = (target: {
	url: string;
	tabId?: number;
}) => Promise<CapturedContent | undefined>;

export interface UploadQueue {
	enqueue: (target: { url: string; title?: string; tabId?: number }) => Promise<void>;
	resume: () => Promise<void>;
	purge: () => Promise<void>;
}
