import assert from "node:assert/strict";
import { avatarColor } from "./avatar-color";

describe("avatarColor", () => {
	it("returns a hex colour string", () => {
		const color = avatarColor("github.com");
		assert.match(color, /^#[0-9A-Fa-f]{6}$/);
	});

	it("returns the same colour for the same domain", () => {
		assert.equal(avatarColor("github.com"), avatarColor("github.com"));
	});

	it("returns different colours for different domains", () => {
		const a = avatarColor("github.com");
		const b = avatarColor("example.com");
		assert.notEqual(a, b);
	});
});
