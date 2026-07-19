interface S3ConfigOptions {
	bucketNamePrefix: string;
	region: string;
}

function createS3Config(options: S3ConfigOptions) {
	const { bucketNamePrefix, region } = options;

	function getBucketName(stage: string): string {
		return `${bucketNamePrefix}-${stage}`;
	}

	function getBucketBaseUrl(stage: string): string {
		return `https://${getBucketName(stage)}.s3.${region}.amazonaws.com`;
	}

	function getExtensionDownloadUrl(args: {
		stage: string;
		filename: string;
	}): string {
		return `${getBucketBaseUrl(args.stage)}/${args.filename}`;
	}

	function getLatestPointerUrl(stage: string): string {
		return `${getBucketBaseUrl(stage)}/latest.txt`;
	}

	function getUpdateManifestUrl(
		stage: string,
		manifestFilename: string,
	): string {
		return `${getBucketBaseUrl(stage)}/${manifestFilename}`;
	}

	return {
		getBucketName,
		getBucketBaseUrl,
		getExtensionDownloadUrl,
		getLatestPointerUrl,
		getUpdateManifestUrl,
	};
}

export const firefoxS3Config = createS3Config({
	bucketNamePrefix: "hutch-extension",
	region: "ap-southeast-2",
});
