import * as pulumi from "@pulumi/pulumi";
import { firefoxS3Config } from "browser-extension-core/s3-config";
import { HutchS3PublicRead } from "@packages/hutch-infra-components/infra";
const { getBucketName } = firefoxS3Config;

const config = new pulumi.Config();
const stage = config.require("stage");

const publicBucket = new HutchS3PublicRead("hutch-extension", {
	bucketName: getBucketName(stage),
	allowListBucket: true,
});

export const bucketUrl = pulumi.interpolate`https://${publicBucket.bucketRegionalDomainName}`;
export const _dependencies: pulumi.Resource[] = [publicBucket.bucketPolicy];
