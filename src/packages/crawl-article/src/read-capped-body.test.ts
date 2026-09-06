import { BodyTooLargeError, readBodyWithCap } from "./read-capped-body";

describe("readBodyWithCap", () => {
	it("returns the full body when it stays within the cap", async () => {
		const response = new Response(Buffer.from("hello world"));

		const buffer = await readBodyWithCap(response, 1024);

		expect(buffer.toString("utf-8")).toBe("hello world");
	});

	it("returns an empty buffer for an empty body", async () => {
		const response = new Response(Buffer.alloc(0));

		const buffer = await readBodyWithCap(response, 1024);

		expect(buffer.byteLength).toBe(0);
	});

	it("throws BodyTooLargeError carrying the observed and cap sizes once the running total exceeds the cap", async () => {
		const response = new Response(Buffer.alloc(100));

		const error = await readBodyWithCap(response, 10).catch((thrown) => thrown);

		expect(error).toBeInstanceOf(BodyTooLargeError);
		expect(error).toMatchObject({ bytes: 100, maxBytes: 10 });
	});
});
