export function noteGlyphStyle(input: { mark: string }): {
	content: string;
	maskImage: string;
	glyphBackground: string;
	markColor: string;
	bodyColor: string;
	bodyBackground: string;
} {
	const mark = document.querySelector(input.mark);
	if (!mark) throw new Error(`noteGlyphStyle needs ${input.mark}`);
	const glyph = getComputedStyle(mark, "::after");
	const body = getComputedStyle(document.body);
	return {
		content: glyph.content,
		maskImage: glyph.maskImage || glyph.getPropertyValue("-webkit-mask-image"),
		glyphBackground: glyph.backgroundColor,
		markColor: getComputedStyle(mark).color,
		bodyColor: body.color,
		bodyBackground: body.backgroundColor,
	};
}

export function noteGlyphGeometry(input: { mark: string }): {
	segmentTop: number;
	lastCharacterTop: number;
	segmentRight: number;
	lastCharacterRight: number;
	fontSize: number;
} {
	const mark = document.querySelector(input.mark);
	if (!mark) throw new Error(`noteGlyphGeometry needs ${input.mark}`);
	const walker = document.createTreeWalker(mark, NodeFilter.SHOW_TEXT);
	let last: Node | null = null;
	for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
		if ((node.textContent ?? "").length > 0) last = node;
	}
	if (!last) throw new Error("noteGlyphGeometry needs a mark holding text");
	const length = (last.textContent ?? "").length;
	const range = document.createRange();
	range.setStart(last, length - 1);
	range.setEnd(last, length);
	const characterRects = range.getClientRects();
	const character = characterRects[characterRects.length - 1];
	const segmentRects = mark.getClientRects();
	const segment = segmentRects[segmentRects.length - 1];
	if (!character || !segment) throw new Error("noteGlyphGeometry needs rendered text");
	return {
		segmentTop: segment.top,
		lastCharacterTop: character.top,
		segmentRight: segment.right,
		lastCharacterRight: character.right,
		fontSize: Number.parseFloat(getComputedStyle(mark).fontSize),
	};
}
