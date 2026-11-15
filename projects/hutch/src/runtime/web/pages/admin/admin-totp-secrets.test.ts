import {
	adminTotpSecretFor,
	adminTotpSecretsParameterValue,
	parseAdminTotpSecrets,
	parseAdminTotpSecretsParameter,
} from "./admin-totp-secrets";

const aliceHex = "3132333435363738393031323334353637383930";
const bobHex = "a1b2c3d4e5f60718293a4b5c6d7e8f9001122334";

function errorMessageOf(run: () => unknown): string {
	try {
		run();
	} catch (error) {
		return String(error);
	}
	throw new Error("expected the call to throw");
}

describe("parseAdminTotpSecrets", () => {
	it("keys each 20-byte secret by its lower-cased admin email", () => {
		const secrets = parseAdminTotpSecrets(`Alice@Example.com=${aliceHex},bob@example.com=${bobHex}`);

		expect([...secrets.entries()]).toEqual([
			["alice@example.com", Buffer.from(aliceHex, "hex")],
			["bob@example.com", Buffer.from(bobHex, "hex")],
		]);
		expect(secrets.get("alice@example.com")?.length).toBe(20);
	});

	it("ignores spaces after commas, a trailing newline and a trailing comma", () => {
		const tidy = parseAdminTotpSecrets(`alice@example.com=${aliceHex},bob@example.com=${bobHex}`);

		const untidy = parseAdminTotpSecrets(` alice@example.com = ${aliceHex}, bob@example.com=${bobHex},\n`);

		expect([...untidy.entries()]).toEqual([...tidy.entries()]);
	});

	it("gives an empty map for empty or whitespace-only input", () => {
		expect(parseAdminTotpSecrets("").size).toBe(0);
		expect(parseAdminTotpSecrets("  \n").size).toBe(0);
	});

	it.each([
		["a 39-character value", aliceHex.slice(1)],
		["an uppercase value", aliceHex.toUpperCase().replace("3", "A")],
		["a non-hex value", `${aliceHex.slice(1)}g`],
	])("throws on %s without showing it", (_label, value) => {
		const message = errorMessageOf(() =>
			parseAdminTotpSecrets(`bob@example.com=${bobHex},alice@example.com=${value}`),
		);

		expect(message).toContain("entry 2");
		expect(message.includes(value)).toBe(false);
	});

	it("throws on an entry with no '=' without showing it", () => {
		const message = errorMessageOf(() => parseAdminTotpSecrets(`alice@example.com${aliceHex}`));

		expect(message).toContain("entry 1");
		expect(message.includes(aliceHex)).toBe(false);
	});

	it("throws on an entry with two '=' without showing it", () => {
		const message = errorMessageOf(() => parseAdminTotpSecrets(`alice@example.com=${aliceHex}=${bobHex}`));

		expect(message).toContain("entry 1");
		expect(message.includes(aliceHex)).toBe(false);
	});
});

describe("adminTotpSecretFor", () => {
	const secrets = parseAdminTotpSecrets(`alice@example.com=${aliceHex}`);

	it("finds the secret for an address written in a different case", () => {
		expect(adminTotpSecretFor({ secrets, email: " ALICE@Example.com " })).toEqual(Buffer.from(aliceHex, "hex"));
	});

	it("finds no secret for an address with no entry", () => {
		expect(adminTotpSecretFor({ secrets, email: "carol@example.com" })).toBe(undefined);
	});
});

describe("the stored parameter value", () => {
	it("reads back the same map the raw value parses to", () => {
		const raw = `alice@example.com=${aliceHex}, bob@example.com=${bobHex}`;

		const stored = parseAdminTotpSecretsParameter(adminTotpSecretsParameterValue(raw));

		expect([...stored.entries()]).toEqual([...parseAdminTotpSecrets(raw).entries()]);
	});

	it("stores a non-empty value for an empty variable, which reads back as no secrets", () => {
		const value = adminTotpSecretsParameterValue("");

		expect(value.length).toBeGreaterThan(0);
		expect(parseAdminTotpSecretsParameter(value).size).toBe(0);
	});

	it("refuses to store a malformed entry without showing it", () => {
		const value = aliceHex.slice(1);

		const message = errorMessageOf(() => adminTotpSecretsParameterValue(`alice@example.com=${value}`));

		expect(message).toContain("entry 1");
		expect(message.includes(value)).toBe(false);
	});

	it("throws on a stored value that is not JSON without showing it", () => {
		const value = `alice@example.com=${aliceHex}`;

		const message = errorMessageOf(() => parseAdminTotpSecretsParameter(value));

		expect(message.includes(aliceHex)).toBe(false);
	});

	it("throws on stored JSON with no string entries without showing it", () => {
		const value = JSON.stringify({ entries: [`alice@example.com=${aliceHex}`] });

		const message = errorMessageOf(() => parseAdminTotpSecretsParameter(value));

		expect(message.includes(aliceHex)).toBe(false);
	});
});
