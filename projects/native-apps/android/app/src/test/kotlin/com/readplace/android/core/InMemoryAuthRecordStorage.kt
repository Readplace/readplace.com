package com.readplace.android.core

class InMemoryAuthRecordStorage : AuthRecordStorage {
	var value: String? = null
	var fail = false
	var rejectReplacement = false
	override fun read() = value
	override fun write(value: String) { if (fail || (rejectReplacement && value.contains("new-access"))) throw java.io.IOException("unavailable"); this.value = value }
	override fun <T> locked(work: () -> T): T = synchronized(this) { work() }
}
