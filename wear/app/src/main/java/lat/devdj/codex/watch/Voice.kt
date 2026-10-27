package lat.devdj.codex.watch

import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.Locale
import java.util.concurrent.atomic.AtomicInteger

/** Dictation and speech language: the watch's own Spanish, or Mexican Spanish when the watch is in another language. */
fun spanishTag(locale: Locale = Locale.getDefault()) = if (locale.language == "es" && locale.country.isNotBlank()) locale.toLanguageTag() else "es-MX"

/** Rank of a Spanish voice: Latin American first, then quality; one that needs the network loses a step. */
fun voiceScore(country: String, quality: Int, network: Boolean) =
    when (country.uppercase()) { "MX" -> 3000; "US" -> 2000; "ES" -> 0; else -> 1000 } + quality - if (network) 150 else 0

/** What the voice actually reads: no links, markup or emoji, and never an essay. */
fun spoken(text: String) = text.replace(Regex("https?://\\S+"), "el enlace").replace(Regex("[`*_#>|~]"), "")
    .replace(Regex("\\p{So}"), "").replace(Regex("\\s+"), " ").trim().take(600)

/**
 * End of the last finished sentence of [text] after [from], or -1. While the agent is still writing, a stop only
 * counts once something follows it, so «3.» never cuts «3.5» in half.
 */
fun sentenceEnd(text: String, from: Int): Int {
    var end = -1
    for (i in from until text.length - 1) if (text[i] in ".!?…:;\n" && text[i + 1].isWhitespace()) end = i + 1
    return end
}

/** The sentence the agent is on right now, for the single line under the sphere. */
fun lastSentence(text: String) = text.trim().split(Regex("(?<=[.!?…])\\s+|\\n")).lastOrNull { it.isNotBlank() }?.trim().orEmpty()

// Word ends spelled out: `\b` counts «é» as a word letter on Android but not on the JVM.
private const val WordEnd = "(?=[\\s,.;:!?¿¡]|$)"
private val Greeting = Regex("^(hola|buen[oa]s|qué tal|que tal|gracias|ok|okay|vale|perfecto)$WordEnd")
private val Lookup = Regex("^(qué|que|cómo|como|cuál|cual|cuánto|cuanto|cuántos|cuantos|cuándo|cuando|dónde|donde|quién|quien|hay|está|esta|están|estan|tienes|dime|muéstrame|muestrame|revisa|checa|busca|ve si)$WordEnd")

/**
 * What the watch says the instant a message leaves, before the agent has written a word. Greetings get no filler:
 * the agent answers those right away. [turn] rotates the phrase so it does not sound like a recording.
 */
fun ack(text: String, turn: Int): String {
    val said = text.trim().lowercase()
    val options = when {
        said.isBlank() || Greeting.containsMatchIn(said) -> return ""
        '?' in said || '¿' in said || Lookup.containsMatchIn(said) -> listOf("Ok, buscando.", "Déjame ver.", "Lo reviso.")
        else -> listOf("Va, me pongo con eso.", "Ok, en eso estoy.", "Entendido, empiezo.")
    }
    return options[Math.floorMod(turn, options.size)]
}

/** Spanish speech kept warm for the whole app, so the first word of an answer never waits for the engine to start. */
class Speaker(context: Context) {
    private val pending = mutableListOf<String>()
    private val queued = AtomicInteger(0)
    @Volatile private var ready = false
    private val mutableSpeaking = MutableStateFlow(false)
    val speaking = mutableSpeaking.asStateFlow()
    var voiceName = ""; private set
    private val engine = TextToSpeech(context.applicationContext) { status -> if (status == TextToSpeech.SUCCESS) setUp() }

    private fun setUp() {
        engine.setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANT)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
        val best = runCatching { engine.voices.orEmpty() }.getOrDefault(emptySet())
            .filter { it.locale.language == "es" && TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED !in it.features.orEmpty() }
            .maxByOrNull { voiceScore(it.locale.country, it.quality, it.isNetworkConnectionRequired) }
        if (best != null) { engine.voice = best; voiceName = best.name } else engine.language = Locale.forLanguageTag(spanishTag())
        engine.setSpeechRate(1.05f)
        engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) { mutableSpeaking.value = true }
            override fun onDone(utteranceId: String?) { if (queued.decrementAndGet() <= 0) { queued.set(0); mutableSpeaking.value = false } }
            @Deprecated("Required by the platform listener")
            override fun onError(utteranceId: String?) { onDone(utteranceId) }
            override fun onStop(utteranceId: String?, interrupted: Boolean) { onDone(utteranceId) }
        })
        ready = true
        synchronized(pending) { pending.toList().also { pending.clear() } }.forEach { say(it) }
    }

    /** Queues [text] after what is being said; [first] interrupts it, because a new turn replaces the old one. */
    fun say(text: String, first: Boolean = false) {
        val clean = spoken(text)
        if (clean.isBlank()) return
        if (!ready) { synchronized(pending) { if (first) pending.clear(); pending.add(clean) }; return }
        if (first) queued.set(0)
        queued.incrementAndGet()
        engine.speak(clean, if (first) TextToSpeech.QUEUE_FLUSH else TextToSpeech.QUEUE_ADD, null, "codex-" + System.nanoTime())
    }

    fun stop() {
        synchronized(pending) { pending.clear() }
        queued.set(0)
        if (ready) engine.stop()
        mutableSpeaking.value = false
    }

    fun shutdown() { stop(); engine.shutdown() }
}

/**
 * Dictation inside the app with the watch's own recognition service (Samsung's on a Galaxy Watch), the same route
 * as the remote-control app: live words, microphone level and end of speech detected by the service, no extra
 * screen. Falls back to the on-device recognizer; the caller opens the system screen when neither starts.
 * Main thread only. Audio never reaches or is stored by this app.
 */
class Ear(private val context: Context, private val listener: Listener) {
    interface Listener {
        fun onLevel(level: Float)
        fun onPartial(text: String)
        fun onFinal(text: String)
        /** [beforeSpeech]: the engine failed before hearing anything, so the system screen may still work. */
        fun onError(message: String, beforeSpeech: Boolean)
    }

    private var recognizer: SpeechRecognizer? = null
    private var heard = false
    private var finished = false

    fun start(language: String): Boolean {
        destroy()
        val service = runCatching { SpeechRecognizer.isRecognitionAvailable(context) }.getOrDefault(false)
        val onDevice = !service && runCatching { SpeechRecognizer.isOnDeviceRecognitionAvailable(context) }.getOrDefault(false)
        if (!service && !onDevice) return false
        val engine = try {
            if (onDevice) SpeechRecognizer.createOnDeviceSpeechRecognizer(context) else SpeechRecognizer.createSpeechRecognizer(context)
        } catch (_: RuntimeException) { return false }
        recognizer = engine; heard = false; finished = false
        engine.setRecognitionListener(callback)
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, language)
            .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            .putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, context.packageName)
        if (onDevice) intent.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
        return try { engine.startListening(intent); true } catch (_: RuntimeException) { destroy(); false }
    }

    /** Stop capturing and deliver what was heard. */
    fun stop() { runCatching { recognizer?.stopListening() } }

    fun destroy() {
        val engine = recognizer ?: return
        recognizer = null
        runCatching { engine.cancel(); engine.destroy() }
    }

    private val callback = object : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) = Unit
        override fun onBeginningOfSpeech() { heard = true }
        override fun onRmsChanged(rmsdB: Float) = listener.onLevel(((rmsdB + 2f) / 12f).coerceIn(0f, 1f))
        override fun onBufferReceived(buffer: ByteArray?) = Unit
        override fun onEndOfSpeech() = Unit
        override fun onPartialResults(partialResults: Bundle?) {
            val text = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()
            if (!text.isNullOrBlank()) { heard = true; listener.onPartial(text) }
        }
        override fun onResults(results: Bundle?) {
            if (finished) return
            finished = true
            val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
            destroy()
            if (text.isBlank()) listener.onError("No te entendí. Toca la esfera y repite.", false) else listener.onFinal(text)
        }
        override fun onError(error: Int) {
            if (finished) return
            finished = true
            destroy()
            listener.onError(message(error), !heard && error in EngineErrors)
        }
        override fun onEvent(eventType: Int, params: Bundle?) = Unit
    }

    companion object {
        private val EngineErrors = setOf(SpeechRecognizer.ERROR_CLIENT, SpeechRecognizer.ERROR_SERVER, SpeechRecognizer.ERROR_SERVER_DISCONNECTED,
            SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED, SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE, SpeechRecognizer.ERROR_RECOGNIZER_BUSY,
            SpeechRecognizer.ERROR_CANNOT_CHECK_SUPPORT, SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT, SpeechRecognizer.ERROR_AUDIO)

        fun message(error: Int) = when (error) {
            SpeechRecognizer.ERROR_NO_MATCH -> "No te entendí. Toca la esfera y repite."
            SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "No oí nada. Toca la esfera para hablar."
            SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "El dictado necesita conexión."
            SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Falta el permiso del micrófono."
            SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "El dictado está ocupado. Inténtalo otra vez."
            SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED, SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE -> "El dictado no tiene español disponible."
            SpeechRecognizer.ERROR_AUDIO -> "No pude usar el micrófono."
            else -> "El dictado falló ($error)."
        }
    }
}
