import assert from "node:assert/strict";
import { rangedTokenizer } from "./ranged-tokenizer";

class EndOfStream extends Error {}

const UINT32_BE = { len: 4, get: (bytes: Uint8Array, offset: number) => new DataView(bytes.buffer, bytes.byteOffset).getUint32(offset) };
const FOURCC = { len: 4, get: (bytes: Uint8Array, offset: number) => Buffer.from(bytes.subarray(offset, offset + 4)).toString("latin1") };

function countingFile(file: Uint8Array, readAheadBytes = { initial: 4, maximum: 16 }) {
	const fetched: { start: number; end: number }[] = [];
	const tokenizer = rangedTokenizer({
		size: file.length,
		readAheadBytes,
		endOfStream: () => new EndOfStream(),
		readRange: async (range) => {
			fetched.push(range);
			return file.subarray(range.start, range.end);
		},
	});
	return { tokenizer, fetched };
}

const digits = Uint8Array.from({ length: 64 }, (_, index) => index);

function box(type: string, body: Uint8Array): Uint8Array {
	const header = Buffer.alloc(8);
	header.writeUInt32BE(8 + body.length, 0);
	header.write(type, 4, "latin1");
	return Buffer.concat([header, body]);
}

function movieHeader(timescale: number, duration: number): Uint8Array {
	const body = Buffer.alloc(100);
	body.writeUInt32BE(timescale, 12);
	body.writeUInt32BE(duration, 16);
	return box("mvhd", body);
}

describe("rangedTokenizer", () => {
	it("reads the bytes at any position and moves to the end of what it read", async () => {
		const { tokenizer } = countingFile(digits);
		const buffer = new Uint8Array(3);

		assert.equal(await tokenizer.readBuffer(buffer, { position: 40 }), 3);
		assert.deepEqual([...buffer], [40, 41, 42]);
		assert.equal(tokenizer.position, 43);
		assert.equal(await tokenizer.readBuffer(buffer), 3);
		assert.deepEqual([...buffer], [43, 44, 45]);
		assert.equal(tokenizer.position, 46);
	});

	it("peeks without moving", async () => {
		const { tokenizer } = countingFile(digits);
		const buffer = new Uint8Array(4);

		await tokenizer.peekBuffer(buffer, { position: 10, length: 2 });
		assert.deepEqual([...buffer], [10, 11, 0, 0]);
		await tokenizer.peekBuffer(buffer);
		assert.deepEqual([...buffer], [0, 1, 2, 3]);
		assert.equal(tokenizer.position, 0);
	});

	it("reads and peeks tokens and numbers", async () => {
		const { tokenizer } = countingFile(Buffer.concat([Buffer.from([0, 0, 1, 0]), Buffer.from("moov", "latin1")]));

		assert.equal(await tokenizer.peekToken(FOURCC, 4), "moov");
		assert.equal(await tokenizer.peekToken(FOURCC, null), "\0\0\x01\0");
		assert.equal(await tokenizer.peekNumber(UINT32_BE), 256);
		assert.equal(await tokenizer.readNumber(UINT32_BE), 256);
		assert.equal(await tokenizer.readToken(FOURCC), "moov");
		assert.equal(await tokenizer.readToken(UINT32_BE, 0), 256);
		assert.equal(tokenizer.position, 4);
	});

	it("refuses a read past the end unless it may be short", async () => {
		const { tokenizer } = countingFile(digits);
		const buffer = new Uint8Array(8);

		await assert.rejects(tokenizer.readBuffer(buffer, { position: 60 }), EndOfStream);
		assert.equal(await tokenizer.readBuffer(buffer, { position: 60, mayBeLess: true }), 4);
		assert.equal(tokenizer.position, 64);
	});

	it("answers a read at the end with no bytes and no fetch", async () => {
		const { tokenizer, fetched } = countingFile(digits);

		assert.equal(await tokenizer.peekBuffer(new Uint8Array(8), { position: 64, mayBeLess: true }), 0);
		assert.deepEqual(fetched, []);
	});

	it("skips no further than the end and moves wherever it is told", async () => {
		const { tokenizer } = countingFile(digits);

		assert.equal(await tokenizer.ignore(60), 60);
		assert.equal(await tokenizer.ignore(10), 4);
		tokenizer.setPosition(5);
		assert.equal(await tokenizer.readToken(UINT32_BE), 0x05060708);
	});

	it("serves reads inside its read-ahead from one fetch and doubles it while reads run on", async () => {
		const { tokenizer, fetched } = countingFile(digits);
		const byte = new Uint8Array(1);

		for (let index = 0; index < 28; index++) await tokenizer.readBuffer(byte);

		assert.deepEqual(fetched, [
			{ start: 0, end: 4 },
			{ start: 4, end: 12 },
			{ start: 12, end: 28 },
		]);
		assert.equal(await tokenizer.readBuffer(new Uint8Array(20)), 20);
		assert.deepEqual(fetched.at(-1), { start: 28, end: 48 });
	});

	it("starts its read-ahead over after a seek, forwards or backwards", async () => {
		const { tokenizer, fetched } = countingFile(digits);
		const byte = new Uint8Array(1);

		await tokenizer.readBuffer(byte, { position: 0 });
		await tokenizer.readBuffer(byte, { position: 4 });
		await tokenizer.readBuffer(byte, { position: 40 });
		await tokenizer.readBuffer(byte, { position: 2 });

		assert.deepEqual(fetched, [
			{ start: 0, end: 4 },
			{ start: 4, end: 12 },
			{ start: 40, end: 44 },
			{ start: 2, end: 6 },
		]);
	});

	it("reads a movie header placed after a large media box without fetching the media", async () => {
		const file = Buffer.concat([
			box("ftyp", Buffer.from("isom\0\0\x02\0isomiso2mp41", "latin1")),
			box("mdat", new Uint8Array(8 * 1024 * 1024)),
			box("moov", movieHeader(1000, 5_025_000)),
		]);
		const { tokenizer, fetched } = countingFile(file, { initial: 64 * 1024, maximum: 1024 * 1024 });

		let durationSeconds: number | undefined;
		while (tokenizer.position < file.length) {
			const size = await tokenizer.readToken(UINT32_BE);
			const type = await tokenizer.readToken(FOURCC);
			if (type === "moov") {
				await tokenizer.ignore(8 + 12);
				const timescale = await tokenizer.readToken(UINT32_BE);
				durationSeconds = (await tokenizer.readToken(UINT32_BE)) / timescale;
				tokenizer.setPosition(file.length);
			} else {
				await tokenizer.ignore(size - 8);
			}
		}

		assert.equal(durationSeconds, 5025);
		const fetchedBytes = fetched.reduce((total, range) => total + range.end - range.start, 0);
		assert.ok(fetchedBytes < file.length / 10, `fetched ${fetchedBytes} of ${file.length} bytes`);
	});

	it("knows its size, offers random access and has nothing to release", async () => {
		const { tokenizer } = countingFile(digits);

		assert.deepEqual(tokenizer.fileInfo, { size: 64 });
		assert.equal(tokenizer.supportsRandomAccess(), true);
		await tokenizer.close();
		await tokenizer.abort();
	});
});
