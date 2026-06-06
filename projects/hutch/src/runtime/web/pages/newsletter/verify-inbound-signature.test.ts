import { createHmac } from "node:crypto";
import { verifyInboundSignature } from "./verify-inbound-signature";

const SECRET = "whsec_dGVzdC1zZWNyZXQ=";
const NOW = new Date("2026-06-05T10:00:00.000Z");
const TS = Math.floor(NOW.getTime() / 1000);
const ID = "msg_1";
const PAYLOAD = '{"hello":"world"}';

function sign(input: { id: string; timestamp: number; payload: string }): string {
	const secretBytes = Buffer.from(SECRET.replace(/^whsec_/, ""), "base64");
	const signed = `${input.id}.${input.timestamp}.${input.payload}`;
	return createHmac("sha256", secretBytes).update(signed).digest("base64");
}

describe("verifyInboundSignature", () => {
	it("accepts a correctly signed request", () => {
		const signature = `v1,${sign({ id: ID, timestamp: TS, payload: PAYLOAD })}`;
		expect(
			verifyInboundSignature({
				secret: SECRET,
				payload: PAYLOAD,
				headers: { id: ID, timestamp: String(TS), signature },
				now: NOW,
			}),
		).toEqual({ ok: true });
	});

	it("accepts when a valid v1 entry sits among other version entries", () => {
		const good = sign({ id: ID, timestamp: TS, payload: PAYLOAD });
		const signature = `v2,ignored v1,${good}`;
		expect(
			verifyInboundSignature({
				secret: SECRET,
				payload: PAYLOAD,
				headers: { id: ID, timestamp: String(TS), signature },
				now: NOW,
			}).ok,
		).toBe(true);
	});

	it("rejects when the id header is missing", () => {
		expect(
			verifyInboundSignature({
				secret: SECRET,
				payload: PAYLOAD,
				headers: { id: undefined, timestamp: String(TS), signature: "v1,x" },
				now: NOW,
			}),
		).toEqual({ ok: false, reason: "missing-headers" });
	});

	it("rejects when the timestamp header is missing", () => {
		expect(
			verifyInboundSignature({
				secret: SECRET,
				payload: PAYLOAD,
				headers: { id: ID, timestamp: undefined, signature: "v1,x" },
				now: NOW,
			}),
		).toEqual({ ok: false, reason: "missing-headers" });
	});

	it("rejects when the signature header is missing", () => {
		expect(
			verifyInboundSignature({
				secret: SECRET,
				payload: PAYLOAD,
				headers: { id: ID, timestamp: String(TS), signature: undefined },
				now: NOW,
			}),
		).toEqual({ ok: false, reason: "missing-headers" });
	});

	it("rejects a non-numeric timestamp", () => {
		const signature = `v1,${sign({ id: ID, timestamp: TS, payload: PAYLOAD })}`;
		expect(
			verifyInboundSignature({
				secret: SECRET,
				payload: PAYLOAD,
				headers: { id: ID, timestamp: "not-a-number", signature },
				now: NOW,
			}),
		).toEqual({ ok: false, reason: "stale-timestamp" });
	});

	it("rejects a timestamp outside the tolerance window", () => {
		const staleTs = TS - 600;
		const signature = `v1,${sign({ id: ID, timestamp: staleTs, payload: PAYLOAD })}`;
		expect(
			verifyInboundSignature({
				secret: SECRET,
				payload: PAYLOAD,
				headers: { id: ID, timestamp: String(staleTs), signature },
				now: NOW,
			}),
		).toEqual({ ok: false, reason: "stale-timestamp" });
	});

	it("rejects when no entry matches across non-v1, short, and same-length-wrong candidates", () => {
		const correct = sign({ id: ID, timestamp: TS, payload: PAYLOAD });
		const sameLengthWrong = `${correct.slice(0, -1)}${correct.endsWith("A") ? "B" : "A"}`;
		const signature = `v2,${correct} v1,short v1,${sameLengthWrong}`;
		expect(
			verifyInboundSignature({
				secret: SECRET,
				payload: PAYLOAD,
				headers: { id: ID, timestamp: String(TS), signature },
				now: NOW,
			}),
		).toEqual({ ok: false, reason: "no-match" });
	});

	it("rejects an entry that carries no comma-separated value", () => {
		expect(
			verifyInboundSignature({
				secret: SECRET,
				payload: PAYLOAD,
				headers: { id: ID, timestamp: String(TS), signature: "v1" },
				now: NOW,
			}),
		).toEqual({ ok: false, reason: "no-match" });
	});
});
