package com.readplace.android.app

import com.readplace.android.core.AgeRange
import com.readplace.android.core.AgeRefusal
import com.readplace.android.core.AgeReport
import com.readplace.android.core.AgeSignal
import com.readplace.android.core.ParentalApproval
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AgeGateTest {
	private class Harness(
		scope: TestScope,
		signal: AgeSignal,
		loggedIn: Boolean,
		reports: List<AgeReport> = emptyList(),
	) {
		val sent = mutableListOf<Pair<AgeRange, ParentalApproval>>()
		var reads = 0
		var forcedLogouts = 0
		private val remaining = reports.toMutableList()
		val gate = AgeGate(
			source = {
				reads += 1
				signal
			},
			isLoggedIn = { loggedIn },
			report = { range, approval ->
				sent += range to approval
				remaining.removeAt(0)
			},
			forceLogout = { forcedLogouts += 1 },
			scope = scope,
		)
	}

	private val under13 = AgeSignal.Known(AgeRange.UNDER_13, ParentalApproval.NONE_REPORTED)
	private val pending = AgeSignal.Known(AgeRange.FROM_13_TO_15, ParentalApproval.PENDING)

	@Test
	fun `the gate checks before it decides and reads the store once per launch`() = runTest {
		val harness = Harness(this, AgeSignal.NotApplicable, loggedIn = true)
		assertEquals(AgeGateState.Checking, harness.gate.state.value)

		harness.gate.start()
		harness.gate.start()
		runCurrent()

		assertEquals(AgeGateState.Clear, harness.gate.state.value)
		assertEquals(1, harness.reads)
	}

	@Test
	fun `a declined share or an allowed age clears without reporting`() = runTest {
		for (signal in listOf(AgeSignal.Declined, AgeSignal.Known(AgeRange.ADULT, ParentalApproval.NONE_REPORTED))) {
			val harness = Harness(this, signal, loggedIn = true)
			harness.gate.start()
			runCurrent()

			assertEquals(AgeGateState.Clear, harness.gate.state.value)
			assertTrue(harness.sent.isEmpty())
		}
	}

	@Test
	fun `a verification the store needs is a prompt the reader can dismiss`() = runTest {
		val harness = Harness(this, AgeSignal.VerificationRequired, loggedIn = false)
		harness.gate.start()
		runCurrent()
		assertEquals(AgeGateState.VerificationPrompt, harness.gate.state.value)
		assertTrue(harness.gate.awaitAllowsSignIn())

		harness.gate.dismissVerification()

		assertEquals(AgeGateState.Clear, harness.gate.state.value)
	}

	@Test
	fun `dismissing outside the prompt changes nothing`() = runTest {
		val harness = Harness(this, under13, loggedIn = false)
		harness.gate.start()
		runCurrent()

		harness.gate.dismissVerification()

		assertEquals(AgeGateState.Refused(AgeRefusal.UNDER_13, serverMessage = null), harness.gate.state.value)
	}

	@Test
	fun `sign-in waits for the check and is refused when the age is`() = runTest {
		val harness = Harness(this, under13, loggedIn = false)
		val allows = async { harness.gate.awaitAllowsSignIn() }
		runCurrent()
		assertFalse(allows.isCompleted)

		harness.gate.start()
		runCurrent()

		assertFalse(allows.await())
		assertTrue("a signed-out device has nothing to report", harness.sent.isEmpty())
	}

	@Test
	fun `a signed-in refusal is reported and the server's answer signs the device out`() = runTest {
		val harness = Harness(this, pending, loggedIn = true, reports = listOf(AgeReport.Refused("Ask a parent.")))
		harness.gate.start()
		runCurrent()

		assertEquals(listOf(AgeRange.FROM_13_TO_15 to ParentalApproval.PENDING), harness.sent)
		assertEquals(AgeGateState.Refused(AgeRefusal.PARENTAL_APPROVAL_MISSING, "Ask a parent."), harness.gate.state.value)
		assertEquals(1, harness.forcedLogouts)

		harness.gate.onForeground()
		runCurrent()
		assertEquals("a settled report is never sent again", 1, harness.sent.size)
	}

	@Test
	fun `an unknown answer keeps the refusal and the credentials and retries on the next foreground`() = runTest {
		val harness = Harness(
			this,
			under13,
			loggedIn = true,
			reports = listOf(AgeReport.Unknown, AgeReport.Refused(null)),
		)
		harness.gate.start()
		runCurrent()

		assertEquals(AgeGateState.Refused(AgeRefusal.UNDER_13, serverMessage = null), harness.gate.state.value)
		assertEquals(0, harness.forcedLogouts)

		harness.gate.onForeground()
		runCurrent()

		assertEquals(2, harness.sent.size)
		assertEquals(1, harness.forcedLogouts)
	}

	@Test
	fun `a foreground during a report in flight sends no second report`() = runTest {
		val answer = CompletableDeferred<AgeReport>()
		var sent = 0
		val gate = AgeGate(
			source = { under13 },
			isLoggedIn = { true },
			report = { _, _ ->
				sent += 1
				answer.await()
			},
			forceLogout = {},
			scope = this,
		)
		gate.start()
		runCurrent()

		gate.onForeground()
		runCurrent()
		answer.complete(AgeReport.Unknown)
		runCurrent()

		assertEquals(1, sent)
	}

	@Test
	fun `a server that allows what the device refused keeps the refusal up without signing out`() = runTest {
		val harness = Harness(this, under13, loggedIn = true, reports = listOf(AgeReport.Allowed))
		harness.gate.start()
		runCurrent()

		assertEquals(AgeGateState.Refused(AgeRefusal.UNDER_13, serverMessage = null), harness.gate.state.value)
		assertEquals(0, harness.forcedLogouts)
	}

	@Test
	fun `the refusal shows the server's sentence, or the app's own for each refusal`() {
		assertEquals("Ask a parent.", ageRefusalText(AgeRefusal.UNDER_13, "Ask a parent."))
		assertEquals("Readplace is for people 13 and over.", ageRefusalText(AgeRefusal.UNDER_13, null))
		assertEquals(
			"A parent or guardian needs to approve Readplace in the app store before you can use it.",
			ageRefusalText(AgeRefusal.PARENTAL_APPROVAL_MISSING, null),
		)
	}
}
