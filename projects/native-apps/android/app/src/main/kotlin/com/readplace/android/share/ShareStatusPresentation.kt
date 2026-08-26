package com.readplace.android.share

import com.readplace.android.core.ServerMessage

/**
 * The result of attempting to save a shared page. Decoupled from any UI so the
 * orchestration can be driven directly by tests and mapped to status messages by
 * the share-sheet shell.
 */
sealed interface SaveSharedOutcome {
	/** The link is on the server, with whatever confirmation the server asked the
	 * reader be told — empty on a server that predates the channel. */
	data class Saved(val messages: List<ServerMessage>) : SaveSharedOutcome

	data class SavedAwaitingUpload(val messages: List<ServerMessage>) : SaveSharedOutcome

	data object NotLoggedIn : SaveSharedOutcome

	/** The token store could not be READ (not merely empty) — the shared keystore
	 * returned a hard failure. Carries the failure's reason so the shell can name
	 * it, rather than telling a signed-in user they are signed out. */
	data class StorageUnavailable(val reason: String) : SaveSharedOutcome

	data object NoLink : SaveSharedOutcome

	data object NoSaveAction : SaveSharedOutcome

	data class Refused(val messages: List<ServerMessage>) : SaveSharedOutcome

	data class Failed(val message: String) : SaveSharedOutcome
}

/**
 * The visual tone of a share-sheet status, mapped to a brand colour at the Compose
 * boundary. Kept framework-free so the outcome→status mapping stays a pure,
 * testable value.
 */
enum class ShareStatusTone {
	SUCCESS,
	WARNING,
	ERROR,
}

/**
 * The glyph a share-sheet status shows, named for what it depicts and resolved to a
 * drawable at the Compose boundary. A closed vocabulary rather than the iOS app's SF
 * Symbol string, so the mapping cannot name an icon this app doesn't ship.
 */
enum class ShareStatusIcon {
	CHECKMARK,
	PERSON_ALERT,
	WARNING_TRIANGLE,
	LINK,
	LOCK,
}

/**
 * What the share-sheet shell shows for a save outcome: the message text, an icon,
 * and a tone. Lifted out of the share activity so the whole mapping — including
 * joining a refusal's messages and choosing error vs. warning from their kinds — is
 * a pure value the tests exercise directly; the activity only paints it and maps the
 * tone to a colour.
 */
data class ShareStatusPresentation(
	val message: String,
	val subtitle: String?,
	val icon: ShareStatusIcon,
	val tone: ShareStatusTone,
) {
	companion object {
		fun of(outcome: SaveSharedOutcome): ShareStatusPresentation = when (outcome) {
			is SaveSharedOutcome.Saved -> ShareStatusPresentation(
				// The server's confirmation when it sent one, so the sheet's copy can
				// change without a Play Store release; the client's own word otherwise.
				message = serverCopy(outcome.messages).ifEmpty { "Saved" },
				subtitle = null,
				icon = ShareStatusIcon.CHECKMARK,
				tone = ShareStatusTone.SUCCESS,
			)

			is SaveSharedOutcome.SavedAwaitingUpload -> ShareStatusPresentation(
				message = serverCopy(outcome.messages).ifEmpty { "Saved url" },
				subtitle = "Content will be uploaded when you open the Readplace app",
				icon = ShareStatusIcon.CHECKMARK,
				tone = ShareStatusTone.SUCCESS,
			)

			SaveSharedOutcome.NotLoggedIn -> ShareStatusPresentation(
				message = "Open Readplace and sign in first.",
				subtitle = null,
				icon = ShareStatusIcon.PERSON_ALERT,
				tone = ShareStatusTone.WARNING,
			)

			is SaveSharedOutcome.StorageUnavailable -> ShareStatusPresentation(
				message = "Couldn't read your saved sign-in (Keystore error ${outcome.reason}). " +
					"Reopen Readplace, then try sharing again.",
				subtitle = null,
				icon = ShareStatusIcon.WARNING_TRIANGLE,
				tone = ShareStatusTone.ERROR,
			)

			SaveSharedOutcome.NoLink -> ShareStatusPresentation(
				message = "No link found to save.",
				subtitle = null,
				icon = ShareStatusIcon.LINK,
				tone = ShareStatusTone.WARNING,
			)

			SaveSharedOutcome.NoSaveAction -> ShareStatusPresentation(
				message = "The server offered no save action.",
				subtitle = null,
				icon = ShareStatusIcon.WARNING_TRIANGLE,
				tone = ShareStatusTone.ERROR,
			)

			is SaveSharedOutcome.Refused -> ShareStatusPresentation(
				message = serverCopy(outcome.messages),
				subtitle = null,
				icon = ShareStatusIcon.LOCK,
				tone = if (outcome.messages.any { it.kind == ServerMessage.Kind.ERROR }) {
					ShareStatusTone.ERROR
				} else {
					ShareStatusTone.WARNING
				},
			)

			is SaveSharedOutcome.Failed -> ShareStatusPresentation(
				message = outcome.message,
				subtitle = null,
				icon = ShareStatusIcon.WARNING_TRIANGLE,
				tone = ShareStatusTone.ERROR,
			)
		}

		private fun serverCopy(messages: List<ServerMessage>): String =
			messages.joinToString("\n") { it.plainText }
	}
}
