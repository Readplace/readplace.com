/* c8 ignore start -- composition root, no logic to test */
import { SchedulerClient } from "@aws-sdk/client-scheduler";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { initAwsTrialScheduler } from "./providers/trial-scheduler/aws-trial-scheduler";
import { initScheduleTrialFeedbackEmailHandler } from "./schedule-trial-feedback-email/schedule-trial-feedback-email-handler";
import { requireEnv } from "./domain/require-env";

const eventBusArn = requireEnv("EVENT_BUS_ARN");
const trialSchedulerGroupName = requireEnv("TRIAL_SCHEDULER_GROUP_NAME");
const trialSchedulerRoleArn = requireEnv("TRIAL_SCHEDULER_ROLE_ARN");

const trialScheduler = initAwsTrialScheduler({
	client: new SchedulerClient({}),
	scheduleGroupName: trialSchedulerGroupName,
	schedulerRoleArn: trialSchedulerRoleArn,
	eventBusArn,
});

export const handler = initScheduleTrialFeedbackEmailHandler({
	createTrialFeedbackEmailSchedule: trialScheduler.createTrialFeedbackEmailSchedule,
	now: () => new Date(),
	logger: HutchLogger.from(consoleLogger),
});
/* c8 ignore stop */
