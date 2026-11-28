import type { Request, Response } from "express";
import { AccessTokenSchema } from "@packages/domain/oauth";
import type { ValidateAccessToken } from "@packages/provider-contracts/oauth";

export async function requireValidBearer(input: {
	req: Request;
	res: Response;
	validateAccessToken: ValidateAccessToken;
}): Promise<NonNullable<Awaited<ReturnType<ValidateAccessToken>>> | undefined> {
	const header = input.req.headers.authorization;
	if (!header?.startsWith("Bearer ")) {
		input.res.status(401).set("WWW-Authenticate", "Bearer").end();
		return undefined;
	}
	const validated = await input.validateAccessToken(AccessTokenSchema.parse(header.slice(7)));
	if (!validated) {
		input.res.status(401).set("WWW-Authenticate", 'Bearer error="invalid_token"').end();
		return undefined;
	}
	return validated;
}
