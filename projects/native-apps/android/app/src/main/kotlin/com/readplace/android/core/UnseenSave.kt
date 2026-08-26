package com.readplace.android.core

import java.io.File
import java.io.IOException

/**
 * Word the share target leaves in the app's file store that a save landed which
 * the app's list has not shown yet. The reading list consumes it to decide that a
 * deep-scrolled (paginated) list is worth re-reading on return — the one case
 * where converging costs the reader their scroll position, so it must be
 * justified by an actual save rather than performed on every return. Presence
 * is the whole signal; any successful first-page read clears it, because the
 * list now holds server truth.
 */
class UnseenSave(private val root: File) {
	private val marker = File(root, "unseen-save")

	/** A failure to record costs only the automatic refresh — the save itself has
	 * already succeeded — so it must never fail the share journey. */
	fun record() {
		root.mkdirs()
		try {
			marker.createNewFile()
		} catch (_: IOException) {
		}
	}

	val exists: Boolean get() = marker.exists()

	fun clear() {
		marker.delete()
	}
}
