package com.readplace.android.core

import org.junit.Assert.assertEquals
import org.junit.Test

class AgeSignalTest {
	@Test
	fun `an upper bound of 12 or less is under 13`() {
		assertEquals(AgeRange.UNDER_13, AgeRange.of(lower = 0, upper = 12))
		assertEquals(AgeRange.UNDER_13, AgeRange.of(lower = null, upper = 9))
	}

	@Test
	fun `a range that straddles 13 is under 13`() {
		assertEquals(AgeRange.UNDER_13, AgeRange.of(lower = 10, upper = 15))
		assertEquals(AgeRange.UNDER_13, AgeRange.of(lower = null, upper = 15))
		assertEquals(AgeRange.UNDER_13, AgeRange.of(lower = 12, upper = null))
	}

	@Test
	fun `a lower bound of 18 or more is 18 plus`() {
		assertEquals(AgeRange.ADULT, AgeRange.of(lower = 18, upper = null))
		assertEquals(AgeRange.ADULT, AgeRange.of(lower = 21, upper = 30))
	}

	@Test
	fun `a lower bound of 16 or 17 is 16 to 17`() {
		assertEquals(AgeRange.FROM_16_TO_17, AgeRange.of(lower = 16, upper = 17))
	}

	@Test
	fun `a lower bound of 13 to 15 is 13 to 15`() {
		assertEquals(AgeRange.FROM_13_TO_15, AgeRange.of(lower = 13, upper = 15))
	}

	@Test
	fun `no bounds at all is the verified adult Play shares`() {
		assertEquals(AgeRange.ADULT, AgeRange.of(lower = null, upper = null))
	}

	@Test
	fun `each range and approval carries the server's wire value`() {
		assertEquals(listOf("under-13", "13-15", "16-17", "18-plus"), AgeRange.entries.map { it.wire })
		assertEquals(listOf("none-reported", "approved", "pending", "denied"), ParentalApproval.entries.map { it.wire })
	}

	@Test
	fun `no store answer, a declined share and an allowed age continue`() {
		assertEquals(AgeDecision.Allowed, AgeDecision.of(AgeSignal.NotApplicable))
		assertEquals(AgeDecision.Allowed, AgeDecision.of(AgeSignal.Declined))
		assertEquals(AgeDecision.Allowed, AgeDecision.of(AgeSignal.Known(AgeRange.FROM_13_TO_15, ParentalApproval.NONE_REPORTED)))
		assertEquals(AgeDecision.Allowed, AgeDecision.of(AgeSignal.Known(AgeRange.FROM_16_TO_17, ParentalApproval.APPROVED)))
	}

	@Test
	fun `a verification the store needs is a prompt`() {
		assertEquals(AgeDecision.PromptVerification, AgeDecision.of(AgeSignal.VerificationRequired))
	}

	@Test
	fun `under 13 is refused whatever the approval`() {
		val known = AgeSignal.Known(AgeRange.UNDER_13, ParentalApproval.APPROVED)
		assertEquals(AgeDecision.Refused(AgeRefusal.UNDER_13, known), AgeDecision.of(known))
	}

	@Test
	fun `a pending or denied approval is refused`() {
		for (approval in listOf(ParentalApproval.PENDING, ParentalApproval.DENIED)) {
			val known = AgeSignal.Known(AgeRange.FROM_13_TO_15, approval)
			assertEquals(AgeDecision.Refused(AgeRefusal.PARENTAL_APPROVAL_MISSING, known), AgeDecision.of(known))
		}
	}
}
