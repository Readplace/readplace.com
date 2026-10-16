import { createHmac, timingSafeEqual } from "node:crypto";
import { AuthDiagnosticClient } from "@packages/domain/auth-diagnostics";
import { z } from "zod";

const Permit = z.strictObject({
	v: z.literal(1),
	aud: z.literal("readplace-auth-diagnostics"),
	scope: z.literal("append"),
	subject_ref: z.string().regex(/^[a-f0-9]{64}$/),
	grant_id: z.string().min(1).max(128),
	client: AuthDiagnosticClient,
	installation_ref: z.uuid(),
	exp: z.number().int(),
});
export type AuthDiagnosticPermit = z.infer<typeof Permit>;

export function initAuthDiagnosticPermits(deps: { salt: string; now: () => Date }) {
	const key = createHmac("sha256", deps.salt).update("readplace-auth-diagnostics-permit-v1").digest();
	const sign = (value: string) => createHmac("sha256", key).update(value).digest();
	const reference = (input: { kind: "subject" | "session"; value: string }) =>
		createHmac("sha256", deps.salt).update(`auth-diagnostics:${input.kind}:`).update(input.value).digest("hex");
	return {
		reference,
		issue(input: { userId: string; grantId: string; client: AuthDiagnosticPermit["client"]; installationId: string }): string {
			const payload = Permit.parse({
				v: 1, aud: "readplace-auth-diagnostics", scope: "append",
				subject_ref: reference({ kind: "subject", value: input.userId }),
				grant_id: input.grantId, client: input.client, installation_ref: input.installationId,
				exp: Math.floor(deps.now().getTime() / 1_000) + 210 * 24 * 60 * 60,
			});
			const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
			return `${body}.${sign(body).toString("base64url")}`;
		},
		verify(value: string): AuthDiagnosticPermit | undefined {
			if (value.length > 2_048) return undefined;
			const [body, signature, extra] = value.split(".");
			if (!body || !signature || extra !== undefined || !/^[A-Za-z0-9_-]+$/.test(signature)) return undefined;
			const expected = sign(body);
			const actual = Buffer.from(signature, "base64url");
			if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return undefined;
			try {
				const parsed = Permit.safeParse(JSON.parse(Buffer.from(body, "base64url").toString("utf8")));
				if (!parsed.success || parsed.data.exp <= Math.floor(deps.now().getTime() / 1_000)) return undefined;
				return parsed.data;
			} catch {
				return undefined;
			}
		},
	};
}
