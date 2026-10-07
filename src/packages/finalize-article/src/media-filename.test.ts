import { createHash } from "node:crypto";
import { SaveAttemptIdSchema } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import { mediaFilename } from "./media-filename";

const image = { sourceUrl: "https://example.com/photo.png", body: Buffer.from("image"), extension: ".png" };
const context = { url: "https://example.com/article", attemptId: SaveAttemptIdSchema.parse("attempt") };

it("retains the legacy filename for unowned development media", () => {
	expect(mediaFilename(image)).toMatch(/^[a-f0-9]{16}\.png$/);
});

const sha256 = (...parts: Array<string | Buffer>) => parts.reduce((hash, part) => hash.update(part), createHash("sha256")).digest("hex");

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
