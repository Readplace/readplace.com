import * as pulumi from "@pulumi/pulumi";
import { HutchEcrRepository, HutchEventBus } from "@packages/hutch-infra-components/infra";

const config = new pulumi.Config();
const eventBusName = config.require("eventBusName");
const ocrLambdaRepositoryName = config.require("ocrLambdaRepositoryName");

const eventBus = HutchEventBus.create("hutch", { eventBusName });

const ocrLambdaRepository = HutchEcrRepository.create("hutch-ocr-lambda", {
	repositoryName: ocrLambdaRepositoryName,
});

export const hutchEventBusName = eventBus.eventBusName;
export const hutchEventBusArn = eventBus.eventBusArn;
export const ocrLambdaRepositoryUrl = ocrLambdaRepository.repositoryUrl;
export const ocrLambdaRepositoryArn = ocrLambdaRepository.repositoryArn;
