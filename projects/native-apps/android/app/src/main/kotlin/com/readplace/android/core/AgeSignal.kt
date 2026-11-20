package com.readplace.android.core

enum class AgeRange(val wire: String) {
	UNDER_13("under-13"),
	FROM_13_TO_15("13-15"),
	FROM_16_TO_17("16-17"),
	ADULT("18-plus"),
	;

	companion object {
		fun of(lower: Int?, upper: Int?): AgeRange {
			if (lower == null && upper == null) return ADULT
			if (upper != null && upper <= 12) return UNDER_13
			if (lower == null || lower < 13) return UNDER_13
			if (lower >= 18) return ADULT
			if (lower >= 16) return FROM_16_TO_17
			return FROM_13_TO_15
		}
	}
}

enum class ParentalApproval(val wire: String) {
	NONE_REPORTED("none-reported"),
	APPROVED("approved"),
	PENDING("pending"),
	DENIED("denied"),
}

sealed interface AgeSignal {
	data object NotApplicable : AgeSignal

	data object VerificationRequired : AgeSignal

	data object Declined : AgeSignal

	data class Known(val range: AgeRange, val approval: ParentalApproval) : AgeSignal
}

fun interface AgeSignalSource {
	suspend fun read(): AgeSignal
}

enum class AgeRefusal {
	UNDER_13,
	PARENTAL_APPROVAL_MISSING,
}

sealed interface AgeDecision {
	data object Allowed : AgeDecision

	data object PromptVerification : AgeDecision

	data class Refused(val refusal: AgeRefusal, val known: AgeSignal.Known) : AgeDecision

	companion object {
		fun of(signal: AgeSignal): AgeDecision = when (signal) {
			AgeSignal.NotApplicable, AgeSignal.Declined -> Allowed
			AgeSignal.VerificationRequired -> PromptVerification
			is AgeSignal.Known -> when {
				signal.range == AgeRange.UNDER_13 -> Refused(AgeRefusal.UNDER_13, signal)
				signal.approval == ParentalApproval.PENDING || signal.approval == ParentalApproval.DENIED ->
					Refused(AgeRefusal.PARENTAL_APPROVAL_MISSING, signal)
				else -> Allowed
			}
		}
	}
}

sealed interface AgeReport {
	data object Allowed : AgeReport

	data class Refused(val message: String?) : AgeReport

	data object Unknown : AgeReport
}
