package com.readplace.android.app

enum class ReaderMessageRoute {
	START_CAPTURE,
	MARK_READ,
	IGNORE,
	;

	companion object {
		private const val CAPTURE_BLOCKED = "captureBlocked"
		private const val MARKED_READ = "markedRead"

		/** The one JavaScript interface name the reader bridge is registered under.
		 * The server's injected script posts to exactly this name, so a message
		 * arriving on any other channel is not ours to act on. */
		const val BRIDGE_NAME = "ReadplaceReader"

		fun of(
			channelName: String,
			messageType: String?,
			captureInFlight: Boolean,
			alreadyMarkedRead: Boolean,
		): ReaderMessageRoute {
			if (channelName != BRIDGE_NAME) return IGNORE
			return when (messageType) {
				CAPTURE_BLOCKED -> if (captureInFlight) IGNORE else START_CAPTURE
				MARKED_READ -> if (alreadyMarkedRead) IGNORE else MARK_READ
				else -> IGNORE
			}
		}
	}
}
