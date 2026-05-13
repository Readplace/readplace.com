import type { S3Client } from "@aws-sdk/client-s3";
import type { HutchLogger } from "@packages/hutch-logger";
import type { DynamoDBDocumentClient } from "@packages/hutch-storage-client";
import {
	initReadTierSource,
	type ReadTierSource,
} from "../../select-content/read-tier-source";
import {
	initListAvailableTierSources,
	type ListAvailableTierSources,
} from "../../select-content/list-available-tier-sources";
import {
	initSelectMostCompleteContent,
	type CreateSelectorChatCompletion,
	type SelectMostCompleteContent,
} from "../../select-content/select-content";
import {
	initWriteCanonicalContent,
	type WriteCanonicalContent,
} from "../../select-content/promote-tier-to-canonical";
import {
	initFindContentSourceTier,
	type FindContentSourceTier,
} from "../../select-content/find-content-source-tier";

export type SelectContentDepBundle = {
	readTierSource: ReadTierSource;
	listAvailableTierSources: ListAvailableTierSources;
	selectMostCompleteContent: SelectMostCompleteContent;
	writeCanonicalContent: WriteCanonicalContent;
	findContentSourceTier: FindContentSourceTier;
};

export function initSelectContentDepBundle(deps: {
	s3Client: S3Client;
	dynamoClient: DynamoDBDocumentClient;
	contentBucketName: string;
	articlesTable: string;
	createChatCompletion: CreateSelectorChatCompletion;
	logger: HutchLogger;
}): SelectContentDepBundle {
	const { readTierSource } = initReadTierSource({
		client: deps.s3Client,
		bucketName: deps.contentBucketName,
		logger: deps.logger,
	});
	const { listAvailableTierSources } = initListAvailableTierSources({ readTierSource });
	const { selectMostCompleteContent } = initSelectMostCompleteContent({
		createChatCompletion: deps.createChatCompletion,
		logger: deps.logger,
	});
	const { writeCanonicalContent } = initWriteCanonicalContent({
		dynamoClient: deps.dynamoClient,
		s3Client: deps.s3Client,
		tableName: deps.articlesTable,
		bucketName: deps.contentBucketName,
	});
	const { findContentSourceTier } = initFindContentSourceTier({
		dynamoClient: deps.dynamoClient,
		tableName: deps.articlesTable,
	});
	return {
		readTierSource,
		listAvailableTierSources,
		selectMostCompleteContent,
		writeCanonicalContent,
		findContentSourceTier,
	};
}
