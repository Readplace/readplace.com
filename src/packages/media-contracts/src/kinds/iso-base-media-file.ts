const FTYP = [0x66, 0x74, 0x79, 0x70];
const MINIMUM_FTYP_BOX_SIZE = 16;

export function isIsoBaseMediaFile(firstBytes: Uint8Array): boolean {
	return (
		firstBytes.length >= MINIMUM_FTYP_BOX_SIZE &&
		new DataView(firstBytes.buffer, firstBytes.byteOffset, firstBytes.byteLength).getUint32(0) >=
			MINIMUM_FTYP_BOX_SIZE &&
		FTYP.every((byte, index) => firstBytes[4 + index] === byte)
	);
}
