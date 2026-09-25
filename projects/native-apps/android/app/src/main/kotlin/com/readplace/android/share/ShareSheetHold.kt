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
