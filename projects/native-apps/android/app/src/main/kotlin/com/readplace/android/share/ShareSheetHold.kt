package com.readplace.android.share

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Job
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.time.Duration

class ShareSheetHold(private val holdDuration: Duration) {
	private var endNow: (() -> Unit)? = null

	fun end() {
		endNow?.invoke()
	}

	suspend fun untilSettledAndRead(settled: Job) = coroutineScope {
		val claim = FirstClaim()
		val ended = CompletableDeferred<Unit>()
		endNow = { if (claim.take()) ended.complete(Unit) }
		val waiter = launch {
			settled.join()
			// A cancelled journey is disposal, not a settled save: join() returns normally
			// for it, so without this guard the hold would start and close the sheet as if
			// a save had landed.
			if (settled.isCancelled) return@launch
			delay(holdDuration)
			if (claim.take()) ended.complete(Unit)
		}
		try {
			ended.await()
		} finally {
			waiter.cancel()
			endNow = null
		}
	}
}
