import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import assert from "node:assert";
import {
	EDGE_SECRET_HEADER,
	VIEWER_HOST_HEADER,
	VIEWER_IP_HEADER,
} from "@packages/viewer-identity";

const AWS_MANAGED_CACHING_DISABLED_POLICY_ID = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad";
const AWS_MANAGED_ALL_VIEWER_EXCEPT_HOST_HEADER_POLICY_ID = "b689b0a8-53d0-40ab-baf2-68738e2966ac";

const EVERY_HTTP_METHOD = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"];
const ONLY_CACHEABLE_METHODS = ["GET", "HEAD"];

const SERVER_TIMING_SAMPLED_PERCENT_OF_RESPONSES = 5;
const ORIGIN_CONNECTION_REUSE_SECONDS = 60;

export interface SsrCdnArgs {
	domain: string;
	apiOwnEndpoint: pulumi.Input<string>;
	originReadTimeoutSeconds: number;
	edgeSecret: pulumi.Input<string>;
}

function hostOf(endpoint: pulumi.Input<string>): pulumi.Output<string> {
	return pulumi.output(endpoint).apply((url) => new URL(url).host);
}

function regionOf(executeApiEndpoint: pulumi.Input<string>): pulumi.Output<string> {
	return hostOf(executeApiEndpoint).apply((host) => {
		const region = host.split(".")[2];
		assert(region, `expected an execute-api host carrying a region, got ${host}`);
		return region;
	});
}

function withoutTrailingDot(fqdn: string): string {
	return fqdn.replace(/\.$/, "");
}

export class HutchSsrCdn extends pulumi.ComponentResource {
	public readonly domainName: pulumi.Output<string>;
	public readonly hostedZoneId: pulumi.Output<string>;
	public readonly distributionId: pulumi.Output<string>;

	constructor(name: string, args: SsrCdnArgs, opts?: pulumi.ComponentResourceOptions) {
		super("hutch:infra:HutchSsrCdn", name, {}, opts);

		const usEast1 = new aws.Provider(`${name}-us-east-1`, { region: "us-east-1" }, { parent: this });

		const certificate = new aws.acm.Certificate(
			`${name}-cert`,
			{ domainName: args.domain, validationMethod: "DNS" },
			{ provider: usEast1, parent: this },
		);

		const validationRecordsAlreadyPublishedInTheZone =
			certificate.domainValidationOptions.apply((options) =>
				options.map((option) => withoutTrailingDot(option.resourceRecordName)),
			);

		const validated = new aws.acm.CertificateValidation(
			`${name}-cert-validated`,
			{
				certificateArn: certificate.arn,
				validationRecordFqdns: validationRecordsAlreadyPublishedInTheZone,
			},
			{ provider: usEast1, parent: this },
		);

		const stateViewerAddressAndHost = new aws.cloudfront.Function(
			`${name}-viewer-headers`,
			{
				runtime: "cloudfront-js-2.0",
				publish: true,
				code: `function handler(event) {
	var request = event.request;
	delete request.headers['${EDGE_SECRET_HEADER}'];
	request.headers['${VIEWER_IP_HEADER}'] = { value: event.viewer.ip };
	request.headers['${VIEWER_HOST_HEADER}'] = { value: request.headers.host.value };
	return request;
}`,
			},
			{ parent: this },
		);

		const sampleOriginConnectTiming = new aws.cloudfront.ResponseHeadersPolicy(
			`${name}-server-timing`,
			{
				name: `${name}-server-timing`,
				serverTimingHeadersConfig: {
					enabled: true,
					samplingRate: SERVER_TIMING_SAMPLED_PERCENT_OF_RESPONSES,
				},
			},
			{ parent: this },
		);

		const distribution = new aws.cloudfront.Distribution(
			`${name}-cdn`,
			{
				enabled: true,
				aliases: [args.domain],
				httpVersion: "http2and3",
				origins: [
					{
						originId: "ssr-origin",
						domainName: hostOf(args.apiOwnEndpoint),
						originShield: {
							enabled: true,
							originShieldRegion: regionOf(args.apiOwnEndpoint),
						},
						customOriginConfig: {
							httpPort: 80,
							httpsPort: 443,
							originProtocolPolicy: "https-only",
							originSslProtocols: ["TLSv1.2"],
							originReadTimeout: args.originReadTimeoutSeconds,
							originKeepaliveTimeout: ORIGIN_CONNECTION_REUSE_SECONDS,
						},
						customHeaders: [{ name: EDGE_SECRET_HEADER, value: args.edgeSecret }],
					},
				],
				defaultCacheBehavior: {
					targetOriginId: "ssr-origin",
					viewerProtocolPolicy: "redirect-to-https",
					allowedMethods: EVERY_HTTP_METHOD,
					cachedMethods: ONLY_CACHEABLE_METHODS,
					cachePolicyId: AWS_MANAGED_CACHING_DISABLED_POLICY_ID,
					originRequestPolicyId: AWS_MANAGED_ALL_VIEWER_EXCEPT_HOST_HEADER_POLICY_ID,
					responseHeadersPolicyId: sampleOriginConnectTiming.id,
					compress: false,
					functionAssociations: [
						{ eventType: "viewer-request", functionArn: stateViewerAddressAndHost.arn },
					],
				},
				restrictions: { geoRestriction: { restrictionType: "none" } },
				viewerCertificate: {
					acmCertificateArn: validated.certificateArn,
					sslSupportMethod: "sni-only",
					minimumProtocolVersion: "TLSv1.2_2021",
				},
				// The only class with AU/NZ edges — the cheaper ones route Sydney
				// viewers via San Francisco
				priceClass: "PriceClass_All",
			},
			{ parent: this },
		);

		this.domainName = distribution.domainName;
		this.hostedZoneId = distribution.hostedZoneId;
		this.distributionId = distribution.id;
		this.registerOutputs();
	}
}
