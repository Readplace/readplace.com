package com.readplace.android.app

import okhttp3.Cookie

sealed interface ReaderSessionMint {
	data class Minted(val cookies: List<Cookie>) : ReaderSessionMint

	data object Offline : ReaderSessionMint

	data object Failed : ReaderSessionMint

	data object Superseded : ReaderSessionMint
}

enum class ReaderCacheMode { PROTOCOL, STORED_COPY_FIRST }

sealed interface ReaderBootstrap {
	data object Loading : ReaderBootstrap

	sealed interface Opens : ReaderBootstrap {
		val cookies: List<Cookie>
		val cacheMode: ReaderCacheMode
		val showsOfflineBanner: Boolean
	}

	data class Ready(override val cookies: List<Cookie>) : Opens {
		override val cacheMode: ReaderCacheMode get() = ReaderCacheMode.PROTOCOL
		override val showsOfflineBanner: Boolean get() = false
	}

	data object Offline : Opens {
		override val cookies: List<Cookie> get() = emptyList()
		override val cacheMode: ReaderCacheMode get() = ReaderCacheMode.STORED_COPY_FIRST
		override val showsOfflineBanner: Boolean get() = true
	}

	data object Unavailable : ReaderBootstrap

	companion object {
		fun after(mint: ReaderSessionMint): ReaderBootstrap =
			when (mint) {
				is ReaderSessionMint.Minted -> Ready(mint.cookies)
				ReaderSessionMint.Offline -> Offline
				ReaderSessionMint.Failed -> Unavailable
				ReaderSessionMint.Superseded -> Loading
			}
	}
}
