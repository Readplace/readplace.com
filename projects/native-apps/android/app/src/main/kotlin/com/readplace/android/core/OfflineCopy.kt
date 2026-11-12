package com.readplace.android.core

import java.time.Duration
import java.time.Instant

object OfflineCopy {
	val MAXIMUM_AGE: Duration = Duration.ofDays(30)
	fun isShowable(savedAt: Instant, now: Instant): Boolean = Duration.between(savedAt, now) <= MAXIMUM_AGE
}
