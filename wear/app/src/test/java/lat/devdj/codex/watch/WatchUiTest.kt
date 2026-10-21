package lat.devdj.codex.watch

import org.junit.Assert.*
import org.junit.Test

class WatchUiTest {
    @Test fun statusReflectsActualLifecycleWithoutProviderOrFakeProgress() {
        assertEquals("Aquí estoy", WatchUi().label)
        assertEquals("Estoy en ello", WatchUi(state = "working").label)
        assertEquals("Leyendo", WatchUi(state = "working", activity = "Leyendo").label)
        assertEquals("Necesito tu atención", WatchUi(state = "attention").label)
        assertEquals("Sin actualizar", WatchUi(state = "working", error = "sin red").label)
        assertFalse(WatchUi(state = "idle").working)
        assertTrue(WatchUi(state = "queued").working)
    }

    @Test fun quotaLevelsWarnBeforeAnAgentRunsDry() {
        assertEquals(Level.Good, levelOf(100))
        assertEquals(Level.Good, levelOf(40))
        assertEquals(Level.Warn, levelOf(39))
        assertEquals(Level.Warn, levelOf(15))
        assertEquals(Level.Low, levelOf(14))
        assertEquals(Level.Low, levelOf(0))
        assertEquals(Level.Good, levelOf(null))
    }

    @Test fun windowsReportWhatIsLeftAndTellFiveHoursFromWeekly() {
        val quota = ProviderQuota(listOf(QuotaWindow(10080, 61.6, 0), QuotaWindow(300, 28.0, 0)))
        assertEquals(72, quota.session?.left)
        assertEquals(38, quota.weekly?.left)
        assertEquals(72, quota.left)
        assertEquals(0, QuotaWindow(300, 140.0, 0).left)
        assertEquals(100, QuotaWindow(300, -5.0, 0).left)
        assertNull(ProviderQuota(listOf(QuotaWindow(300, 10.0, 0))).weekly)
    }

    @Test fun theHintPicksTheAgentWithMoreLeft() {
        val low = ProviderQuota(listOf(QuotaWindow(300, 80.0, 0)))
        val high = ProviderQuota(listOf(QuotaWindow(300, 10.0, 0)))
        assertEquals("Codex", bestAgent(low, high))
        assertEquals("Claude", bestAgent(high, low))
        assertEquals("Claude", bestAgent(high, null))
        assertEquals("Codex", bestAgent(null, high))
        assertNull(bestAgent(null, null))
    }

    @Test fun agesReadInPlainSpanish() {
        assertEquals("", ago(0, 1000))
        assertEquals("ahora", ago(990, 1000))
        assertEquals("hace 5 min", ago(700, 1000))
        assertEquals("hace 2 h", ago(10000 - 7300, 10000))
        assertEquals("hace 3 d", ago(1000, 1000 + 3 * 86400 + 10))
    }

    @Test fun noticesSayWhereTheyCameFrom() {
        assertEquals("Agente", Notice("terminado", "_general", "x", 0, "claude").where)
        assertEquals("alpha", Notice("error", "alpha", "x", 0, "codex").where)
        assertTrue(Notice("approval", "", "x", 0, "").general)
    }
}
