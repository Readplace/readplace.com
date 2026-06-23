import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

export async function hashPassword(password: string): Promise<string> {
	const salt = randomBytes(16).toString("hex");
	const derived = (await scryptAsync(password, salt, 64)) as Buffer;
	return `${salt}:${derived.toString("hex")}`;
}

export async function verifyPassword(
	password: string,
	stored: string | undefined,
): Promise<boolean> {
	if (!stored) return false;
	const [salt, hash] = stored.split(":");
	const derived = (await scryptAsync(password, salt, 64)) as Buffer;
	const storedBuffer = Buffer.from(hash, "hex");
	return timingSafeEqual(derived, storedBuffer);
}
