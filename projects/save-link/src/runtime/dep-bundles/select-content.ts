import { initCanonicalAliasStore } from "@packages/article-store";
import { initSelectionSourceIdentity } from "./source-identity";
import { initFindArticleContent, type FindArticleContent } from "../providers/article-store/find-article-content";
import type { VerifyWrapperSource } from "@packages/save-article";
import type { S3Client } from "@aws-sdk/client-s3";
import type { HutchLogger } from "@packages/hutch-logger";
import type { DynamoDBDocumentClient } from "@packages/hutch-storage-client";
import {
	initReadTierSource,
	type ReadTierSource,
} from "../providers/article-store/read-tier-source";
import {
	initListAvailableTierSources,
	type ListAvailableTierSources,
} from "../domain/select-content/list-available-tier-sources";
import {
	initSelectMostCompleteContent,
	type CreateSelectorChatCompletion,
	type SelectMostCompleteContent,
} from "../domain/select-content/select-content";
import {
	initWriteCanonicalContent,
	type WriteCanonicalContent,
} from "../providers/article-store/promote-tier-to-canonical";
import {
	initRecordCrawlVersion,
	type RecordCrawlVersion,
} from "../providers/article-store/record-crawl-version";

export type SelectContentDepBundle = {
	resolveOriginalUrl: (url: string) => Promise<string>;
	verifyWrapperSource: VerifyWrapperSource;
	readTierSource: ReadTierSource;
	listAvailableTierSources: ListAvailableTierSources;
	selectMostCompleteContent: SelectMostCompleteContent;
	writeCanonicalContent: WriteCanonicalContent;
	recordCrawlVersion: RecordCrawlVersion;
	readCanonicalContent: FindArticleContent;
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
		s3Client: deps.s3Client,
		bucketName: deps.contentBucketName,
	});
	const { recordCrawlVersion } = initRecordCrawlVersion({
		dynamoClient: deps.dynamoClient,
		tableName: deps.articlesTable,
	});
	const identities = initCanonicalAliasStore({ client: deps.dynamoClient, tableName: deps.articlesTable });
	const sourceIdentity = initSelectionSourceIdentity({ findIdentityRow: identities.findIdentityRow });
	return {
		...sourceIdentity,
		readCanonicalContent: initFindArticleContent({ dynamoClient: deps.dynamoClient, s3Client: deps.s3Client, tableName: deps.articlesTable }).findArticleContent,
		readTierSource,
		listAvailableTierSources,
		selectMostCompleteContent,
		writeCanonicalContent,
		recordCrawlVersion,
	};
}
