package lat.devdj.codex.watch

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.URL
import javax.net.ssl.HttpsURLConnection

class ApiError(val status: Int, message: String) : Exception(message)

open class WatchApi(private val store: WatchStore) {
    // HTTPS only. Custom dev servers must present a trusted certificate too.
    val origin get() = store.read("origin").ifBlank { "https://codex-dashboard.devdj.lat" }.trimEnd('/')
    open suspend fun call(path: String, body: JSONObject? = null, authenticated: Boolean = true): JSONObject = withContext(Dispatchers.IO) {
        require(path.startsWith("/api/wear/"))
        val connection = URL(origin + path).openConnection() as HttpsURLConnection
        try {
            connection.connectTimeout = 8000
            connection.readTimeout = 12000
            connection.instanceFollowRedirects = false
            connection.setRequestProperty("Accept", "application/json")
            if (authenticated) connection.setRequestProperty("Authorization", "Bearer " + store.read("token"))
            if (body != null) {
                connection.requestMethod = "POST"
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                connection.outputStream.use { it.write(body.toString().toByteArray()) }
            }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val raw = stream?.use { it.readNBytes(128 * 1024).toString(Charsets.UTF_8) } ?: "{}"
            val data = try { JSONObject(raw) } catch (_: Exception) { JSONObject() }
            if (status !in 200..299) throw ApiError(status, data.optString("message", "El servidor no está disponible ($status)"))
            data
        } finally { connection.disconnect() }
    }
}
