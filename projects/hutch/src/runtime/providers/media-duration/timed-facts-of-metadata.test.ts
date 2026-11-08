import assert from "node:assert/strict";
import { timedFactsOfMetadata } from "./timed-facts-of-metadata";

function parseErrorNamed(name: string): Error {
	return Object.assign(new Error("Failed to determine audio format"), { name });
}

const untruncated = { truncated: () => false };
const cutOff = { truncated: () => true };

describe("timedFactsOfMetadata", () => {
	it("reads a parsed file's duration and its tracks", async () => {
		const metadata = Promise.resolve({ format: { duration: 61.5, hasAudio: true, hasVideo: true } });
		assert.deepEqual(await timedFactsOfMetadata(metadata, untruncated), { durationSeconds: 61.5, hasAudio: true, hasVideo: true });
	});

	it("treats a track the parser does not report as absent", async () => {
		const metadata = Promise.resolve({ format: { duration: 12 } });
		assert.deepEqual(await timedFactsOfMetadata(metadata, untruncated), { durationSeconds: 12, hasAudio: false, hasVideo: false });
	});

	it("calls a parsed file with no duration unreadable", async () => {
		const metadata = Promise.resolve({ format: { hasAudio: true, hasVideo: false } });
		assert.deepEqual(await timedFactsOfMetadata(metadata, untruncated), { unreadable: true });
	});

	it("reports the audio counted so far as a lower bound when the scan was cut off", async () => {
		const metadata = Promise.resolve({ format: { duration: 4800.5, hasAudio: true, hasVideo: false } });
		assert.deepEqual(await timedFactsOfMetadata(metadata, cutOff), { atLeastSeconds: 4800.5 });
	});

	it("calls a cut-off scan with no duration unreadable", async () => {
		const metadata = Promise.resolve({ format: { hasAudio: true, hasVideo: false } });
		assert.deepEqual(await timedFactsOfMetadata(metadata, cutOff), { unreadable: true });
	});

	it.each(["CouldNotDetermineFileTypeError", "UnsupportedFileTypeError"])(
		"calls a file the parser refuses with %s unreadable",
		async (name) => {
			assert.deepEqual(await timedFactsOfMetadata(Promise.reject(parseErrorNamed(name)), untruncated), { unreadable: true });
		},
	);

	it("passes on a failure that is not about the file's type", async () => {
		const outage = new Error("connection reset");
		await assert.rejects(timedFactsOfMetadata(Promise.reject(outage), untruncated), (error) => error === outage);
	});
});
