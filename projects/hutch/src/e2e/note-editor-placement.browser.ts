export type ScreenBox = {
	top: number;
	bottom: number;
	left: number;
	right: number;
};

export type NoteEditorMeasure = {
	miss: boolean;
	draft: boolean;
	panel: ScreenBox;
	passage: ScreenBox;
	firstLine: ScreenBox;
	lastLine: ScreenBox;
	chromeBottom: number;
	visibleTop: number;
	visibleBottom: number;
};

export function measureNoteEditor(input: {
	panel: string;
	passage: string[] | null;
}): NoteEditorMeasure {
	const panelElement = document.querySelector(input.panel);
	if (!panelElement) throw new Error(`measureNoteEditor needs ${input.panel}`);
	const drafted = CSS.highlights.get("highlight-note-draft");
	const ranges: Range[] = [];
	if (input.passage === null) {
		if (drafted)
			for (const range of drafted)
				if (range instanceof Range) ranges.push(range);
	} else {
		for (const selector of input.passage) {
			for (const element of document.querySelectorAll(selector)) {
				const range = document.createRange();
				range.selectNodeContents(element);
				ranges.push(range);
			}
		}
	}
	const rects = ranges
		.flatMap((range) => Array.from(range.getClientRects()))
		.filter((rect) => rect.width > 0 && rect.height > 0);
	if (rects.length === 0)
		throw new Error(`measureNoteEditor found no passage for ${input.panel}`);
	const toBox = (rect: {
		top: number;
		bottom: number;
		left: number;
		right: number;
	}): ScreenBox => ({
		top: rect.top,
		bottom: rect.bottom,
		left: rect.left,
		right: rect.right,
	});
	const passage = {
		top: Math.min(...rects.map((rect) => rect.top)),
		bottom: Math.max(...rects.map((rect) => rect.bottom)),
		left: Math.min(...rects.map((rect) => rect.left)),
		right: Math.max(...rects.map((rect) => rect.right)),
	};
	const byTop = [...rects].sort((a, b) => a.top - b.top);
	const panel = toBox(panelElement.getBoundingClientRect());
	const chromeBottom = Array.from(
		document.querySelectorAll(
			".banner-area, .header, .page-reader--chromeless .article-body__toolbar",
		),
	).reduce(
		(bottom, element) =>
			Math.max(bottom, element.getBoundingClientRect().bottom),
		0,
	);
	const viewport = window.visualViewport;
	if (!viewport) throw new Error("measureNoteEditor needs a visual viewport");
	return {
		miss:
			panel.bottom <= passage.top ||
			panel.top >= passage.bottom ||
			panel.right <= passage.left ||
			panel.left >= passage.right,
		draft: drafted !== undefined,
		panel,
		passage,
		firstLine: toBox(byTop[0]),
		lastLine: toBox(byTop[byTop.length - 1]),
		chromeBottom,
		visibleTop: Math.max(viewport.offsetTop, chromeBottom),
		visibleBottom: viewport.offsetTop + viewport.height,
	};
}

export function draftTintRegistered(): boolean {
	return CSS.highlights.has("highlight-note-draft");
}

export function backdropOf(input: { panel: string; content: string }): {
	background: string;
	filter: string;
	contentOpacity: string;
} {
	const panel = document.querySelector(input.panel);
	const content = document.querySelector(input.content);
	if (!panel || !content)
		throw new Error(`backdropOf needs ${input.panel} and ${input.content}`);
	const backdrop = getComputedStyle(panel, "::backdrop");
	return {
		background: backdrop.backgroundColor,
		filter: backdrop.backdropFilter,
		contentOpacity: getComputedStyle(content).opacity,
	};
}

export function dragClearOfEditor(input: { panel: string; content: string }): {
	x: number;
	y: number;
	to: number;
} {
	const panel = document.querySelector(input.panel);
	if (!panel) throw new Error(`dragClearOfEditor needs ${input.panel}`);
	const box = panel.getBoundingClientRect();
	for (const paragraph of document.querySelectorAll(`${input.content} p`)) {
		const rect = paragraph.getBoundingClientRect();
		const clear = rect.bottom <= box.top || rect.top >= box.bottom;
		if (clear && rect.top >= 0 && rect.bottom <= window.innerHeight)
			return { x: rect.left + 4, y: rect.top + 8, to: rect.left + 240 };
	}
	throw new Error("dragClearOfEditor found no paragraph clear of the editor");
}

export function centreBetweenParagraphs(
	content: Element,
	texts: { first: string; last: string },
): void {
	const paragraphs = Array.from(content.querySelectorAll("p"));
	const first = paragraphs.find(
		(paragraph) => paragraph.textContent === texts.first,
	);
	const last = paragraphs.find(
		(paragraph) => paragraph.textContent === texts.last,
	);
	if (!first || !last)
		throw new Error("centreBetweenParagraphs needs both paragraphs rendered");
	const top = first.getBoundingClientRect().top;
	const bottom = last.getBoundingClientRect().bottom;
	window.scrollBy({
		top: (top + bottom) / 2 - window.innerHeight / 2,
		behavior: "instant",
	});
}

export function documentScrollHeight(): number {
	return document.documentElement.scrollHeight;
}
