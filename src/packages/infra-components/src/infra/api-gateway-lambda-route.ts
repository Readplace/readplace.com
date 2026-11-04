import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import type { Lambda } from "./lambda";

export class APIGatewayLambdaRoute extends pulumi.ComponentResource {
	public readonly integration: aws.apigatewayv2.Integration;
	public readonly routes: aws.apigatewayv2.Route[];

	constructor(
		name: string,
		args: {
			apiGatewayId: pulumi.Input<string>;
			apiGatewayExecutionArn: pulumi.Input<string>;
			lambda: Lambda;
			routeKeys: string[];
		},
		opts?: pulumi.ComponentResourceOptions,
	) {
		super("hutch:infra:HutchAPIGatewayLambdaRoute", name, {}, opts);

		this.integration = new aws.apigatewayv2.Integration(
			`${name}-integration`,
			{
				apiId: args.apiGatewayId,
				integrationType: "AWS_PROXY",
				integrationUri: args.lambda.arn,
				payloadFormatVersion: "2.0",
			},
			{ parent: this },
		);

		this.routes = args.routeKeys.map(
			(routeKey, index) =>
				new aws.apigatewayv2.Route(
					`${name}-route-${index}`,
					{
						apiId: args.apiGatewayId,
						routeKey,
						target: pulumi.interpolate`integrations/${this.integration.id}`,
					},
					{ parent: this },
				),
		);

		new aws.lambda.Permission(
			`${name}-api-gw-perm`,
			{
				statementId: `${name}-api-gw-perm`,
				action: "lambda:InvokeFunction",
				function: args.lambda.functionName,
				principal: "apigateway.amazonaws.com",
				sourceArn: pulumi.interpolate`${args.apiGatewayExecutionArn}/*/*`,
			},
			{ parent: this },
		);

		this.registerOutputs();
	}
}
