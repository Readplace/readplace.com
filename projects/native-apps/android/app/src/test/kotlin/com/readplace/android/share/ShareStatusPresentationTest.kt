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
	fun `saved is success`() {
		// The no-queue outcome: there is no content waiting on the app, so the card
		// has nothing to add under the title.
		val status = present(SaveSharedOutcome.Saved(emptyList()))
		assertEquals("Saved", status.message)
		assertNull(status.subtitle)
		assertEquals(ShareStatusIcon.CHECKMARK, status.icon)
		assertEquals(ShareStatusTone.SUCCESS, status.tone)
	}

	@Test
	fun `saved speaks the servers confirmation when it sent one`() {
		val status = present(
			SaveSharedOutcome.Saved(
				listOf(
					message(type = "success", body = "Article saved"),
					message(type = "success", body = "Saved to your reading list"),
				),
			),
		)
		assertEquals("Article saved\nSaved to your reading list", status.message)
		assertNull(status.subtitle)
		assertEquals(ShareStatusTone.SUCCESS, status.tone)
	}

	@Test
	fun `saved awaiting upload says who will carry the content`() {
		val status = present(SaveSharedOutcome.SavedAwaitingUpload(emptyList()))
		assertEquals("Saved url", status.message)
		assertEquals("Content will be uploaded when you open the Readplace app", status.subtitle)
		assertEquals(ShareStatusIcon.CHECKMARK, status.icon)
		assertEquals(ShareStatusTone.SUCCESS, status.tone)
	}

	@Test
	fun `saved awaiting upload keeps the servers confirmation as its title`() {
		val status = present(
			SaveSharedOutcome.SavedAwaitingUpload(
				listOf(
					message(type = "success", body = "Article saved"),
					message(type = "success", body = "Saved to your reading list"),
				),
			),
		)
		assertEquals("Article saved\nSaved to your reading list", status.message)
		assertEquals("Content will be uploaded when you open the Readplace app", status.subtitle)
	}

	@Test
	fun `saved confirmation is shown as text never markup`() {
		val status = present(
			SaveSharedOutcome.Saved(
				listOf(message(type = "success", body = "<strong>Article</strong> saved")),
			),
		)
		assertEquals("Article saved", status.message)
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
	fun `failed carries the failure message as error`() {
		val status = present(SaveSharedOutcome.Failed("Something broke"))
		assertEquals("Something broke", status.message)
		assertNull(status.subtitle)
		assertEquals(ShareStatusIcon.WARNING_TRIANGLE, status.icon)
		assertEquals(ShareStatusTone.ERROR, status.tone)
	}
}
