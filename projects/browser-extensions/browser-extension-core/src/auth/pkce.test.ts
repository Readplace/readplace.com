import { generateCodeVerifier, generateCodeChallenge } from "./pkce";

describe("PKCE", () => {
	describe("generateCodeVerifier", () => {
		it("should generate a non-empty string", () => {
			const verifier = generateCodeVerifier();
			expect(verifier.length).toBeGreaterThan(0);
		});

		it("should generate unique values", () => {
			const a = generateCodeVerifier();
			const b = generateCodeVerifier();
			expect(a).not.toBe(b);
		});

		it("should only contain URL-safe base64 characters", () => {
			const verifier = generateCodeVerifier();
			expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
		});
	});

	describe("generateCodeChallenge", () => {
		it("should generate a non-empty string from a verifier", async () => {
			const verifier = generateCodeVerifier();
			const challenge = await generateCodeChallenge(verifier);
			expect(challenge.length).toBeGreaterThan(0);
		});

		it("should produce the same challenge for the same verifier", async () => {
			const verifier = generateCodeVerifier();
			const a = await generateCodeChallenge(verifier);
			const b = await generateCodeChallenge(verifier);
			expect(a).toBe(b);
		});

		it("should produce different challenges for different verifiers", async () => {
			const a = await generateCodeChallenge("verifier-one");
			const b = await generateCodeChallenge("verifier-two");
			expect(a).not.toBe(b);
		});

		it("should only contain URL-safe base64 characters", async () => {
			const challenge = await generateCodeChallenge("test-verifier");
			expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
		});
	});
});
