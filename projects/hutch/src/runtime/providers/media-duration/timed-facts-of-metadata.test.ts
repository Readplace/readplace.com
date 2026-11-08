import assert from "node:assert/strict";
import { timedFactsOfMetadata } from "./timed-facts-of-metadata";

function parseErrorNamed(name: string): Error {
	return Object.assign(new Error("Failed to determine audio format"), { name });
}

describe("timedFactsOfMetadata", () => {
	it("reads a parsed file's duration and its tracks", async () => {
		const metadata = Promise.resolve({ format: { duration: 61.5, hasAudio: true, hasVideo: true } });
		assert.deepEqual(await timedFactsOfMetadata(metadata), { durationSeconds: 61.5, hasAudio: true, hasVideo: true });
	});

	it("treats a track the parser does not report as absent", async () => {
		const metadata = Promise.resolve({ format: { duration: 12 } });
		assert.deepEqual(await timedFactsOfMetadata(metadata), { durationSeconds: 12, hasAudio: false, hasVideo: false });
	});

	it("calls a parsed file with no duration unreadable", async () => {
		const metadata = Promise.resolve({ format: { hasAudio: true, hasVideo: false } });
		assert.deepEqual(await timedFactsOfMetadata(metadata), { unreadable: true });
	});

	it.each(["CouldNotDetermineFileTypeError", "UnsupportedFileTypeError"])(
		"calls a file the parser refuses with %s unreadable",
		async (name) => {
			assert.deepEqual(await timedFactsOfMetadata(Promise.reject(parseErrorNamed(name))), { unreadable: true });
		},
	);

	it("passes on a failure that is not about the file's type", async () => {
		const outage = new Error("connection reset");
		await assert.rejects(timedFactsOfMetadata(Promise.reject(outage)), (error) => error === outage);
	});
});
