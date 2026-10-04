package org.moa.apk

import eu.kanade.tachiyomi.network.NetworkHelper
import eu.kanade.tachiyomi.animesource.AnimeSource
import eu.kanade.tachiyomi.animesource.AnimeSourceFactory
import eu.kanade.tachiyomi.animesource.model.*
import eu.kanade.tachiyomi.animesource.online.AnimeHttpSource
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.PrintStream
import java.lang.reflect.Proxy
import java.nio.file.Path
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import org.json.JSONArray
import org.json.JSONObject
import uy.kohesive.injekt.Injekt
import uy.kohesive.injekt.api.InjektRegistrar
import uy.kohesive.injekt.api.InjektScope

/** Serial private RPC; extension stdout never becomes protocol output. */
object Main {
    @JvmStatic fun main(args: Array<String>) {
        val output = PrintStream(java.io.FileOutputStream(java.io.FileDescriptor.out), true, Charsets.UTF_8)
        System.setOut(PrintStream(System.err, true, Charsets.UTF_8))
        val context = HostContext(Path.of(args[1]), args[2])
        val network = NetworkHelper { context.outboundProxy }
        WebBridge.configure { context.outboundProxy }
        android.webkit.CookieManager.bind(network.client.cookieJar)
        val json = Json { ignoreUnknownKeys = true; isLenient = true }
        val registrar = Proxy.newProxyInstance(Main::class.java.classLoader, arrayOf(InjektRegistrar::class.java)) { _, method, params ->
            if (method.name == "hasFactory") true else when (params[0].toString()) {
                "class eu.kanade.tachiyomi.network.NetworkHelper" -> network
                "class kotlinx.serialization.json.Json" -> json
                "class android.app.Application", "class android.content.Context" -> context
                else -> error("unbound_android_dependency")
            }
        } as InjektRegistrar
        Injekt = InjektScope(registrar)
        val instance = Class.forName(args[0]).getConstructor().newInstance()
        val loaded = when (instance) { is AnimeSourceFactory -> instance.createSources(); is AnimeSource -> listOf(instance); else -> error("unsupported_source_api") }
        require(loaded.isNotEmpty() && loaded.size <= 1000 && loaded.map { it.id }.distinct().size == loaded.size)
        require(loaded.all { it is AnimeHttpSource }) { "unsupported_source_api" }
        val sources = loaded.filterIsInstance<AnimeHttpSource>().associateBy { it.id.toString() }
        val input = BufferedInputStream(System.`in`)
        while (true) {
            val line = ByteArrayOutputStream()
            var next = input.read()
            if (next == -1) break
            while (next != -1 && next != 10) {
                require(line.size() < 1024 * 1024); line.write(next); next = input.read()
            }
            var id: Any = JSONObject.NULL
            val response = try {
                val request = JSONObject(line.toString(Charsets.UTF_8)); id = request.get("id")
                val params = request.optJSONObject("params") ?: JSONObject()
                val result = runBlocking { withTimeout(30_000) {
                    when (request.getString("method")) {
                        "preferences" -> Preferences.read(sources, context)
                        "preferences-save" -> context.transaction { Preferences.save(sources, context, params.getJSONObject("values")) }
                        else -> invoke(sources, request.getString("method"), params)
                    }
                } }
                JSONObject().put("id", id).put("result", result)
            } catch (error: Throwable) {
                if (error is VirtualMachineError) throw error
                if (java.lang.Boolean.getBoolean("moa.apk.debug")) error.printStackTrace(System.err)
                val causes = generateSequence(error as Throwable?) { it.cause }.take(16).toList()
                val code = when {
                    causes.any { it is kotlinx.coroutines.TimeoutCancellationException || it is java.net.SocketTimeoutException } -> "apk_request_timeout"
                    causes.any { it is LinkageError || it is UnsupportedOperationException || it.message == "Stub!" } -> "apk_android_feature_unsupported"
                    causes.any { it is java.io.IOException || it.message?.matches(Regex("HTTP [0-9]{3}:.*")) == true } -> "apk_network_failed"
                    causes.any { it is IllegalArgumentException && it.message?.contains("in Referer value:") == true } -> "apk_source_invalid_headers"
                    else -> "apk_request_failed"
                }
                JSONObject().put("id", id).put("error", code)
            }
            output.println(response.toString()); output.flush()
        }
    }
    private inline fun initialized(fallback: String, read: () -> String) = try { read() } catch (_: UninitializedPropertyAccessException) { fallback }
    private fun work(anime: SAnime, fallbackUrl: String = "", fallbackTitle: String = "") = JSONObject()
        .put("url", initialized(fallbackUrl) { anime.url }).put("title", initialized(fallbackTitle) { anime.title })
        .put("author", anime.author).put("description", anime.description).put("genre", anime.genre)
        .put("status", anime.status).put("cover", anime.thumbnail_url)
    private suspend fun invoke(sources: Map<String, AnimeHttpSource>, method: String, input: JSONObject): Any {
        if (method == "describe") return JSONArray(sources.values.map { JSONObject().put("id", it.id.toString())
            .put("name", it.name).put("lang", it.lang).put("baseUrl", it.baseUrl).put("supportsLatest", it.supportsLatest) })
        val source = sources[input.getString("sourceId")] ?: error("unknown_source")
        val anime = SAnime.create().apply { url = input.optString("workUrl"); title = input.optString("title", "Work") }
        return when (method) {
            "filters" -> sourceFilters(source.getFilterList(), JSONArray())
            "list" -> {
                val page = input.optInt("page", 1); require(page in 1..100000)
                val filters = source.getFilterList()
                val changes = input.optJSONArray("filters") ?: JSONArray()
                val definitions = sourceFilters(filters, changes)
                val mode = if (input.optString("query").isNotEmpty()) "search" else input.optString("mode", if (changes.length() > 0) "search" else "popular")
                val result = when (mode) {
                    "popular" -> source.getPopularAnime(page)
                    "latest" -> { require(source.supportsLatest); source.getLatestUpdates(page) }
                    "search" -> source.getSearchAnime(page, input.optString("query"), filters)
                    else -> error("unsupported_method")
                }
                require(result.animes.size <= 5000)
                JSONObject().put("items", JSONArray(result.animes.map(::work))).put("hasNextPage", result.hasNextPage)
                    .put("browse", JSONObject().put("activeMode", mode)
                        .put("availableModes", JSONArray(if (source.supportsLatest) listOf("popular", "latest", "search") else listOf("popular", "search")))
                        .put("filters", definitions))
            }
            "detail" -> work(source.getAnimeDetails(anime), anime.url, anime.title)
            "episodes" -> {
                val result = source.getEpisodeList(anime); require(result.size <= 100000)
                JSONArray(result.map { JSONObject().put("url", it.url).put("title", it.name).put("number", it.episode_number.toDouble())
                    .put("scanlator", it.scanlator).put("uploadedAt", it.date_upload) })
            }
            "videos" -> {
                val episode = SEpisode.create().apply { url = input.getString("episodeUrl"); name = input.optString("title", "Episode") }
                val hasHosterApi = source.javaClass.methods.any {
                    it.name == "getHosterList" && it.declaringClass != AnimeHttpSource::class.java && it.parameterTypes.firstOrNull() == SEpisode::class.java
                }
                val result = if (hasHosterApi) {
                    val hosters = source.getHosterList(episode); require(hosters.size <= 50)
                    hosters.flatMap { it.videoList ?: source.getVideoList(it) }
                } else source.getVideoList(episode)
                require(result.size <= 100)
                // API14 videoUrl is nullable: resolve only when the extension returned a deferred URL.
                JSONArray(result.map { candidate ->
                    val video = if (candidate.initialized) candidate else source.resolveVideo(candidate) ?: error("video_resolution_failed")
                    val url = video.videoUrl.takeIf { it.isNotBlank() && it != "null" } ?: source.getVideoUrl(video)
                    val uri = java.net.URI(url)
                    val local = video.usesHttpServer() || uri.host?.let { it == "localhost" || it == "[::1]" || it == "::1" || it.startsWith("127.") } == true
                    val headers = JSONObject(); video.headers?.forEach { (key, value) -> headers.put(key, value) }
                    JSONObject().put("url", url).put("quality", video.quality).put("headers", headers).put("requiresRuntime", local)
                        .put("subtitles", JSONArray(video.subtitleTracks.map { JSONObject().put("url", it.url).put("label", it.lang) }))
                        .put("audio", JSONArray(video.audioTracks.map { JSONObject().put("url", it.url).put("label", it.lang) }))
                })
            }
            else -> error("unsupported_method")
        }
    }
}
