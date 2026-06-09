import assert from "node:assert/strict";
import { UserIdSchema } from "@packages/domain/user";
import {
	decodeResurfaceCookie,
	encodeResurfaceCookie,
} from "./resurface-cookie";

const USER_ID = UserIdSchema.parse("user-123");

describe("resurface cookie", () => {
	it("round-trips a userId, prompt and ids", () => {
		const encoded = encodeResurfaceCookie({ userId: USER_ID, prompt: "coffee", ids: ["a", "b"] });

		assert.deepEqual(decodeResurfaceCookie(encoded), { userId: USER_ID, prompt: "coffee", ids: ["a", "b"] });
	});

	it("caps the stored ids at 50", () => {
		const ids = Array.from({ length: 60 }, (_, i) => `id-${i}`);

		const decoded = decodeResurfaceCookie(encodeResurfaceCookie({ userId: USER_ID, prompt: "p", ids }));

		assert.equal(decoded?.ids.length, 50);
	});

	it("truncates an over-long prompt", () => {
		const prompt = "x".repeat(600);

		const decoded = decodeResurfaceCookie(encodeResurfaceCookie({ userId: USER_ID, prompt, ids: [] }));

		assert.equal(decoded?.prompt.length, 500);
	});

	it("returns undefined for a missing cookie", () => {
		assert.equal(decodeResurfaceCookie(undefined), undefined);
	});

	it("returns undefined for malformed encoding", () => {
		assert.equal(decodeResurfaceCookie("%"), undefined);
		assert.equal(decodeResurfaceCookie("not-json"), undefined);
	});

	it("returns undefined when the payload fails validation", () => {
		const badShape = encodeURIComponent(JSON.stringify({ userId: USER_ID, prompt: "", ids: ["a"] }));

		assert.equal(decodeResurfaceCookie(badShape), undefined);
	});

	it("returns undefined when the userId is missing", () => {
		const noUser = encodeURIComponent(JSON.stringify({ prompt: "coffee", ids: ["a"] }));

		assert.equal(decodeResurfaceCookie(noUser), undefined);
	});
});
