import type { DynamoDBDocumentClient } from "@packages/hutch-storage-client";
import {
	initTransitionAndPersist,
	type ArticleStore,
	type DispatchEffect,
	type TransitionAndPersist,
} from "@packages/domain/article-aggregate";
import { initDynamoDbArticleStore } from "../../article-aggregate/dynamodb-article-store";
import { initLambdaEffectDispatcher } from "../../article-aggregate/lambda-effect-dispatcher";
import type { EventsDepBundle } from "./events";

export type ArticleAggregateDepBundle = {
	store: ArticleStore;
	dispatchEffect: DispatchEffect;
	transitionAndPersist: TransitionAndPersist;
};

export function initArticleAggregateDepBundle(deps: {
	dynamoClient: DynamoDBDocumentClient;
	articlesTable: string;
	events: EventsDepBundle;
}): ArticleAggregateDepBundle {
	const { store } = initDynamoDbArticleStore({
		client: deps.dynamoClient,
		tableName: deps.articlesTable,
	});
	const { dispatchEffect } = initLambdaEffectDispatcher({
		dispatchGenerateSummary: deps.events.dispatchGenerateSummary,
		publishEvent: deps.events.publishEvent,
	});
	const { transitionAndPersist } = initTransitionAndPersist({ store, dispatchEffect });
	return { store, dispatchEffect, transitionAndPersist };
}
