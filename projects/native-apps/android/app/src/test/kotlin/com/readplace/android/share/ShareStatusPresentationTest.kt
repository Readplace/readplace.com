package com.readplace.android.share

import com.readplace.android.core.ServerMessage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ShareStatusPresentationTest {
	private fun present(outcome: SaveSharedOutcome): ShareStatusPresentation =
		ShareStatusPresentation.of(outcome)

	private fun message(type: String, body: String = "x"): ServerMessage =
		ServerMessage(type = type, content = ServerMessage.Content(type = "text/html", body = body))

	@Test
	fun `saved with no messages is a bare success`() {
		assertEquals(
			ShareStatusPresentation(
				message = "Saved",
				subtitle = null,
				icon = ShareStatusIcon.CHECKMARK,
				tone = ShareStatusTone.SUCCESS,
			),
			present(SaveSharedOutcome.Saved(emptyList())),
		)
	}

	@Test
	fun `saved carries one server confirmation as its footnote`() {
		assertEquals(
			ShareStatusPresentation(
				message = "Saved",
				subtitle = "Article saved",
				icon = ShareStatusIcon.CHECKMARK,
				tone = ShareStatusTone.SUCCESS,
			),
			present(SaveSharedOutcome.Saved(listOf(message(type = "success", body = "Article saved")))),
		)
	}

	@Test
	fun `saved joins several server confirmations in order under a Saved title`() {
		assertEquals(
			ShareStatusPresentation(
				message = "Saved",
				subtitle = "Article saved\nSaved to your reading list",
				icon = ShareStatusIcon.CHECKMARK,
				tone = ShareStatusTone.SUCCESS,
			),
			present(
				SaveSharedOutcome.Saved(
					listOf(
						message(type = "success", body = "Article saved"),
						message(type = "success", body = "Saved to your reading list"),
					),
				),
			),
		)
	}

	@Test
	fun `saved awaiting upload with no messages reads the same as any save`() {
		assertEquals(
			ShareStatusPresentation(
				message = "Saved",
				subtitle = null,
				icon = ShareStatusIcon.CHECKMARK,
				tone = ShareStatusTone.SUCCESS,
			),
			present(SaveSharedOutcome.SavedAwaitingUpload(emptyList())),
		)
	}

	@Test
	fun `saved awaiting upload carries one server confirmation as its footnote`() {
		assertEquals(
			ShareStatusPresentation(
				message = "Saved",
				subtitle = "Article saved",
				icon = ShareStatusIcon.CHECKMARK,
				tone = ShareStatusTone.SUCCESS,
			),
			present(SaveSharedOutcome.SavedAwaitingUpload(listOf(message(type = "success", body = "Article saved")))),
		)
	}

	@Test
	fun `saved awaiting upload joins several server confirmations in order under a Saved title`() {
		assertEquals(
			ShareStatusPresentation(
				message = "Saved",
				subtitle = "Article saved\nSaved to your reading list",
				icon = ShareStatusIcon.CHECKMARK,
				tone = ShareStatusTone.SUCCESS,
			),
			present(
				SaveSharedOutcome.SavedAwaitingUpload(
					listOf(
						message(type = "success", body = "Article saved"),
						message(type = "success", body = "Saved to your reading list"),
					),
				),
			),
		)
	}

	@Test
	fun `saved confirmation is shown as text never markup`() {
		val status = present(
			SaveSharedOutcome.Saved(
				listOf(message(type = "success", body = "<strong>Article</strong> saved")),
			),
		)
		assertEquals("Article saved", status.subtitle)
	}

	@Test
	fun `saved confirmation decodes html entities in the footnote`() {
		val status = present(
			SaveSharedOutcome.Saved(
				listOf(
					message(type = "success", body = "Article saved"),
					message(type = "success", body = "Saved to &#x27;Work&#x27;"),
				),
			),
		)
		assertEquals("Article saved\nSaved to 'Work'", status.subtitle)
	}

	@Test
	fun `not logged in is warning`() {
		val status = present(SaveSharedOutcome.NotLoggedIn)
		assertEquals("Open Readplace and sign in first.", status.message)
		assertNull(status.subtitle)
		assertEquals(ShareStatusIcon.PERSON_ALERT, status.icon)
		assertEquals(ShareStatusTone.WARNING, status.tone)
	}

	@Test
	fun `storage unavailable is error and names the reason`() {
		// The message must name the store's failure so the user can report it.
		val status = present(SaveSharedOutcome.StorageUnavailable("AEADBadTagException"))
		assertEquals(
			"Couldn't read your saved sign-in (Keystore error AEADBadTagException). " +
				"Reopen Readplace, then try sharing again.",
			status.message,
		)
		assertNull(status.subtitle)
		assertEquals(ShareStatusIcon.WARNING_TRIANGLE, status.icon)
		assertEquals(ShareStatusTone.ERROR, status.tone)
	}

	@Test
	fun `no link is warning`() {
		val status = present(SaveSharedOutcome.NoLink)
		assertEquals("No link found to save.", status.message)
		assertNull(status.subtitle)
		assertEquals(ShareStatusIcon.LINK, status.icon)
		assertEquals(ShareStatusTone.WARNING, status.tone)
	}

	@Test
	fun `no save action is error`() {
		val status = present(SaveSharedOutcome.NoSaveAction)
		assertEquals("The server offered no save action.", status.message)
		assertNull(status.subtitle)
		assertEquals(ShareStatusIcon.WARNING_TRIANGLE, status.icon)
		assertEquals(ShareStatusTone.ERROR, status.tone)
	}

	@Test
	fun `refused joins messages and is warning when none are errors`() {
		val status = present(
			SaveSharedOutcome.Refused(
				listOf(message(type = "warning", body = "one"), message(type = "warning", body = "two")),
			),
		)
		assertEquals("one\ntwo", status.message)
		assertNull(status.subtitle)
		assertEquals(ShareStatusIcon.LOCK, status.icon)
		assertEquals(ShareStatusTone.WARNING, status.tone)
	}

	@Test
	fun `refused is error when any message is an error`() {
		val status = present(
			SaveSharedOutcome.Refused(
				listOf(message(type = "warning", body = "one"), message(type = "error", body = "two")),
			),
		)
		assertEquals("one\ntwo", status.message)
		assertEquals(ShareStatusTone.ERROR, status.tone)
	}

	@Test
	fun `refused falls back to its own words when no server message is renderable`() {
		val status = present(SaveSharedOutcome.Refused(emptyList()))
		assertEquals("Couldn't save this link.", status.message)
		assertNull(status.subtitle)
		assertEquals(ShareStatusIcon.LOCK, status.icon)
		assertEquals(ShareStatusTone.WARNING, status.tone)
	}

	@Test
	fun `failed carries the failure message as error`() {
		val status = present(SaveSharedOutcome.Failed("Something broke"))
		assertEquals("Something broke", status.message)
		assertNull(status.subtitle)
		assertEquals(ShareStatusIcon.WARNING_TRIANGLE, status.icon)
		assertEquals(ShareStatusTone.ERROR, status.tone)
	}
}
