import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import assert from "node:assert";
import type { HutchLambda } from "./hutch-lambda";

export class HutchAPIGateway extends pulumi.ComponentResource {
	public readonly apiUrl: pulumi.Output<string> | string;
	public readonly defaultRoute: aws.apigatewayv2.Route;
	public readonly apiGatewayId: pulumi.Output<string>;
	public readonly apiGatewayExecutionArn: pulumi.Output<string>;

	constructor(
		name: string,
		args: {
			api: aws.apigatewayv2.Api;
			lambda: HutchLambda;
			stage: string;
			domains: string[];
			zoneId?: Promise<string>;
			certificateArn?: pulumi.Output<string>;
		},
		opts?: pulumi.ComponentResourceOptions,
	) {
		super("hutch:infra:HutchAPIGateway", name, {}, opts);

		this.apiGatewayId = args.api.id;
		this.apiGatewayExecutionArn = args.api.executionArn;

		const apiStage = new aws.apigatewayv2.Stage(`${name}-api-stage`, {
			apiId: args.api.id,
			name: "$default",
			autoDeploy: true,
			description: `${args.stage} stage`,
		}, { parent: this, aliases: [{ parent: pulumi.rootStackResource }] });

		const lambdaIntegration = new aws.apigatewayv2.Integration(
			`${name}-lambda-integration`,
			{
				apiId: args.api.id,
				integrationType: "AWS_PROXY",
				integrationUri: args.lambda.arn,
				payloadFormatVersion: "2.0",
			},
			{ parent: this, aliases: [{ parent: pulumi.rootStackResource }] },
		);

		this.defaultRoute = new aws.apigatewayv2.Route(
			`${name}-default-route`,
			{
				apiId: args.api.id,
				routeKey: "$default",
				target: pulumi.interpolate`integrations/${lambdaIntegration.id}`,
			},
			{ parent: this, aliases: [{ parent: pulumi.rootStackResource }] },
		);

		new aws.lambda.Permission(`${name}-api-gw-perm`, {
			statementId: `${name}-api-gw-perm`,
			action: "lambda:InvokeFunction",
			function: args.lambda.functionName,
			principal: "apigateway.amazonaws.com",
			sourceArn: pulumi.interpolate`${args.api.executionArn}/*/*`,
		}, { parent: this, aliases: [{ parent: pulumi.rootStackResource }] });

		if (args.domains.length > 0) {
			const primaryDomain = args.domains[0];
			assert(args.certificateArn, "certificateArn required when domains are provided");
			assert(args.zoneId, "zoneId required when domains are provided");

			for (const domain of args.domains) {
				const safeName = domain.replace(/\./g, "-");

				const customDomain = new aws.apigatewayv2.DomainName(
					`${name}-domain-${safeName}`,
					{
						domainName: domain,
						domainNameConfiguration: {
							certificateArn: args.certificateArn,
							endpointType: "REGIONAL",
							securityPolicy: "TLS_1_2",
						},
					},
					{ parent: this, aliases: [{ parent: pulumi.rootStackResource }] },
				);

				new aws.apigatewayv2.ApiMapping(
					`${name}-mapping-${safeName}`,
					{
						apiId: args.api.id,
						domainName: customDomain.domainName,
						stage: apiStage.id,
					},
					{ parent: this, aliases: [{ parent: pulumi.rootStackResource }] },
				);

				new aws.route53.Record(`${name}-record-${safeName}`, {
					zoneId: args.zoneId,
					name: domain,
					type: "A",
					aliases: [
						{
							name: customDomain.domainNameConfiguration.apply(
								(c) => c.targetDomainName,
							),
							zoneId: customDomain.domainNameConfiguration.apply(
								(c) => c.hostedZoneId,
							),
							evaluateTargetHealth: false,
						},
					],
				}, { parent: this, aliases: [{ parent: pulumi.rootStackResource }] });
			}

			this.apiUrl = `https://${primaryDomain}`;
		} else {
			this.apiUrl = pulumi.interpolate`${args.api.apiEndpoint}/${apiStage.name}`;
		}

		this.registerOutputs();
	}
}
