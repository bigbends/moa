@file:JvmName("RequestsKt")
@file:JvmMultifileClass

package eu.kanade.tachiyomi.network

import okhttp3.CacheControl
import okhttp3.FormBody
import okhttp3.Headers
import okhttp3.HttpUrl
import okhttp3.OkHttpClient
import okhttp3.RequestBody
import okhttp3.Response

// Extensions compiled against the newer network helpers expect these exact JVM signatures.
// Use the caller's client, preserving MOA DNS checks, proxy, cookies and cancellation.
private val EMPTY_HEADERS = Headers.Builder().build()
private val NO_CACHE = CacheControl.Builder().noCache().build()
private val EMPTY_BODY: RequestBody = FormBody.Builder().build()

suspend fun OkHttpClient.get(url: String, headers: Headers = EMPTY_HEADERS, cache: CacheControl = NO_CACHE): Response =
    newCall(GET(url, headers, cache)).awaitSuccess()

suspend fun OkHttpClient.get(url: HttpUrl, headers: Headers = EMPTY_HEADERS, cache: CacheControl = NO_CACHE): Response =
    newCall(GET(url, headers, cache)).awaitSuccess()

suspend fun OkHttpClient.post(url: String, headers: Headers = EMPTY_HEADERS, body: RequestBody = EMPTY_BODY, cache: CacheControl = NO_CACHE): Response =
    newCall(POST(url, headers, body, cache)).awaitSuccess()

suspend fun OkHttpClient.post(url: HttpUrl, headers: Headers = EMPTY_HEADERS, body: RequestBody = EMPTY_BODY, cache: CacheControl = NO_CACHE): Response =
    post(url.toString(), headers, body, cache)
