import { hashPassword, verifyPassword } from "./password";

describe("hashPassword", () => {
	it("produces a salt:hash string", async () => {
		const hashed = await hashPassword("my-secret");
		const parts = hashed.split(":");

		expect(parts).toHaveLength(2);
		expect(parts[0].length).toBe(32);
		expect(parts[1].length).toBe(128);
	});

	it("produces unique salts for the same password", async () => {
		const first = await hashPassword("same-password");
		const second = await hashPassword("same-password");

		const firstSalt = first.split(":")[0];
		const secondSalt = second.split(":")[0];
		expect(firstSalt).toMatch(/^[0-9a-f]{32}$/);
		expect(secondSalt).toMatch(/^[0-9a-f]{32}$/);
	});
});

describe("verifyPassword", () => {
	it("returns true for a matching password", async () => {
		const stored = await hashPassword("correct-password");

		const result = await verifyPassword("correct-password", stored);

		expect(result).toBe(true);
	});

	it("returns false for a wrong password", async () => {
		const stored = await hashPassword("correct-password");

		const result = await verifyPassword("wrong-password", stored);

		expect(result).toBe(false);
	});

	it("returns false when no password is stored", async () => {
		const result = await verifyPassword("any-password", undefined);

		expect(result).toBe(false);
	});

	it("returns false for an empty password when no password is stored", async () => {
		const result = await verifyPassword("", undefined);

		expect(result).toBe(false);
	});

	it("returns false when the stored hash is empty", async () => {
		const result = await verifyPassword("any-password", "");

		expect(result).toBe(false);
	});

	it("takes the same scrypt work with no stored hash as with a wrong password", async () => {
		const stored = await hashPassword("correct-password");
		const time = async (run: () => Promise<boolean>) => {
			const start = process.hrtime.bigint();
			for (let i = 0; i < 5; i++) await run();
			return Number(process.hrtime.bigint() - start);
		};

		const wrongPassword = await time(() => verifyPassword("wrong-password", stored));
		const noStoredHash = await time(() => verifyPassword("wrong-password", undefined));

		expect(noStoredHash).toBeGreaterThan(wrongPassword / 4);
	});
});
