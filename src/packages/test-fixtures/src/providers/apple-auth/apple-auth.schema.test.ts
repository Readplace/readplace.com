import { AppleIdSchema } from "./apple-auth.schema";

describe("AppleIdSchema", () => {
	it("brands a string as AppleId", () => {
		expect(AppleIdSchema.parse("apple-user-123")).toBe("apple-user-123");
	});

	it("rejects non-strings", () => {
		expect(AppleIdSchema.safeParse(42).success).toBe(false);
	});
});
