package com.readplace.android.app

import com.readplace.android.core.AuthFlowError
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SignInErrorTest {
	@Test
	fun `a failure without a message shows a plain fallback rather than nothing`() {
		assertEquals(
			"a null-message throwable must not leave the sign-in screen silent",
			"Could not sign in. Please try again.",
			signInErrorText(Result.failure(Exception())),
		)
	}

	@Test
	fun `a failure keeps its own supplied message`() {
		assertEquals(
			"a throwable that explains itself is shown as-is, not replaced by the fallback",
			"Security check failed (state mismatch).",
			signInErrorText(Result.failure(AuthFlowError.StateMismatch())),
		)
	}

	@Test
	fun `a dismissal is a choice, not an error to report`() {
		assertNull("a null outcome is the reader closing the sheet", signInErrorText(null))
	}

	@Test
	fun `a success reports no error`() {
		assertNull(signInErrorText(Result.success(Unit)))
	}
}
