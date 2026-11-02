import { createHash } from "node:crypto";
import { SaveAttemptIdSchema } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import { mediaFilename, mediaIdentity } from "./media-filename";

const image = { sourceUrl: "https://example.com/photo.png", body: Buffer.from("image"), extension: ".png" };
const context = { url: "https://example.com/article", attemptId: SaveAttemptIdSchema.parse("attempt") };

it("retains the legacy filename for unowned development media", () => {
	expect(mediaFilename(image)).toMatch(/^[a-f0-9]{16}\.png$/);
});

const sha256 = (...parts: Array<string | Buffer>) => parts.reduce((hash, part) => hash.update(part), createHash("sha256")).digest("hex").slice(0, 32);

it("isolates capture attempts, authors and changed image bytes while retaining identical retries", () => {
	const scope = sha256(JSON.stringify(["attempt", null]));
	const content = sha256(JSON.stringify(image.sourceUrl), image.body);
	expect(mediaFilename({ ...image, writeContext: context })).toBe(`attempts/${scope}/${content}.png`);
	expect(mediaFilename({ ...image, writeContext: context })).toBe(`attempts/${scope}/${content}.png`);
	expect(mediaFilename({ ...image, writeContext: { ...context, attemptId: SaveAttemptIdSchema.parse("next") } })).toBe(
		`attempts/${sha256(JSON.stringify(["next", null]))}/${content}.png`,
	);
	expect(mediaFilename({ ...image, writeContext: { ...context, authorUserId: UserIdSchema.parse("author") } })).toBe(
		`attempts/${sha256(JSON.stringify(["attempt", "author"]))}/${content}.png`,
	);
	expect(mediaFilename({ ...image, body: Buffer.from("changed"), writeContext: context })).toBe(
		`attempts/${scope}/${sha256(JSON.stringify(image.sourceUrl), Buffer.from("changed"))}.png`,
	);
});

describe("mediaIdentity", () => {
	const nextAttempt = { ...context, attemptId: SaveAttemptIdSchema.parse("next") };

	it("is the same for the same image written by two attempts", () => {
		expect(mediaIdentity(mediaFilename({ ...image, writeContext: context }))).toBe(mediaIdentity(mediaFilename({ ...image, writeContext: nextAttempt })));
	});

	it("differs when the image bytes changed", () => {
		expect(mediaIdentity(mediaFilename({ ...image, writeContext: context }))).not.toBe(mediaIdentity(mediaFilename({ ...image, body: Buffer.from("changed"), writeContext: nextAttempt })));
	});

	it("leaves a legacy filename unchanged", () => {
		const legacy = mediaFilename(image);
		expect(mediaIdentity(legacy)).toBe(legacy);
	});

	it("removes the attempt path from every URL in a srcset", () => {
		const first = "a".repeat(32);
		const second = "b".repeat(32);
		expect(mediaIdentity(`https://cdn.test/attempts/${first}/x.png 1x, https://cdn.test/attempts/${second}/y.png 2x`)).toBe("https://cdn.test/x.png 1x, https://cdn.test/y.png 2x");
	});
});
