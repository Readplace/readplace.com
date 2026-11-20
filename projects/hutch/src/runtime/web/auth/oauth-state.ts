import { createHmac, timingSafeEqual } from "node:crypto";

export const signState = ({ payload, secret }: { payload: string; secret: string }): string => {
	const mac = createHmac("sha256", secret).update(payload).digest("base64url");
	return `${payload}.${mac}`;
};

export const verifyState = ({ signed, secret }: { signed: string; secret: string }): string | null => {
	const dotIndex = signed.lastIndexOf(".");
	if (dotIndex === -1) return null;
	const payload = signed.slice(0, dotIndex);
	const expected = signState({ payload, secret });
	const actualBytes = Buffer.from(signed);
	const expectedBytes = Buffer.from(expected);
	if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) return null;
	return payload;
};
