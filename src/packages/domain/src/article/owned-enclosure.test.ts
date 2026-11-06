import assert from "node:assert/strict";
import { EnclosureSchema, mintPrivateItemUrl, UploadIdSchema } from "@packages/media-contracts";
import { UserIdSchema } from "../user/user.schema";
import { ABSENT_ENCLOSURE, ownedEnclosure, ownedEnclosuresByUrl } from "./owned-enclosure";
import { ANONYMOUS_VIEWER, viewerFor } from "./private-item-access";

const AUDIO_URL = mintPrivateItemUrl(UploadIdSchema.parse("0123456789abcdef0123456789abcdef"));
const LINK_URL = "https://example.com/a";
const WEBMAIL_URL = "https://mail.google.com/mail/u/0/";
const OWNER = UserIdSchema.parse("owner-user");
const OTHER_READER = UserIdSchema.parse("other-user");
const ENCLOSURE = EnclosureSchema.parse({
	object: `objects/sha256/${"a".repeat(64)}/1`,
	mediaType: "audio/mpeg",
	durationSeconds: 2820,
});

const AUDIO_ARTICLE = { url: AUDIO_URL, ownerUserId: OWNER, enclosure: ENCLOSURE };

describe("ownedEnclosure", () => {
	it("is owned, carrying the enclosure, for the item's owner", () => {
		assert.deepEqual(ownedEnclosure({ viewer: viewerFor(OWNER), article: AUDIO_ARTICLE }), {
			kind: "owned",
			enclosure: ENCLOSURE,
		});
	});

	it("is absent for another reader", () => {
		assert.deepEqual(ownedEnclosure({ viewer: viewerFor(OTHER_READER), article: AUDIO_ARTICLE }), ABSENT_ENCLOSURE);
	});

	it("is absent for an anonymous viewer", () => {
		assert.deepEqual(ownedEnclosure({ viewer: ANONYMOUS_VIEWER, article: AUDIO_ARTICLE }), ABSENT_ENCLOSURE);
	});

	it("is absent for the owner of a row that carries no enclosure", () => {
		assert.deepEqual(
			ownedEnclosure({ viewer: viewerFor(OWNER), article: { url: AUDIO_URL, ownerUserId: OWNER, enclosure: undefined } }),
			ABSENT_ENCLOSURE,
		);
	});

	it("is absent for a webmail row that carries an enclosure", () => {
		assert.deepEqual(
			ownedEnclosure({ viewer: viewerFor(OWNER), article: { url: WEBMAIL_URL, ownerUserId: OWNER, enclosure: ENCLOSURE } }),
			ABSENT_ENCLOSURE,
		);
	});
});

describe("ownedEnclosuresByUrl", () => {
	it("keys each article's enclosure read by its URL", () => {
		const reads = ownedEnclosuresByUrl({
			viewer: viewerFor(OWNER),
			articles: [AUDIO_ARTICLE, { url: LINK_URL, ownerUserId: undefined, enclosure: undefined }],
		});

		assert.deepEqual(
			reads,
			new Map([
				[AUDIO_URL, { kind: "owned", enclosure: ENCLOSURE }],
				[LINK_URL, ABSENT_ENCLOSURE],
			]),
		);
	});

	it("is absent for an audio article the viewer does not own", () => {
		const reads = ownedEnclosuresByUrl({ viewer: viewerFor(OTHER_READER), articles: [AUDIO_ARTICLE] });

		assert.deepEqual(reads, new Map([[AUDIO_URL, ABSENT_ENCLOSURE]]));
	});
});
