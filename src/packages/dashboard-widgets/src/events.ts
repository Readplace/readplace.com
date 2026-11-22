export const CONVERSION_EVENTS = {
	userCreated: "user_created",
} as const;

export const SUBSCRIPTION_EVENTS = {
	chargeSucceeded: "charge_succeeded",
	chargeFailed: "charge_failed",
	cancelled: "cancelled",
	checkoutStarted: "checkout_started",
	checkoutCompleted: "checkout_completed",
	checkoutReturnFailed: "checkout_return_failed",
	resubscribeCompleted: "resubscribe_completed",
} as const;

export const LIFECYCLE_EMAIL_EVENTS = {
	sent: "lifecycle_email_sent",
} as const;

export const ENGAGEMENT_EVENTS = {
	assigned: "starter_assigned",
	inserted: "starter_inserted",
	suppressed: "starter_suppressed",
	failure: "starter_failure",
	sent: "starter_sent",
	activity: "engagement_activity",
	report: "starter_report",
} as const;
