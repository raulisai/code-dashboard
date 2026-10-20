package lat.devdj.codex.watch

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import org.json.JSONObject
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

object WatchPush {
    suspend fun register(context: Context, store: WatchStore, api: WatchApi) {
        val config = store.json("firebase") ?: return
        if (context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        // Firebase is optional; a build without project credentials remains fully usable.
        try {
            if (FirebaseApp.getApps(context).isEmpty()) {
                FirebaseApp.initializeApp(context, FirebaseOptions.Builder()
                    .setProjectId(config.getString("project_id")).setApplicationId(config.getString("application_id"))
                    .setApiKey(config.getString("api_key")).setGcmSenderId(config.getString("sender_id")).build())
            }
            val messaging = FirebaseMessaging.getInstance()
            val mode = store.read("mode").ifBlank { "attention" }
            if (mode == "off") { messaging.isAutoInitEnabled = false; return }
            messaging.isAutoInitEnabled = true
            val token = suspendCancellableCoroutine<String> { continuation ->
                messaging.token.addOnSuccessListener { if (continuation.isActive) continuation.resume(it) }
                    .addOnFailureListener { if (continuation.isActive) continuation.resumeWithException(it) }
            }
            store.write("fcm", token)
            val registration = token + ":" + mode
            if (store.read("registered") != registration) {
                api.call("/api/wear/notifications", JSONObject().put("token", token).put("mode", mode))
                store.write("registered", registration)
            }
        } catch (error: Exception) {
            if (error is CancellationException) throw error
            // Push setup never hides a conversation successfully fetched from the server.
        }
    }
    fun disable(context: Context) {
        context.getSystemService(NotificationManager::class.java).cancelAll()
        if (FirebaseApp.getApps(context).isNotEmpty()) {
            FirebaseMessaging.getInstance().isAutoInitEnabled = false
            FirebaseMessaging.getInstance().deleteToken()
        }
    }
}

class WatchMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        val store = WatchStore(this)
        if (store.read("token").isBlank()) return
        store.write("fcm", token); store.remove("registered")
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val mode = store.read("mode").ifBlank { "attention" }
                WatchApi(store).call("/api/wear/notifications", JSONObject().put("token", token).put("mode", mode))
                store.write("registered", "$token:$mode")
            } catch (_: Exception) { /* retried on foreground */ }
        }
    }
    override fun onMessageReceived(message: RemoteMessage) {
        val store = WatchStore(this)
        if (store.read("token").isBlank() || store.read("mode") == "off") return
        val marker = message.data["event_id"] ?: return
        if (store.read("last_event") == marker) return
        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel("agent", "Agentes y proyectos", NotificationManager.IMPORTANCE_DEFAULT))
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java)
            .putExtra("show_dashboard", true), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = android.app.Notification.Builder(this, "agent")
            .setSmallIcon(lat.devdj.codex.watch.R.drawable.ic_orb)
            .setContentTitle(message.data["title"]?.take(90) ?: "Agente general")
            .setContentText("Toca para abrir el dashboard")
            .setContentIntent(open).setAutoCancel(true).setOnlyAlertOnce(true).setLocalOnly(true)
            .setVisibility(android.app.Notification.VISIBILITY_PRIVATE).build()
        manager.notify(1, notification)
        store.write("last_event", marker)
    }
}
