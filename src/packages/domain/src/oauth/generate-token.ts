import { randomBytes } from "node:crypto";

export function generateToken(): string {
	return randomBytes(32).toString("hex");
}
