import {
	type ProvenanceLabel,
	type ReaderProvenance,
	provenanceLabel,
} from "../../../shared/article-body/article-header/provenance-label";

export function readlistCardVia(provenance: ReaderProvenance | undefined): ProvenanceLabel | undefined {
	if (provenance?.kind !== "email" && provenance?.kind !== "newsletter") return undefined;
	return provenanceLabel(provenance);
}
