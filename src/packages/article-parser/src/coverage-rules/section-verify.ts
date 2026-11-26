import assert from "node:assert";
import type { CoverageOutcome, CoverageReason } from "@packages/domain/article";
import { type Block, walk } from "./content-walk";
import type { ReaderProjection } from "./coverage-rule.types";
import type { SectionEvidence } from "./section-evidence";
import { cellTriple, codeKey, countKey, indexOfKey, stream } from "./text-keys";

export const MAX_REASONS = 6;

export function readerBlocks(reader: ReaderProjection): readonly Block[] {
	const root = reader.document.getElementById("root");
	assert(root !== null, "a reader projection wraps its html in #root");
	return walk({ root, documentUrl: undefined, isOwned: () => true });
}

export function verifySection(params: { evidence: SectionEvidence; reader: ReaderProjection }): CoverageOutcome {
	const { evidence, reader } = params;
	const out = readerBlocks(reader);
	const text = stream(out);
	const failed = new Map<number, Set<CoverageReason>>();
	const fail = (unit: number, reason: CoverageReason) => {
		failed.set(unit, new Set([...(failed.get(unit) ?? []), reason]));
	};

	let cursor = 0;
	for (const probe of evidence.unique) {
		const at = indexOfKey({ stream: text, key: probe.key, from: cursor });
		if (at >= 0) {
			cursor = at + probe.key.length;
			if (probe.fullWindow && countKey({ stream: text, key: probe.key }) > 1) {
				fail(probe.unit, "duplicated-section");
			}
		} else if (indexOfKey({ stream: text, key: probe.key, from: 0 }) >= 0) {
			fail(probe.unit, "section-out-of-order");
		} else {
			fail(probe.unit, "missing-section");
		}
	}
	for (const probe of evidence.repeated) {
		if (countKey({ stream: text, key: probe.key }) < probe.count) {
			for (const unit of probe.units) {
				fail(unit, "missing-section");
			}
		}
	}

	const codeKeys = out.flatMap((block) => (block.kind === "code" ? [codeKey(block.text)] : []));
	let codeCursor = 0;
	for (const probe of evidence.code) {
		const found = codeKeys.indexOf(probe.key, codeCursor);
		if (found >= 0) {
			codeCursor = found + 1;
		} else {
			fail(probe.unit, "missing-code");
		}
	}

	const triples = new Set(out.flatMap((block) => (block.kind === "cell" ? [cellTriple(block)] : [])));
	for (const probe of evidence.cells) {
		if (!triples.has(probe.triple)) {
			fail(probe.unit, "table-mismatch");
		}
	}

	const readerUrls = new Set(out.flatMap((block) => (block.kind === "image" ? block.urls : [])));
	for (const probe of evidence.images) {
		const kept = probe.urls.some((url) => readerUrls.has(url) || readerUrls.has(reader.media.get(url) ?? ""));
		if (!kept) {
			fail(probe.unit, "missing-image");
		}
	}

	const scope = { kind: "article" as const, units: evidence.units };
	if (failed.size === 0) {
		return { outcome: "verified-for-scope", scope, covered: evidence.units };
	}
	const reasons = [...new Set([...failed.values()].flatMap((unitReasons) => [...unitReasons]))].sort().slice(0, MAX_REASONS);
	return { outcome: "known-partial", scope, covered: evidence.units - failed.size, unresolved: failed.size, reasons };
}
