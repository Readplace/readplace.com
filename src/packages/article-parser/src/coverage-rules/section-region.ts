import assert from "node:assert";
import type { CoverageReason } from "@packages/domain/article";
import { isHeading, walkNodes } from "./content-walk";
import {
	countWords,
	isElement,
	isLinkedItemGroup,
	isOwnedInDocument,
	isText,
	isThreadOrTeaserBlock,
	isUnowned,
	offPageLink,
	ownedChildren,
	ownedNodeWords,
	ownedWords,
	tagOf,
} from "./owned-nodes";
import {
	DESCEND_MIN_SHARE,
	DOMINANT_UNIT_SHARE,
	LEAD_WORDS,
	MEDIAN_UNIT_WORDS,
	MIN_UNITS,
	OUTSIDE_PROSE_WORDS,
} from "./section-thresholds";

export type SectionUnit = { nodes: readonly Node[]; leading: boolean };
export type SectionRegion =
	| { kind: "region"; root: Element; units: readonly SectionUnit[] }
	| { kind: "abstain"; reason: CoverageReason };

const LANDMARKS = "main, article, [role=main], [itemprop=articleBody]";
const HEADINGS = "h1, h2, h3, h4, h5, h6";

function linkedFragments(document: Document): ReadonlySet<string> {
	const fragments = [...document.querySelectorAll('a[href^="#"]')].map((anchor) => {
		const href = anchor.getAttribute("href");
		assert(href !== null, "the selector matched an href");
		return href.slice(1);
	});
	return new Set(fragments.filter((fragment) => fragment.length > 0));
}

function ownedWordsBefore(params: { container: Element; target: Element }): number {
	let words = 0;
	const visit = (node: Node): boolean => {
		if (node === params.target) {
			return true;
		}
		if (isText(node)) {
			words += countWords(node.data);
			return false;
		}
		if (!isElement(node) || isUnowned(node)) {
			return false;
		}
		return [...node.childNodes].some(visit);
	};
	return [...params.container.childNodes].some(visit) ? words : Number.POSITIVE_INFINITY;
}

function outermostBoundary(document: Document): Element {
	const body = document.body;
	const total = ownedWords(body);
	const holding = [...document.querySelectorAll(LANDMARKS)].filter(
		(landmark) => isOwnedInDocument(landmark) && ownedWords(landmark) * 2 >= total,
	);
	const outermost = holding.filter((landmark) => !holding.some((other) => other !== landmark && other.contains(landmark)));
	return outermost.length === 1 ? outermost[0] : body;
}

function startsOf(params: { el: Element; isTarget: (el: Element) => boolean }): ReadonlySet<Element> {
	const marked = ownedChildren(params.el).map((child) => {
		const heading = child.querySelector(HEADINGS);
		const headed =
			isHeading(child) || (heading !== null && ownedWordsBefore({ container: child, target: heading }) < LEAD_WORDS);
		const target = [...child.querySelectorAll("[id], a[name]")].find(params.isTarget);
		const targeted =
			params.isTarget(child) || (target !== undefined && ownedWordsBefore({ container: child, target }) < LEAD_WORDS);
		return { child, headed, targeted };
	});
	const candidates = marked.filter(({ headed, targeted }) => headed || targeted);
	const starts = candidates.filter(({ child, headed, targeted }) => {
		const shared = candidates.filter((other) => tagOf(other.child) === tagOf(child)).length >= MIN_UNITS;
		return [headed, targeted, shared].filter(Boolean).length >= 2;
	});
	return new Set(starts.map(({ child }) => child));
}

function unitsOf(params: { el: Element; starts: ReadonlySet<Element> }): readonly SectionUnit[] {
	const units: { nodes: Node[]; leading: boolean }[] = [{ nodes: [], leading: true }];
	for (const node of params.el.childNodes) {
		if (isElement(node) && params.starts.has(node)) {
			units.push({ nodes: [node], leading: false });
		} else {
			units[units.length - 1].nodes.push(node);
		}
	}
	const [leading, ...rest] = units;
	const holdsContent = leading.nodes.some((node) => ownedNodeWords(node) > 0 || (isElement(node) && !isUnowned(node)));
	return holdsContent ? units : rest;
}

function unitWords(unit: SectionUnit): number {
	return unit.nodes.reduce((sum, node) => sum + ownedNodeWords(node), 0);
}

function median(values: readonly number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function leadElement(params: { start: Element; isTarget: (el: Element) => boolean }): Element | undefined {
	const { start, isTarget } = params;
	const heading = isHeading(start) ? start : start.querySelector(HEADINGS);
	if (heading !== null) {
		return heading;
	}
	return [start, ...start.querySelectorAll("a[name]")].find((el) => tagOf(el) === "a" && isTarget(el));
}

function holdsOutsideProse(params: { sibling: Node; documentUrl: string }): boolean {
	const blocks = walkNodes({
		nodes: [params.sibling],
		documentUrl: params.documentUrl,
		isOwned: (el) => !isUnowned(el) && tagOf(el) !== "a" && !isLinkedItemGroup({ el, documentUrl: params.documentUrl }),
	});
	return blocks.some((block) => block.kind === "text" && countWords(block.text) >= OUTSIDE_PROSE_WORDS);
}

export function inspectRegion(params: { document: Document; documentUrl: string }): SectionRegion {
	const { document, documentUrl } = params;
	const linked = linkedFragments(document);
	const isTarget = (el: Element) =>
		linked.has(el.id) || (tagOf(el) === "a" && linked.has(el.getAttribute("name") ?? ""));
	const boundary = outermostBoundary(document);

	let region = boundary;
	let starts = startsOf({ el: region, isTarget });
	let units = unitsOf({ el: region, starts });
	while (starts.size < MIN_UNITS || Math.max(...units.map(unitWords)) > DOMINANT_UNIT_SHARE * ownedWords(region)) {
		const next = ownedChildren(region).reduce<Element | undefined>(
			(largest, child) => (largest === undefined || ownedWords(child) > ownedWords(largest) ? child : largest),
			undefined,
		);
		if (next === undefined || ownedWords(next) < DESCEND_MIN_SHARE * ownedWords(region)) {
			return { kind: "abstain", reason: "no-section-structure" };
		}
		region = next;
		starts = startsOf({ el: region, isTarget });
		units = unitsOf({ el: region, starts });
	}

	if (median(units.filter((unit) => !unit.leading).map(unitWords)) < MEDIAN_UNIT_WORDS) {
		return { kind: "abstain", reason: "no-section-structure" };
	}
	const startList = [...starts];
	const offPage = startList.filter((start) => {
		const lead = leadElement({ start, isTarget });
		return (
			lead !== undefined &&
			[lead, ...lead.querySelectorAll("a[href]")].some((anchor) => tagOf(anchor) === "a" && offPageLink({ anchor, documentUrl }))
		);
	});
	if (offPage.length * 2 >= startList.length) {
		return { kind: "abstain", reason: "off-page-sections" };
	}
	const flowBlocks = [...ownedChildren(region).filter((child) => !starts.has(child)), startList[startList.length - 1]];
	if (flowBlocks.some(isThreadOrTeaserBlock)) {
		return { kind: "abstain", reason: "adjacent-repeated-block" };
	}
	for (let node: Element = region; node !== boundary; ) {
		const parent = node.parentElement;
		assert(parent !== null, "the region lies inside its boundary");
		const siblings = [...parent.childNodes].filter((sibling) => sibling !== node);
		if (siblings.some((sibling) => holdsOutsideProse({ sibling, documentUrl }))) {
			return { kind: "abstain", reason: "material-outside-region" };
		}
		node = parent;
	}
	return { kind: "region", root: region, units };
}
