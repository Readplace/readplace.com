import {
	REFUSAL_MESSAGE,
	toDateTimeLocalInput,
	toExtendTrialViewModel,
} from "./extend-trial.view-model";

it("trims an ISO instant down to what datetime-local accepts", () => {
	expect(toDateTimeLocalInput("2026-10-15T03:52:32.114Z")).toBe("2026-10-15T03:52");
});

it("renders an empty form before any lookup", () => {
	const viewModel = toExtendTrialViewModel({ lookup: { kind: "none" } });

	expect(viewModel.email).toBe("");
	expect(viewModel.ready).toBe(false);
	expect(viewModel.refused).toBe(false);
	expect(viewModel.notFound).toBe(false);
	expect(viewModel.extended).toBe(false);
});

it("flags an unknown email", () => {
	const viewModel = toExtendTrialViewModel({
		lookup: { kind: "not-found", email: "nobody@example.com" },
	});

	expect(viewModel.notFound).toBe(true);
	expect(viewModel.email).toBe("nobody@example.com");
	expect(viewModel.ready).toBe(false);
});

it("carries the refusal message and the status that caused it", () => {
	const viewModel = toExtendTrialViewModel({
		lookup: {
			kind: "refused",
			email: "paid@example.com",
			status: "active",
			message: REFUSAL_MESSAGE["paid-subscription"],
		},
	});

	expect(viewModel.refused).toBe(true);
	expect(viewModel.status).toBe("active");
	expect(viewModel.refusalMessage).toContain("Stripe subscription");
	expect(viewModel.ready).toBe(false);
});

it("exposes the current window and the prefilled input when extendable", () => {
	const viewModel = toExtendTrialViewModel({
		lookup: {
			kind: "ready",
			email: "alex@example.com",
			status: "cancelled",
			currentTrialEndsAt: "2026-10-15T03:52:32.114Z",
			trialEndsAtInput: "2026-10-15T03:52",
		},
		extended: true,
	});

	expect(viewModel.ready).toBe(true);
	expect(viewModel.status).toBe("cancelled");
	expect(viewModel.hasCurrentTrialEndsAt).toBe(true);
	expect(viewModel.currentTrialEndsAt).toBe("2026-10-15T03:52:32.114Z");
	expect(viewModel.trialEndsAtInput).toBe("2026-10-15T03:52");
	expect(viewModel.extended).toBe(true);
});

it("reports a user with no window at all", () => {
	const viewModel = toExtendTrialViewModel({
		lookup: {
			kind: "ready",
			email: "alex@example.com",
			status: "cancelled",
			currentTrialEndsAt: undefined,
			trialEndsAtInput: "2026-07-26T00:00",
		},
	});

	expect(viewModel.hasCurrentTrialEndsAt).toBe(false);
	expect(viewModel.currentTrialEndsAt).toBeUndefined();
});

it("splits field errors from the global error", () => {
	const viewModel = toExtendTrialViewModel({
		lookup: { kind: "none" },
		errors: [
			{ fieldName: "email", message: "Enter a valid email address" },
			{ fieldName: "trialEndsAt", message: "Choose a date and time" },
			{ message: "Could not arm the trial schedules." },
		],
	});

	expect(viewModel.emailError).toBe("Enter a valid email address");
	expect(viewModel.trialEndsAtError).toBe("Choose a date and time");
	expect(viewModel.globalError).toBe("Could not arm the trial schedules.");
});
