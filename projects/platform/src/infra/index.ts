import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { HutchEcrRepository, HutchEventBus } from "@packages/hutch-infra-components/infra";

const config = new pulumi.Config();
const eventBusName = config.require("eventBusName");
const ocrLambdaRepositoryName = config.require("ocrLambdaRepositoryName");

const eventBus = HutchEventBus.create("hutch", { eventBusName });

const ocrLambdaRepository = HutchEcrRepository.create("hutch-ocr-lambda", {
	repositoryName: ocrLambdaRepositoryName,
	keepLastNImages: 200,
});

// The curl_chrome131 bash wrapper + statically-linked curl-impersonate binary
// (BoringSSL embedded) that produce a Chrome TLS fingerprint, bypassing
// Akamai/Cloudflare JA3/JA4 blocks. It lives here rather than in the one
// project that first shipped it because three project stacks (save-link, inbox,
// hutch) each run the crawl fallback chain and so need the binary — and
// deploy-platform runs before the project matrix, so the ARN is persisted
// before any consumer reads it via StackReference.
const curlImpersonateLayer = new aws.lambda.LayerVersion("curl-impersonate", {
	layerName: "curl-impersonate-chrome",
	compatibleRuntimes: [aws.lambda.Runtime.NodeJS22dX],
	code: new pulumi.asset.FileArchive(".lib/curl-impersonate-layer.zip"),
	description: "curl-impersonate Chrome variant (curl_chrome131) for TLS fingerprint bypass",
});

export const hutchEventBusName = eventBus.eventBusName;
export const hutchEventBusArn = eventBus.eventBusArn;
export const ocrLambdaRepositoryUrl = ocrLambdaRepository.repositoryUrl;
export const ocrLambdaRepositoryArn = ocrLambdaRepository.repositoryArn;
export const curlImpersonateLayerArn = curlImpersonateLayer.arn;
