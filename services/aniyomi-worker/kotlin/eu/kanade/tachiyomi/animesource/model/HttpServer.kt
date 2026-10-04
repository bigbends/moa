package eu.kanade.tachiyomi.animesource.model
/** Explicit boundary: media bytes must not depend on an Android extension's local server. */
open class HttpServer {
    init { throw UnsupportedOperationException("extension_http_server_unsupported") }
    companion object { const val PLACEHOLDER_URL = "http://localhost:1" }
}
