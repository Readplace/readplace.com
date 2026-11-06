import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { ABSENT_ENCLOSURE, type EnclosureRead } from "@packages/domain/article";
import { renderPlayer } from "./player.component";

const OWNED: EnclosureRead = {
	kind: "owned",
	enclosure: { object: `objects/sha256/${"a".repeat(64)}/1`, mediaType: "audio/mpeg", durationSeconds: 2820 },
};

function playerOf(html: string): Element {
	const player = new JSDOM(html).window.document.querySelector("[data-test-reader-player]");
	assert(player, "player marker must render");
	return player;
}

describe("renderPlayer", () => {
	it("renders an audio element pointing at the item's enclosure route for an owned enclosure", () => {
		const player = playerOf(renderPlayer({ articleId: "abc123", enclosure: OWNED }));

		expect(player.getAttribute("data-test-reader-player")).toBe("audio");
		const audio = player.querySelector("audio");
		assert(audio, "owned enclosure must render an audio element");
		expect(audio.getAttribute("src")).toBe("/queue/abc123/enclosure");
		expect(audio.hasAttribute("controls")).toBe(true);
		expect(audio.getAttribute("preload")).toBe("metadata");
	});

	it("renders the absent marker and no audio element without an owned enclosure", () => {
		const player = playerOf(renderPlayer({ articleId: "abc123", enclosure: ABSENT_ENCLOSURE }));

		expect(player.getAttribute("data-test-reader-player")).toBe("absent");
		expect(player.querySelector("audio")).toBeNull();
	});
});
