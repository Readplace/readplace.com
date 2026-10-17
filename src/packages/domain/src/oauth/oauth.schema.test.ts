import {
	OAuthClientIdSchema,
	AccessTokenSchema,
	RefreshTokenSchema,
	AuthorizationCodeSchema,
	OAuthGrantIdSchema,
} from "./oauth.schema";

describe("OAuthClientIdSchema", () => {
	it("brands a string as OAuthClientId", () => {
		expect(OAuthClientIdSchema.parse("client-abc")).toBe("client-abc");
	});

	it("rejects non-strings", () => {
		expect(OAuthClientIdSchema.safeParse(123).success).toBe(false);
	});
});

describe("AccessTokenSchema", () => {
	it("brands a string as AccessToken", () => {
		expect(AccessTokenSchema.parse("token-abc")).toBe("token-abc");
	});

	it("rejects non-strings", () => {
		expect(AccessTokenSchema.safeParse(123).success).toBe(false);
	});
});

describe("RefreshTokenSchema", () => {
	it("brands a string as RefreshToken", () => {
		expect(RefreshTokenSchema.parse("refresh-abc")).toBe("refresh-abc");
	});

	it("rejects non-strings", () => {
		expect(RefreshTokenSchema.safeParse(123).success).toBe(false);
	});
});

describe("AuthorizationCodeSchema", () => {
	it("brands a string as AuthorizationCode", () => {
		expect(AuthorizationCodeSchema.parse("auth-abc")).toBe("auth-abc");
	});

	it("rejects non-strings", () => {
		expect(AuthorizationCodeSchema.safeParse(123).success).toBe(false);
	});
});

describe("OAuthGrantIdSchema", () => {
	it("brands a string as OAuthGrantId", () => {
		expect(OAuthGrantIdSchema.parse("grant-abc")).toBe("grant-abc");
	});

	it("rejects non-strings", () => {
		expect(OAuthGrantIdSchema.safeParse(123).success).toBe(false);
	});
});
