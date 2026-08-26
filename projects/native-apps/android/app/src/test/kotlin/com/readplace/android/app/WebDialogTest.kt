package com.readplace.android.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The panel-kind → native-dialog mapping is pure: each JS dialog kind carries the
 * exact choices the `AlertDialog` glue renders verbatim, plus the answer an
 * unpresentable dialog (a web view with no window) must give — the page's script
 * must never hang on an unanswered completion handler.
 */
class WebDialogTest {
	@Test
	fun `confirm maps to a cancel and a destructive OK`() {
		// window.confirm() keeps the browser's two-button semantics; the affirmative
		// choice is destructive-styled because a page only reaches for a confirm to
		// gate something it can't take back.
		val dialog = WebDialog.confirm(message = "Delete your account? This cannot be undone.")
		assertEquals("Delete your account? This cannot be undone.", dialog.message)
		assertEquals(
			listOf(
				WebDialog.Choice(title = "Cancel", style = WebDialog.Choice.Style.CANCEL, answer = false),
				WebDialog.Choice(title = "OK", style = WebDialog.Choice.Style.DESTRUCTIVE, answer = true),
			),
			dialog.choices,
		)
	}

	@Test
	fun `an unpresentable confirm refuses the action it gates`() {
		assertFalse(
			"a confirm that cannot be shown must refuse — never affirm — the destructive action it gates",
			WebDialog.confirm(message = "Delete?").unpresentedAnswer,
		)
	}

	@Test
	fun `alert maps to a single acknowledging OK`() {
		val dialog = WebDialog.alert(message = "Saved.")
		assertEquals("Saved.", dialog.message)
		assertEquals(
			listOf(WebDialog.Choice(title = "OK", style = WebDialog.Choice.Style.DEFAULT, answer = true)),
			dialog.choices,
		)
		assertTrue(
			"an alert only acknowledges, so its unpresented answer completes without refusing anything",
			dialog.unpresentedAnswer,
		)
	}
}
