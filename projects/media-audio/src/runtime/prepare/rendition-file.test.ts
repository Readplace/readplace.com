import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashFile, removeFile } from "./rendition-file";

async function writeTempFile(bytes: Buffer): Promise<string> {
	const path = join(await mkdtemp(join(tmpdir(), "rendition-")), "rendition.m4a");
	await writeFile(path, bytes);
	return path;
}

describe("hashFile", () => {
	it("answers the sha256 and length of the file's bytes", async () => {
		const bytes = Buffer.from("rendition bytes");
		const path = await writeTempFile(bytes);

		assert.deepEqual(await hashFile(path), {
			sha256: createHash("sha256").update(bytes).digest("hex"),
			size: bytes.length,
		});
	});
});

describe("removeFile", () => {
	it("removes the file", async () => {
		const path = await writeTempFile(Buffer.from("x"));

		await removeFile(path);

		await assert.rejects(access(path));
	});

	it("resolves when the file is already absent", async () => {
		const path = await writeTempFile(Buffer.from("x"));
		await removeFile(path);

		await removeFile(path);
	});
});
