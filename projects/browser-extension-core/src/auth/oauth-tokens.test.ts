import { OAuthTokensSchema } from "./oauth-tokens";

describe("OAuthTokensSchema", () => {
	it("accepts a valid access/refresh token pair", () => {
		const tokens = { accessToken: "access-123", refreshToken: "refresh-456" };
		expect(OAuthTokensSchema.parse(tokens)).toEqual(tokens);
	});

	it("rejects a missing accessToken", () => {
		const result = OAuthTokensSchema.safeParse({ refreshToken: "refresh-456" });
		expect(result.success).toBe(false);
	});

	it("rejects a missing refreshToken", () => {
		const result = OAuthTokensSchema.safeParse({ accessToken: "access-123" });
		expect(result.success).toBe(false);
	});

	it("rejects a non-string token field", () => {
		const result = OAuthTokensSchema.safeParse({
			accessToken: 123,
			refreshToken: "refresh-456",
		});
		expect(result.success).toBe(false);
	});

	it("rejects a non-object value", () => {
		expect(OAuthTokensSchema.safeParse("not-an-object").success).toBe(false);
	});
});
