import assert from "node:assert";
import { GetObjectCommand, PutObjectCommand, S3ServiceException, type S3Client } from "@aws-sdk/client-s3";
import { CandidateProvenanceSchema, type CandidateProvenance } from "../../domain/select-content/tier-source.types";
import type { Tier } from "../../domain/select-content/tier.types";
import { candidateBodyKeys, candidateManifestKey } from "./candidate-object-keys";

export function initPersistCandidateArtifact(deps: { client: Pick<S3Client, "send">; bucketName: string }) {
	return async (params: { url: string; tier: Tier; html: string; evaluationHtml?: string; metadata: CandidateProvenance }): Promise<CandidateProvenance> => {
		const evaluationHtml = params.evaluationHtml ?? params.html;
		const locations = candidateBodyKeys({ url: params.url, tier: params.tier, candidateId: params.metadata.id });
		const metadata = { ...params.metadata, ...locations };
		const manifestKey = candidateManifestKey({ url: params.url, tier: params.tier, candidateId: metadata.id });
		let persisted = metadata;
		try {
			await deps.client.send(new PutObjectCommand({ Bucket: deps.bucketName, Key: manifestKey, Body: JSON.stringify(metadata), ContentType: "application/json; charset=utf-8", IfNoneMatch: "*" }));
		} catch (error) {
			if (!(error instanceof S3ServiceException) || error.name !== "PreconditionFailed") throw error;
			const existing = await deps.client.send(new GetObjectCommand({ Bucket: deps.bucketName, Key: manifestKey }));
			assert(existing.Body, "existing candidate manifest must have a body");
			const stored = CandidateProvenanceSchema.parse(JSON.parse(await existing.Body.transformToString("utf-8")));
			persisted = { ...stored, ...locations };
		}
		for (const [key, body] of [[locations.htmlLocation, params.html], [locations.evaluationLocation, evaluationHtml]]) {
			await deps.client.send(new PutObjectCommand({ Bucket: deps.bucketName, Key: key, Body: body, ContentType: "text/html; charset=utf-8" }));
		}
		return persisted;
	};
}
