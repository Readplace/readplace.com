import assert from "node:assert";
import type { IGetToken, IRandomAccessTokenizer, IReadChunkOptions } from "strtok3";

type ReadRange = (range: { start: number; end: number }) => Promise<Uint8Array>;

export function rangedTokenizer(deps: {
	size: number;
	readRange: ReadRange;
	readAheadBytes: { initial: number; maximum: number };
	endOfStream: () => Error;
}): IRandomAccessTokenizer {
	let position = 0;
	let window: { start: number; bytes: Uint8Array } = { start: 0, bytes: new Uint8Array(0) };
	let nextReadAhead = deps.readAheadBytes.initial;

	const fill = async (target: Uint8Array, range: { position: number; length: number }): Promise<number> => {
		const available = Math.max(0, Math.min(range.length, deps.size - range.position));
		if (available === 0) return 0;
		const windowEnd = window.start + window.bytes.length;
		if (range.position < window.start || range.position + available > windowEnd) {
			if (range.position !== windowEnd) nextReadAhead = deps.readAheadBytes.initial;
			const end = Math.min(deps.size, range.position + Math.max(available, nextReadAhead));
			const bytes = await deps.readRange({ start: range.position, end });
			assert(bytes.length === end - range.position, `read ${bytes.length} bytes of range ${range.position}-${end}`);
			window = { start: range.position, bytes };
			nextReadAhead = Math.min(nextReadAhead * 2, deps.readAheadBytes.maximum);
		}
		const offset = range.position - window.start;
		target.set(window.bytes.subarray(offset, offset + available));
		return available;
	};

	const peekBuffer = async (buffer: Uint8Array, options?: IReadChunkOptions): Promise<number> => {
		const length = options?.length ?? buffer.length;
		const read = await fill(buffer, { position: options?.position ?? position, length });
		if (read < length && !options?.mayBeLess) throw deps.endOfStream();
		return read;
	};

	const readBuffer = async (buffer: Uint8Array, options?: IReadChunkOptions): Promise<number> => {
		const start = options?.position ?? position;
		const read = await peekBuffer(buffer, { ...options, position: start });
		position = start + read;
		return read;
	};

	const peekToken = async <T>(token: IGetToken<T>, at?: number | null): Promise<T> => {
		const buffer = new Uint8Array(token.len);
		await peekBuffer(buffer, { position: at ?? position });
		return token.get(buffer, 0);
	};

	const readToken = async <T>(token: IGetToken<T>, at?: number): Promise<T> => {
		const buffer = new Uint8Array(token.len);
		await readBuffer(buffer, { position: at ?? position });
		return token.get(buffer, 0);
	};

	return {
		fileInfo: { size: deps.size },
		get position() {
			return position;
		},
		peekBuffer,
		readBuffer,
		peekToken,
		readToken,
		peekNumber: (token) => peekToken(token),
		readNumber: (token) => readToken(token),
		ignore: async (length) => {
			const skipped = Math.min(length, Math.max(0, deps.size - position));
			position += skipped;
			return skipped;
		},
		setPosition: (to) => {
			position = to;
		},
		close: async () => {},
		abort: async () => {},
		supportsRandomAccess: () => true,
	};
}
