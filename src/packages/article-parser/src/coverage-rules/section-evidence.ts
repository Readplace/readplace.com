import { type Block, walkNodes } from "./content-walk";
import { isUnowned } from "./owned-nodes";
import type { SectionUnit } from "./section-region";
import { MIN_RUN_TOKENS } from "./section-thresholds";
import { candidateKeys, cellTriple, codeKey, countKey, stream, tokenCount } from "./text-keys";

type UniqueProbe = { unit: number; order: number; key: string; fullWindow: boolean };
type RepeatedProbe = { key: string; units: readonly number[]; count: number };
type CodeProbe = { unit: number; order: number; key: string };
type CellProbe = { unit: number; triple: string };
type ImageProbe = { unit: number; urls: readonly string[] };
export type SectionEvidence = {
	units: number;
	unique: readonly UniqueProbe[];
	repeated: readonly RepeatedProbe[];
	code: readonly CodeProbe[];
	cells: readonly CellProbe[];
	images: readonly ImageProbe[];
};

type UnitProbe =
	| { kind: "unique"; key: string; fullWindow: boolean }
	| { kind: "repeated"; key: string; count: number }
	| { kind: "code"; key: string }
	| { kind: "cell"; triple: string }
	| { kind: "image"; urls: readonly string[] };

function probesOf(params: { blocks: readonly Block[]; sourceStream: string }): readonly UnitProbe[] {
	return params.blocks.flatMap((block): readonly UnitProbe[] => {
		switch (block.kind) {
			case "text": {
				if (tokenCount(block.text) < MIN_RUN_TOKENS) {
					return [];
				}
				const { keys, fullWindow } = candidateKeys(block.text);
				const unique = keys.find((key) => countKey({ stream: params.sourceStream, key }) === 1);
				return unique === undefined
					? [{ kind: "repeated", key: keys[0], count: countKey({ stream: params.sourceStream, key: keys[0] }) }]
					: [{ kind: "unique", key: unique, fullWindow }];
			}
			case "code":
				return [{ kind: "code", key: codeKey(block.text) }];
			case "cell":
				return [{ kind: "cell", triple: cellTriple(block) }];
			case "image":
				return [{ kind: "image", urls: block.urls }];
			default:
				return [];
		}
	});
}

export function buildSectionEvidence(params: { units: readonly SectionUnit[]; documentUrl: string }): SectionEvidence {
	const unitBlocks = params.units.map((unit) =>
		walkNodes({ nodes: unit.nodes, documentUrl: params.documentUrl, isOwned: (el) => !isUnowned(el) }),
	);
	const sourceStream = stream(unitBlocks.flat());
	const probedUnits = unitBlocks
		.map((blocks) => probesOf({ blocks, sourceStream }))
		.filter((probes) => probes.length > 0);

	const evidence: {
		unique: UniqueProbe[];
		repeated: Map<string, { units: number[]; count: number }>;
		code: CodeProbe[];
		cells: CellProbe[];
		images: ImageProbe[];
	} = { unique: [], repeated: new Map(), code: [], cells: [], images: [] };
	probedUnits.forEach((probes, unit) => {
		for (const probe of probes) {
			switch (probe.kind) {
				case "unique":
					evidence.unique.push({ unit, order: evidence.unique.length, key: probe.key, fullWindow: probe.fullWindow });
					break;
				case "repeated": {
					const known = evidence.repeated.get(probe.key) ?? { units: [], count: probe.count };
					evidence.repeated.set(probe.key, { units: [...new Set([...known.units, unit])], count: known.count });
					break;
				}
				case "code":
					evidence.code.push({ unit, order: evidence.code.length, key: probe.key });
					break;
				case "cell":
					evidence.cells.push({ unit, triple: probe.triple });
					break;
				case "image":
					evidence.images.push({ unit, urls: probe.urls });
					break;
			}
		}
	});
	return {
		units: probedUnits.length,
		unique: evidence.unique,
		repeated: [...evidence.repeated].map(([key, { units, count }]) => ({ key, units, count })),
		code: evidence.code,
		cells: evidence.cells,
		images: evidence.images,
	};
}
