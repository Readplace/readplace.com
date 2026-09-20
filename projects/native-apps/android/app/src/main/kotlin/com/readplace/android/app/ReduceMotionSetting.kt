package com.readplace.android.app

import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.distinctUntilChanged

interface ReduceMotionSetting {
	fun current(): Boolean

	fun observe(onChange: () -> Unit): AutoCloseable
}

fun ReduceMotionSetting.updates(): Flow<Boolean> = callbackFlow {
	trySend(current())
	val registration = observe { trySend(current()) }
	awaitClose { registration.close() }
}.distinctUntilChanged()
