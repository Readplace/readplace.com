import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

/**
 * ECR repository for Lambda container images, scoped to image-based Lambdas
 * that ship native dependencies the standard zip path can't carry (e.g. the
 * `poppler-utils` binaries used by the OCR rasterizer).
 *
 * The lifecycle policy keeps the last 20 image tags so historical deploys can
 * be rolled back; older tags expire automatically rather than accumulating
 * unbounded storage cost.
 */
export class HutchEcrRepository extends pulumi.ComponentResource {
	public readonly repositoryUrl: pulumi.Output<string>;
	public readonly repositoryArn: pulumi.Output<string>;

	private constructor(
		name: string,
		repositoryUrl: pulumi.Output<string>,
		repositoryArn: pulumi.Output<string>,
		opts?: pulumi.ComponentResourceOptions,
	) {
		super("hutch:infra:HutchEcrRepository", name, {}, opts);
		this.repositoryUrl = repositoryUrl;
		this.repositoryArn = repositoryArn;
		this.registerOutputs({ repositoryUrl, repositoryArn });
	}

	static create(
		name: string,
		args: { repositoryName: string; keepLastNImages?: number },
		opts?: pulumi.ComponentResourceOptions,
	): HutchEcrRepository {
		const keep = args.keepLastNImages ?? 20;
		const repository = new aws.ecr.Repository(`${name}-ecr-repo`, {
			name: args.repositoryName,
			imageTagMutability: "MUTABLE",
		}, opts);

		new aws.ecr.LifecyclePolicy(`${name}-ecr-lifecycle`, {
			repository: repository.name,
			policy: JSON.stringify({
				rules: [{
					rulePriority: 1,
					description: `Keep only the last ${keep} images`,
					selection: {
						tagStatus: "any",
						countType: "imageCountMoreThan",
						countNumber: keep,
					},
					action: { type: "expire" },
				}],
			}),
		}, opts);

		return new HutchEcrRepository(name, repository.repositoryUrl, repository.arn, opts);
	}

	static fromExisting(args: {
		repositoryUrl: pulumi.Input<string>;
		repositoryArn: pulumi.Input<string>;
	}): HutchEcrRepository {
		return new HutchEcrRepository(
			"existing",
			pulumi.output(args.repositoryUrl),
			pulumi.output(args.repositoryArn),
		);
	}

	static fromPlatformStack(config: pulumi.Config): HutchEcrRepository {
		const platformStackName = config.require("platformStack");
		const stack = new pulumi.StackReference(platformStackName);
		const repositoryUrl = stack.requireOutput("ocrLambdaRepositoryUrl").apply(String);
		const repositoryArn = stack.requireOutput("ocrLambdaRepositoryArn").apply(String);
		return HutchEcrRepository.fromExisting({ repositoryUrl, repositoryArn });
	}
}
