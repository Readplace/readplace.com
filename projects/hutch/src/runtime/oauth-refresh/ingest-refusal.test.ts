import { initIngestRefreshRefusal } from "./ingest-refusal";

it("upserts an original refusal without using delivery time", async () => {
	const record = jest.fn();
	const refusal = { refusalId: "attempt", occurredAt: 123, fingerprint: "fingerprint", reason: "unknown", status: 400 };
	await initIngestRefreshRefusal(record)({ message: JSON.stringify({ event: "oauth_token_refused", grant_type: "refresh_token", status: 400, refresh_refusal: refusal }), timestamp: 999, source: "source", id: "id" });
	expect(record.mock.calls).toEqual([[refusal]]);
});

it("keeps legacy failures alertable and deduplicates identical log deliveries", async () => {
	const record = jest.fn();
	const ingest = initIngestRefreshRefusal(record);
	const input = { message: JSON.stringify({ event: "oauth_token_refused", grant_type: "refresh_token", status: 400 }), timestamp: 123, source: "source", id: "id" };
	await ingest(input);
	await ingest(input);
	expect(record.mock.calls[0]).toEqual(record.mock.calls[1]);
	expect(record.mock.calls[0][0]).toMatchObject({ occurredAt: 123, reason: "unknown", fingerprint: "unknown" });
});

it.each(["not json", "{}", '{"event":"other","grant_type":"refresh_token"}', '{"event":"oauth_token_refused","grant_type":"authorization_code"}'])("ignores non-refresh events %s", async message => {
	const record = jest.fn();
	await initIngestRefreshRefusal(record)({ message, timestamp: 1, source: "source", id: "id" });
	expect(record.mock.calls).toEqual([]);
});

it("rejects malformed telemetry for retry instead of dropping the failure", async () => {
	await expect(initIngestRefreshRefusal(jest.fn())({ message: '{"event":"oauth_token_refused","grant_type":"refresh_token","status":400,"refresh_refusal":{}}', timestamp: 1, source: "source", id: "id" })).rejects.toThrow();
});
