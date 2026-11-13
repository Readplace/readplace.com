import assert from "node:assert";
import { z } from "zod";

export const ADMIN_TOTP_SECRETS_PARAMETER_NAME = "/readplace/admin-totp-secrets";

export type ReadAdminTotpSecrets = () => Promise<ReadonlyMap<string, Buffer>>;

const AdminTotpSecretHexSchema = z.string().regex(/^[0-9a-f]{40}$/);

const AdminTotpSecretsParameterSchema = z.object({ entries: z.string() });

function normaliseEmail(email: string): string {
	return email.trim().toLowerCase();
}

export function parseAdminTotpSecrets(raw: string): ReadonlyMap<string, Buffer> {
	const entries = raw
		.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
	const secrets = new Map<string, Buffer>();
	entries.forEach((entry, index) => {
		const parts = entry.split("=");
		const position = `ADMIN_TOTP_SECRETS entry ${index + 1}`;
		assert(parts.length === 2, `${position} must be <admin email>=<40 hex characters> with exactly one "=" (value not shown)`);
		const [email, hex] = parts.map((part) => part.trim());
		assert(
			AdminTotpSecretHexSchema.safeParse(hex).success,
			`${position} must hold a secret of exactly 40 lower-case hex characters (value not shown)`,
		);
		secrets.set(normaliseEmail(email), Buffer.from(hex, "hex"));
	});
	return secrets;
}

export function adminTotpSecretFor({
	secrets,
	email,
}: {
	secrets: ReadonlyMap<string, Buffer>;
	email: string;
}): Buffer | undefined {
	return secrets.get(normaliseEmail(email));
}

export function adminTotpSecretsParameterValue(raw: string): string {
	parseAdminTotpSecrets(raw);
	return JSON.stringify({ entries: raw });
}

function parseJsonWithoutEcho(value: string): unknown {
	try {
		return JSON.parse(value);
	} catch {
		assert.fail(`${ADMIN_TOTP_SECRETS_PARAMETER_NAME} must hold JSON (value not shown)`);
	}
}

export function parseAdminTotpSecretsParameter(value: string): ReadonlyMap<string, Buffer> {
	const stored = AdminTotpSecretsParameterSchema.safeParse(parseJsonWithoutEcho(value));
	assert(stored.success, `${ADMIN_TOTP_SECRETS_PARAMETER_NAME} must hold JSON with a string "entries" (value not shown)`);
	return parseAdminTotpSecrets(stored.data.entries);
}
