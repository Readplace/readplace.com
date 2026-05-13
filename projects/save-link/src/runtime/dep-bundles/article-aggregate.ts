import type { DynamoDBDocumentClient } from "@packages/hutch-storage-client";
import {
	initTransitionAndPersist,
	type ArticleStore,
	type DispatchEffect,
	type TransitionAndPersist,
	type UpsertAndPersist,
} from "@packages/domain/article-aggregate";
import { initDynamoDbArticleStore } from "@packages/article-store";
import { initLambdaEffectDispatcher } from "../../article-aggregate/lambda-effect-dispatcher";
import type { EventsDepBundle } from "./events";

export type ArticleAggregateDepBundle = {
	store: ArticleStore;
	dispatchEffect: DispatchEffect;
	transitionAndPersist: TransitionAndPersist;
	upsertAndPersist: UpsertAndPersist;
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
		dispatchSubmitLink: deps.events.dispatchSubmitLink,
		publishEvent: deps.events.publishEvent,
	});
	const { transitionAndPersist, upsertAndPersist } = initTransitionAndPersist({
		store,
		dispatchEffect,
	});
	return { store, dispatchEffect, transitionAndPersist, upsertAndPersist };
}
