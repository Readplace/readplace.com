import * as pulumi from "@pulumi/pulumi";
import { firefoxS3Config } from "browser-extension-core/s3-config";
import { S3PublicRead } from "@packages/infra-components/infra";
const { getBucketName } = firefoxS3Config;

const config = new pulumi.Config();
const stage = config.require("stage");

const publicBucket = new S3PublicRead("hutch-extension", {
	bucketName: getBucketName(stage),
	allowListBucket: true,
});

export const _dependencies: pulumi.Resource[] = [publicBucket.bucketPolicy];
