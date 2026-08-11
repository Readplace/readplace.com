export const EXPERIMENT_RESULT_STREAM = "experiments";

export const RELATED_PAST_READS_EXPERIMENT = "related-past-reads";

export const RELATED_ARM_IDS = ["A", "B", "C"] as const;

export type RelatedArmId = (typeof RELATED_ARM_IDS)[number];

export interface ExperimentArmResultEvent {
	stream: typeof EXPERIMENT_RESULT_STREAM;
	event: "arm-result";
	timestamp: string;
	experiment: typeof RELATED_PAST_READS_EXPERIMENT;
	run_id: string;
	arm: RelatedArmId;
	anchor_url: string;
	repeat: number;
	picks: number;
	unread_picks: number;
	read_picks: number;
	unread_pool: number;
	read_pool: number;
	input_tokens: number;
	output_tokens: number;
	latency_ms: number;
	over_production_timeout: boolean;
	failed: boolean;
}
