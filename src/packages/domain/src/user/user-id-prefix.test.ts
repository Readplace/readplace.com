import { UserIdSchema } from "./user.schema";
import { USER_ID_PREFIX_LENGTH, UserIdPrefixSchema, userIdPrefixFrom, parseUserIdPrefix } from "./user-id-prefix";

describe("USER_ID_PREFIX_LENGTH", () => {
	it("is 6", () => {
		expect(USER_ID_PREFIX_LENGTH).toBe(6);
	});
});

describe("UserIdPrefixSchema", () => {
	it("accepts exactly 6 lowercase hex characters", () => {
		const result = UserIdPrefixSchema.safeParse("abc123");
		expect(result.success).toBe(true);
	});

	it("rejects fewer than 6 characters", () => {
		expect(UserIdPrefixSchema.safeParse("abc12").success).toBe(false);
	});

	it("rejects more than 6 characters", () => {
		expect(UserIdPrefixSchema.safeParse("abc1234").success).toBe(false);
	});

	it("rejects non-hex characters", () => {
		expect(UserIdPrefixSchema.safeParse("ghijkl").success).toBe(false);
	});

	it("rejects uppercase hex", () => {
		expect(UserIdPrefixSchema.safeParse("ABCDEF").success).toBe(false);
	});
});

describe("userIdPrefixFrom", () => {
	it("returns the first 6 chars of a hex userId, lowercased", () => {
		const userId = UserIdSchema.parse("abc123deadbeef1234567890abcdef01");
		expect(userIdPrefixFrom(userId)).toBe("abc123");
	});

	it("lowercases uppercase hex", () => {
		const userId = UserIdSchema.parse("ABCDEF1234567890abcdef0123456789");
		expect(userIdPrefixFrom(userId)).toBe("abcdef");
	});

	it("works with non-hex userIds by taking the first 6 chars", () => {
		const userId = UserIdSchema.parse("user-123-test-id");
		expect(userIdPrefixFrom(userId)).toBe("user-1");
	});
});

describe("parseUserIdPrefix", () => {
	it("returns UserIdPrefix for valid 6-hex input", () => {
		expect(parseUserIdPrefix("abc123")).toBe("abc123");
	});

	it("lowercases the input", () => {
		expect(parseUserIdPrefix("ABCDEF")).toBe("abcdef");
	});

	it("returns null for undefined", () => {
		expect(parseUserIdPrefix(undefined)).toBeNull();
	});

	it("returns null for non-hex strings", () => {
		expect(parseUserIdPrefix("paste-another-link")).toBeNull();
	});

	it("returns null for fewer than 6 hex chars", () => {
		expect(parseUserIdPrefix("abc12")).toBeNull();
	});

	it("returns null for 6 hex chars followed by more", () => {
		expect(parseUserIdPrefix("abc123-extra")).toBeNull();
	});
});
