package com.readplace.android.core

/**
 * App-private key-value storage for the reader's persistent choices — the last
 * readlist they browsed ([LastViewedReadlist]) and where shared articles drop
 * ([ShareTarget]). A seam so the stores are unit-tested against an in-memory map;
 * production backs it with the app's own private `SharedPreferences`. There is no
 * cross-process App Group on Android, so — unlike iOS — nothing is shared with the
 * share target's own storage beyond these same app-private preferences.
 *
 * A set value distinguishes "never written" (null) from "written empty", which is
 * what lets [ShareTarget] tell an unasked reader from one who chose mainline only.
 * The returned set is the store's own; callers copy it at the boundary.
 */
interface ReaderChoiceStorage {
	fun getString(key: String): String?

	fun putString(key: String, value: String)

	fun getStringSet(key: String): Set<String>?

	fun putStringSet(key: String, values: Set<String>)

	fun remove(key: String)
}
