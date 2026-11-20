import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

const KEY_LENGTH = 64;
const FIXED_SALT = "0".repeat(32);
const FIXED_HASH = Buffer.alloc(KEY_LENGTH);

export async function hashPassword(password: string): Promise<string> {
	const salt = randomBytes(16).toString("hex");
	const derived = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
	return `${salt}:${derived.toString("hex")}`;
}

async function matchesHash(params: { password: string; salt: string; hash: Buffer }): Promise<boolean> {
	const derived = (await scryptAsync(params.password, params.salt, KEY_LENGTH)) as Buffer;
	return timingSafeEqual(derived, params.hash);
}

async function refuseAfterFixedHash(password: string): Promise<false> {
	await matchesHash({ password, salt: FIXED_SALT, hash: FIXED_HASH });
	return false;
}

export async function verifyPassword(
	password: string,
	stored: string | undefined,
): Promise<boolean> {
	if (!stored) return refuseAfterFixedHash(password);
	const [salt, hash] = stored.split(":");
	return matchesHash({ password, salt, hash: Buffer.from(hash, "hex") });
}
