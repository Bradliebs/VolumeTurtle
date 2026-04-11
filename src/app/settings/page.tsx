"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const mono = { fontFamily: "'JetBrains Mono', 'Fira Code', monospace" };

interface SettingsData {
  settings: Record<string, string>;
  t212: {
    environment: string;
    accountType: string;
    connected: boolean;
    lastSyncAt: string | null;
    lastSyncStatus: string | null;
    lastSyncError: string | null;
  } | null;
  system: {
    universeSize: number;
    lastScan: string | null;
    signalCount: number;
    tradeCount: number;
  };
  t212Configured: boolean;
}

interface TestResult {
  success: boolean;
  currency?: string;
  cash?: number;
  accountId?: string;
  error?: string;
}

export default function SettingsPage() {
  const [data, setData] = useState<SettingsData | null>(null);
  const [loading, setLoading] = useState(true);

  const [t212Env, setT212Env] = useState<"demo" | "live">("live");
  const [t212ApiKey, setT212ApiKey] = useState("");
  const [t212ApiSecret, setT212ApiSecret] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [showApiSecret, setShowApiSecret] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [savingT212, setSavingT212] = useState(false);

  const [accountType, setAccountType] = useState("isa");
  const [balanceSource, setBalanceSource] = useState("manual");
  const [manualBalance, setManualBalance] = useState("580");
  const [riskPct, setRiskPct] = useState("2");
  const [maxPositions, setMaxPositions] = useState("5");
  const [maxExposure, setMaxExposure] = useState("25");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const [dangerConfirm, setDangerConfirm] = useState("");
  const [dangerResult, setDangerResult] = useState<string | null>(null);
  const [backupRunning, setBackupRunning] = useState(false);
  const [backupResult, setBackupResult] = useState<string | null>(null);
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(null);
  const [backupDir, setBackupDir] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Telegram state
  const [tgBotToken, setTgBotToken] = useState("");
  const [tgChatId, setTgChatId] = useState("");
  const [tgEnabled, setTgEnabled] = useState(true);
  const [tgShowToken, setTgShowToken] = useState(false);
  const [tgSaving, setTgSaving] = useState(false);
  const [tgTesting, setTgTesting] = useState(false);
  const [tgStatus, setTgStatus] = useState<string | null>(null);
  const [tgConfigured, setTgConfigured] = useState(false);
  const [tgShowSetup, setTgShowSetup] = useState(false);

  // Momentum engine state
  const [momEnabled, setMomEnabled] = useState(true);
  const [momMinChg, setMomMinChg] = useState("10");
  const [momMinVol, setMomMinVol] = useState("3.0");
  const [momWRegime, setMomWRegime] = useState("0.35");
  const [momWBreakout, setMomWBreakout] = useState("0.30");
  const [momWSector, setMomWSector] = useState("0.25");
  const [momWLiquidity, setMomWLiquidity] = useState("0.10");
  const [momSaving, setMomSaving] = useState(false);
  const [momStatus, setMomStatus] = useState<string | null>(null);

  // Alerts state
  interface AlertItem { id: number; type: string; ticker: string; message: string; severity: string; createdAt: string; }
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(false);

  // Runner state
  const [runnerEnabled, setRunnerEnabled] = useState(true);
  const [runnerThreshold, setRunnerThreshold] = useState("30");
  const [runnerLookback, setRunnerLookback] = useState("20");
  const [runnerTicker, setRunnerTicker] = useState<string | null>(null);
  const [runnerSlotAvailable, setRunnerSlotAvailable] = useState(true);
  const [runnerPhase, setRunnerPhase] = useState<string>("none");
  const [runnerSaving, setRunnerSaving] = useState(false);
  const [runnerStatus, setRunnerStatus] = useState<string | null>(null);

  // Auto-execution state
  const [autoExecEnabled, setAutoExecEnabled] = useState(false);
  const [autoExecMinGrade, setAutoExecMinGrade] = useState("B");
  const [autoExecWindow, setAutoExecWindow] = useState("15");
  const [autoExecMaxPerDay, setAutoExecMaxPerDay] = useState("2");
  const [autoExecStartHour, setAutoExecStartHour] = useState("14");
  const [autoExecEndHour, setAutoExecEndHour] = useState("20");
  const [autoExecMaxPerSector, setAutoExecMaxPerSector] = useState("2");
  const [autoExecSaving, setAutoExecSaving] = useState(false);
  const [autoExecStatus, setAutoExecStatus] = useState<string | null>(null);
  const [autoExecConfirmText, setAutoExecConfirmText] = useState("");
  const [autoExecShowConfirm, setAutoExecShowConfirm] = useState(false);
  const [autoExecDisabling, setAutoExecDisabling] = useState(false);
  interface ExecLogEntry { id: number; orderId: number; event: string; detail: string; createdAt: string; }
  const [execLogs, setExecLogs] = useState<ExecLogEntry[]>([]);
  const [execLogsExpanded, setExecLogsExpanded] = useState(false);

  // Stop push status
  interface UnprotectedTrade { id: string; ticker: string; stopPushAttempts: number; stopPushError: string | null }
  const [unprotectedTrades, setUnprotectedTrades] = useState<UnprotectedTrade[]>([]);
  const [pushRetrying, setPushRetrying] = useState(false);
  const [pushStatus, setPushStatus] = useState<string | null>(null);

  function showError(msg: string) {
    setErrorMsg(msg);
    setTimeout(() => setErrorMsg(null), 6000);
  }

  useEffect(() => {
    fetchSettings();
    fetchBackupStatus();
    fetchTelegramStatus();
    fetchMomentumSettings();
    fetchAlerts();
    fetchRunnerStatus();
    fetchAutoExecSettings();
    fetchUnprotected();
  }, []);

  async function fetchAutoExecSettings() {
    try {
      const res = await fetch("/api/execution/settings");
      if (res.ok) {
        const d = await res.json();
        setAutoExecEnabled(d.autoExecutionEnabled);
        setAutoExecMinGrade(d.autoExecutionMinGrade);
        setAutoExecWindow(String(d.autoExecutionWindowMins));
        setAutoExecMaxPerDay(String(d.autoExecutionMaxPerDay));
        setAutoExecStartHour(String(d.autoExecutionStartHour));
        setAutoExecEndHour(String(d.autoExecutionEndHour));
        setAutoExecMaxPerSector(String(d.maxPositionsPerSector ?? 2));
      }
    } catch { /* silent */ }
  }

  async function fetchExecLogs() {
    try {
      const res = await fetch("/api/execution/log");
      if (res.ok) {
        const d = await res.json();
        setExecLogs(d.logs ?? []);
      }
    } catch { /* silent */ }
  }

  async function fetchUnprotected() {
    try {
      const res = await fetch("/api/execution/push-stops");
      if (res.ok) {
        const d = await res.json();
        setUnprotectedTrades(d.unprotected ?? []);
      }
    } catch { /* silent */ }
  }

  async function retryStopPush() {
    setPushRetrying(true);
    setPushStatus(null);
    try {
      const res = await fetch("/api/execution/push-stops", { method: "POST" });
      const d = await res.json();
      setPushStatus(`${d.successCount ?? 0} succeeded, ${d.failCount ?? 0} failed`);
      await fetchUnprotected();
    } catch (err) {
      setPushStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setPushRetrying(false);
    }
  }

  async function saveAutoExecSettings() {
    setAutoExecSaving(true);
    setAutoExecStatus(null);
    try {
      const res = await fetch("/api/execution/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          autoExecutionEnabled: autoExecEnabled,
          autoExecutionMinGrade: autoExecMinGrade,
          autoExecutionWindowMins: parseInt(autoExecWindow, 10),
          autoExecutionMaxPerDay: parseInt(autoExecMaxPerDay, 10),
          autoExecutionStartHour: parseInt(autoExecStartHour, 10),
          autoExecutionEndHour: parseInt(autoExecEndHour, 10),
          maxPositionsPerSector: parseInt(autoExecMaxPerSector, 10),
        }),
      });
      if (res.ok) {
        setAutoExecStatus("✓ Saved");
        setAutoExecConfirmText("");
        setAutoExecShowConfirm(false);
        setTimeout(() => setAutoExecStatus(null), 3000);
      } else {
        const d = await res.json().catch(() => ({ error: "Failed" }));
        setAutoExecStatus(`✗ ${d.error ?? "Failed"}`);
      }
    } catch { setAutoExecStatus("✗ Network error"); }
    setAutoExecSaving(false);
  }

  async function emergencyDisableAutoExec() {
    setAutoExecDisabling(true);
    try {
      const res = await fetch("/api/execution/pending", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "emergency_disable" }),
      });
      if (res.ok) {
        setAutoExecEnabled(false);
        setAutoExecStatus("⛔ Auto-execution disabled — all pending orders cancelled");
        setTimeout(() => setAutoExecStatus(null), 5000);
      }
    } catch { setAutoExecStatus("✗ Network error"); }
    setAutoExecDisabling(false);
  }

  async function fetchBackupStatus() {
    try {
      const res = await fetch("/api/backup");
      if (res.ok) {
        const json = await res.json();
        setLastBackupAt(json.lastBackupAt);
        setBackupDir(json.backupDir);
      }
    } catch {
      showError("Failed to fetch backup status");
    }
  }

  async function triggerBackup() {
    setBackupRunning(true);
    setBackupResult(null);
    try {
      const res = await fetch("/api/backup", { method: "POST" });
      const json = await res.json();
      if (json.success) {
        setBackupResult(`✓ Backup saved — ${json.tradeCount} trades, ${json.signalCount} signals`);
        setLastBackupAt(new Date().toISOString());
      } else {
        setBackupResult(`✗ ${json.error}`);
      }
    } catch {
      setBackupResult("✗ Backup failed");
    } finally {
      setBackupRunning(false);
    }
  }

  function downloadExport(endpoint: string) {
    window.open(`/api/export/${endpoint}`, "_blank");
  }

  // ── Telegram ──
  async function fetchTelegramStatus() {
    try {
      const res = await fetch("/api/settings/telegram");
      if (res.ok) {
        const d = await res.json();
        setTgConfigured(d.configured);
        setTgEnabled(d.enabled);
      }
    } catch { /* silent */ }
  }

  async function saveTelegram() {
    setTgSaving(true);
    setTgStatus(null);
    try {
      const res = await fetch("/api/settings/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botToken: tgBotToken, chatId: tgChatId, enabled: tgEnabled }),
      });
      if (res.ok) {
        setTgStatus("✓ Saved");
        setTgConfigured(true);
        setTimeout(() => setTgStatus(null), 3000);
      } else {
        const d = await res.json().catch(() => ({ error: "Failed" }));
        setTgStatus(`✗ ${d.error ?? "Failed"}`);
      }
    } catch { setTgStatus("✗ Network error"); }
    setTgSaving(false);
  }

  async function testTelegram() {
    setTgTesting(true);
    setTgStatus(null);
    try {
      const res = await fetch("/api/settings/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sendTest: true }),
      });
      const d = await res.json();
      setTgStatus(d.success ? "✓ Test message sent" : `✗ ${d.error ?? "Failed"}`);
    } catch { setTgStatus("✗ Network error"); }
    setTgTesting(false);
  }

  // ── Momentum engine settings ──
  async function fetchMomentumSettings() {
    try {
      const res = await fetch("/api/settings/momentum");
      if (res.ok) {
        const d = await res.json();
        setMomEnabled(d.momentumEnabled);
        setMomMinChg(String(Math.round(d.breakoutMinChg * 100)));
        setMomMinVol(String(d.breakoutMinVol));
        setMomWRegime(String(d.scoreWeightRegime));
        setMomWBreakout(String(d.scoreWeightBreakout));
        setMomWSector(String(d.scoreWeightSector));
        setMomWLiquidity(String(d.scoreWeightLiquidity));
      }
    } catch { /* silent */ }
  }

  async function saveMomentumSettings() {
    setMomSaving(true);
    setMomStatus(null);
    const wSum = parseFloat(momWRegime) + parseFloat(momWBreakout) + parseFloat(momWSector) + parseFloat(momWLiquidity);
    if (Math.abs(wSum - 1.0) > 0.02) {
      setMomStatus(`✗ Weights sum to ${wSum.toFixed(3)} — must be 1.00`);
      setMomSaving(false);
      return;
    }
    try {
      const res = await fetch("/api/settings/momentum", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          momentumEnabled: momEnabled,
          breakoutMinChg: parseFloat(momMinChg) / 100,
          breakoutMinVol: parseFloat(momMinVol),
          scoreWeightRegime: parseFloat(momWRegime),
          scoreWeightBreakout: parseFloat(momWBreakout),
          scoreWeightSector: parseFloat(momWSector),
          scoreWeightLiquidity: parseFloat(momWLiquidity),
        }),
      });
      if (res.ok) {
        setMomStatus("✓ Saved");
        setTimeout(() => setMomStatus(null), 3000);
      } else {
        const d = await res.json().catch(() => ({ error: "Failed" }));
        setMomStatus(`✗ ${d.error ?? "Failed"}`);
      }
    } catch { setMomStatus("✗ Network error"); }
    setMomSaving(false);
  }

  // ── Alerts ──
  async function fetchAlerts() {
    setAlertsLoading(true);
    try {
      const res = await fetch("/api/alerts");
      if (res.ok) {
        const d = await res.json();
        setAlerts((d.alerts ?? []).slice(0, 10));
      }
    } catch { /* silent */ }
    setAlertsLoading(false);
  }

  async function fetchRunnerStatus() {
    try {
      const [runnerRes, momRes] = await Promise.all([
        fetch("/api/trades/runner"),
        fetch("/api/settings/momentum"),
      ]);
      if (runnerRes.ok) {
        const d = await runnerRes.json();
        setRunnerTicker(d.runner?.ticker ?? null);
        setRunnerSlotAvailable(d.slotAvailable);
        setRunnerPhase(d.phase);
      }
      if (momRes.ok) {
        const d = await momRes.json();
        if (d.runnerEnabled !== undefined) setRunnerEnabled(d.runnerEnabled);
        if (d.runnerProfitThreshold !== undefined) setRunnerThreshold(String(Math.round(d.runnerProfitThreshold * 100)));
        if (d.runnerLookbackDays !== undefined) setRunnerLookback(String(d.runnerLookbackDays));
      }
    } catch { /* silent */ }
  }

  async function saveRunnerSettings() {
    setRunnerSaving(true);
    setRunnerStatus(null);
    try {
      const res = await fetch("/api/settings/momentum", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runnerEnabled,
          runnerProfitThreshold: parseFloat(runnerThreshold) / 100,
          runnerLookbackDays: parseInt(runnerLookback, 10),
        }),
      });
      if (res.ok) {
        setRunnerStatus("✓ Saved");
        setTimeout(() => setRunnerStatus(null), 3000);
      } else {
        const d = await res.json().catch(() => ({ error: "Failed" }));
        setRunnerStatus(`✗ ${d.error ?? "Failed"}`);
      }
    } catch { setRunnerStatus("✗ Network error"); }
    setRunnerSaving(false);
  }

  async function acknowledgeAlert(id: number) {
    await fetch("/api/alerts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  }

  async function clearAllAlerts() {
    await fetch("/api/alerts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true }),
    });
    setAlerts([]);
  }

  async function fetchSettings() {
    try {
      const res = await fetch("/api/settings");
      if (res.ok) {
        const json = await res.json();
        setData(json);
        if (json.t212) {
          setT212Env(json.t212.environment);
          setAccountType(json.t212.accountType);
        }
        if (json.settings.riskPctPerTrade) setRiskPct(json.settings.riskPctPerTrade);
        if (json.settings.maxPositions) setMaxPositions(json.settings.maxPositions);
        if (json.settings.maxExposure) setMaxExposure(json.settings.maxExposure);
        if (json.settings.balanceSource) setBalanceSource(json.settings.balanceSource);
        if (json.settings.manualBalance) setManualBalance(json.settings.manualBalance);
      }
    } catch {
      showError("Failed to load settings");
    } finally {
      setLoading(false);
    }
  }

  async function testT212() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/t212/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: t212ApiKey, apiSecret: t212ApiSecret, environment: t212Env }),
      });
      const json = await res.json();
      setTestResult(json);
    } catch {
      setTestResult({ success: false, error: "Network failure" });
    } finally {
      setTesting(false);
    }
  }

  async function saveT212() {
    setSavingT212(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          t212: {
            environment: t212Env,
            accountType,
            apiKey: t212ApiKey || undefined,
            apiSecret: t212ApiSecret || undefined,
          },
        }),
      });
      if (res.ok) {
        fetchSettings();
      } else {
        const json = await res.json().catch(() => ({ error: "Save failed" }));
        showError(json.error ?? "Failed to save T212 settings");
      }
    } catch {
      showError("Failed to save T212 settings");
    } finally {
      setSavingT212(false);
    }
  }

  async function saveSettings() {
    setSaving(true);
    setSaveMessage(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: { riskPctPerTrade: riskPct, maxPositions, maxExposure, balanceSource, manualBalance },
          t212: { environment: t212Env, accountType },
        }),
      });
      if (res.ok) {
        setSaveMessage("Settings saved");
        setTimeout(() => setSaveMessage(null), 3000);
      }
    } catch {
      setSaveMessage("Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function dangerAction(action: string) {
    if (dangerConfirm !== "CONFIRM") return;
    setDangerResult(null);
    try {
      const res = await fetch("/api/settings/danger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, confirm: dangerConfirm }),
      });
      const json = await res.json();
      if (res.ok) {
        setDangerResult(`Cleared ${json.cleared} ${json.type}`);
        setDangerConfirm("");
      } else {
        setDangerResult(json.error ?? "Failed");
      }
    } catch {
      setDangerResult("Failed");
    }
  }

  function fmtTime(iso: string | null): string {
    if (!iso) return "Never";
    const d = new Date(iso);
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) + " - " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  }

  if (loading) {
    return (
      <main className="min-h-screen p-4 max-w-[900px] mx-auto">
        <p className="text-[var(--dim)] text-sm">Loading settings...</p>
      </main>
    );
  }

  const canTest = t212ApiKey.length > 0 && t212ApiSecret.length > 0;
  const canSaveT212 = t212ApiKey.length > 0 && t212ApiSecret.length > 0;

  return (
    <main className="min-h-screen p-4 max-w-[900px] mx-auto">
      {errorMsg && (
        <div
          role="alert"
          className="fixed top-4 right-4 z-50 px-4 py-2 text-sm text-white bg-red-600/90 border border-red-500 rounded shadow-lg backdrop-blur-sm"
          style={mono}
        >
          {errorMsg}
          <button onClick={() => setErrorMsg(null)} className="ml-3 text-white/70 hover:text-white">✕</button>
        </div>
      )}
      {/* NAV */}
      <header className="flex items-center gap-4 border-b border-[var(--border)] pb-3 mb-6">
        <h1 className="text-xl font-bold tracking-tight text-[var(--green)]" style={mono}>VolumeTurtle</h1>
        <nav className="flex items-center gap-4 text-sm ml-4" style={mono}>
          <Link href="/" className="text-[var(--dim)] hover:text-white transition-colors">DASHBOARD</Link>
          <Link href="/journal" className="text-[var(--dim)] hover:text-white transition-colors">JOURNAL</Link>
          <Link href="/momentum" className="text-[var(--dim)] hover:text-white transition-colors">MOMENTUM</Link>
          <Link href="/watchlist" className="text-[var(--dim)] hover:text-white transition-colors">WATCHLIST</Link>
          <Link href="/execution" className="text-[var(--amber)] hover:text-white transition-colors">PENDING</Link>
          <span className="text-white font-semibold border-b-2 border-[var(--green)] pb-0.5">SETTINGS</span>
        </nav>
      </header>

      {/* TRADING 212 CONNECTION */}
      <section className="mb-8">
        <h2 className="text-xs font-semibold text-[var(--dim)] mb-4 tracking-widest border-b border-[var(--border)] pb-2">
          TRADING 212 CONNECTION
        </h2>
        <div className="space-y-4 text-xs" style={mono}>
          <div className="flex items-center gap-4">
            <span className="text-[var(--dim)] w-28 shrink-0">Environment</span>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="t212-env"
                  value="demo"
                  checked={t212Env === "demo"}
                  onChange={() => setT212Env("demo")}
                  className="accent-[var(--green)]"
                />
                Demo
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="t212-env"
                  value="live"
                  checked={t212Env === "live"}
                  onChange={() => setT212Env("live")}
                  className="accent-[var(--green)]"
                />
                Live
              </label>
            </div>
            <span className="text-[#555] text-[10px]">Use Demo first to verify safely</span>
          </div>

          <div className="flex items-center gap-4">
            <span className="text-[var(--dim)] w-28 shrink-0">API Key</span>
            <input
              type={showApiKey ? "text" : "password"}
              value={t212ApiKey}
              onChange={(e) => setT212ApiKey(e.target.value)}
              placeholder={data?.t212Configured ? "(stored in .env)" : "Enter API key"}
              className="flex-1 px-3 py-2 bg-[#0a0a0a] border border-[#333] text-white text-xs focus:border-[var(--green)] outline-none"
              style={mono}
            />
            <button onClick={() => setShowApiKey(!showApiKey)} className="px-3 py-2 text-[10px] text-[var(--dim)] border border-[#444] hover:border-[var(--green)] hover:text-[var(--green)] transition-colors uppercase tracking-wider">
              {showApiKey ? "HIDE" : "SHOW"}
            </button>
          </div>

          <div className="flex items-center gap-4">
            <span className="text-[var(--dim)] w-28 shrink-0">API Secret</span>
            <input
              type={showApiSecret ? "text" : "password"}
              value={t212ApiSecret}
              onChange={(e) => setT212ApiSecret(e.target.value)}
              placeholder="Enter API secret"
              className="flex-1 px-3 py-2 bg-[#0a0a0a] border border-[#333] text-white text-xs focus:border-[var(--green)] outline-none"
              style={mono}
            />
            <button onClick={() => setShowApiSecret(!showApiSecret)} className="px-3 py-2 text-[10px] text-[var(--dim)] border border-[#444] hover:border-[var(--green)] hover:text-[var(--green)] transition-colors uppercase tracking-wider">
              {showApiSecret ? "HIDE" : "SHOW"}
            </button>
          </div>

          <div className="flex items-center gap-3 pt-1">
            <div className="w-28 shrink-0" />
            <button onClick={testT212} disabled={testing || !canTest} className="px-4 py-2 border border-[#444] text-[var(--dim)] hover:border-[var(--amber)] hover:text-[var(--amber)] transition-colors uppercase tracking-wider text-[10px] disabled:opacity-30 disabled:cursor-not-allowed">
              {testing ? "TESTING..." : "TEST CONNECTION"}
            </button>
            <button onClick={saveT212} disabled={!canSaveT212 || savingT212} className="px-4 py-2 border border-[var(--green)] text-[var(--green)] hover:bg-[var(--green)] hover:text-black transition-colors uppercase tracking-wider text-[10px] disabled:opacity-30 disabled:cursor-not-allowed">
              {savingT212 ? "SAVING..." : "SAVE"}
            </button>
          </div>

          {testResult && (
            <div className="pt-2 border-t border-[var(--border)]">
              <div className="flex items-start gap-4">
                <span className="text-[var(--dim)] w-28 shrink-0">Status</span>
                <div className="space-y-1">
                  {testResult.success ? (
                    <>
                      <p className="text-[var(--green)]">Connected</p>
                      <p className="text-[var(--green)] text-[10px]">Account: {accountType.toUpperCase()} - {testResult.currency ?? "GBP"}</p>
                      {testResult.accountId && <p className="text-[var(--green)] text-[10px]">Account ID: {testResult.accountId}</p>}
                      {testResult.cash != null && <p className="text-[var(--green)] text-[10px]">Cash balance: {testResult.cash.toFixed(2)}</p>}
                    </>
                  ) : (
                    <>
                      <p className="text-[var(--red)]">Connection failed</p>
                      <p className="text-[var(--red)] text-[10px]">Error: {testResult.error}</p>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {!testResult && (
            <div className="pt-2 border-t border-[var(--border)]">
              <div className="flex items-center gap-4">
                <span className="text-[var(--dim)] w-28 shrink-0">Status</span>
                {data?.t212 ? (
                  <span className={data.t212.connected ? "text-[var(--green)]" : "text-[var(--dim)]"}>
                    {data.t212.connected ? `Connected - Last sync: ${fmtTime(data.t212.lastSyncAt)}` : "Not connected"}
                  </span>
                ) : (
                  <span className="text-[var(--dim)]">Not connected</span>
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ACCOUNT SETTINGS */}
      <section className="mb-8">
        <h2 className="text-xs font-semibold text-[var(--dim)] mb-4 tracking-widest border-b border-[var(--border)] pb-2">
          ACCOUNT SETTINGS
        </h2>
        <div className="space-y-4 text-xs" style={mono}>
          <div className="flex items-center gap-4">
            <span className="text-[var(--dim)] w-28 shrink-0">Account type</span>
            {(["invest", "isa"] as const).map((t) => (
              <label key={t} className="flex items-center gap-2 cursor-pointer" onClick={() => setAccountType(t)}>
                <span className={`w-3 h-3 rounded-full border-2 inline-flex items-center justify-center ${accountType === t ? "border-[var(--green)]" : "border-[#444]"}`}>
                  {accountType === t && <span className="w-1.5 h-1.5 rounded-full bg-[var(--green)]" />}
                </span>
                {t.toUpperCase()}
              </label>
            ))}
          </div>

          <div className="flex items-center gap-4">
            <span className="text-[var(--dim)] w-28 shrink-0">Balance source</span>
            <label className="flex items-center gap-2 cursor-pointer" onClick={() => { if (data?.t212 || data?.t212Configured) setBalanceSource("t212"); }}>
              <span className={`w-3 h-3 rounded-full border-2 inline-flex items-center justify-center ${balanceSource === "t212" ? "border-[var(--green)]" : "border-[#444]"}`}>
                {balanceSource === "t212" && <span className="w-1.5 h-1.5 rounded-full bg-[var(--green)]" />}
              </span>
              <span className={!(data?.t212 || data?.t212Configured) ? "text-[#444]" : ""}>Pull from Trading 212</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer" onClick={() => setBalanceSource("manual")}>
              <span className={`w-3 h-3 rounded-full border-2 inline-flex items-center justify-center ${balanceSource === "manual" ? "border-[var(--green)]" : "border-[#444]"}`}>
                {balanceSource === "manual" && <span className="w-1.5 h-1.5 rounded-full bg-[var(--green)]" />}
              </span>
              Manual entry
            </label>
            {balanceSource === "manual" && (
              <div className="flex items-center gap-1 ml-2">
                <span className="text-[var(--dim)]">GBP</span>
                <input type="number" value={manualBalance} onChange={(e) => setManualBalance(e.target.value)} className="w-24 px-2 py-1.5 bg-[#0a0a0a] border border-[#333] text-white focus:border-[var(--green)] outline-none" style={mono} />
              </div>
            )}
          </div>

          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <span className="text-[var(--dim)]">Risk/trade</span>
              <input type="number" value={riskPct} onChange={(e) => setRiskPct(e.target.value)} className="w-14 px-2 py-1.5 bg-[#0a0a0a] border border-[#333] text-white text-center focus:border-[var(--green)] outline-none" style={mono} />
              <span className="text-[var(--dim)]">%</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[var(--dim)]">Max positions</span>
              <input type="number" value={maxPositions} onChange={(e) => setMaxPositions(e.target.value)} className="w-14 px-2 py-1.5 bg-[#0a0a0a] border border-[#333] text-white text-center focus:border-[var(--green)] outline-none" style={mono} />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[var(--dim)]">Max exposure</span>
            <input type="number" value={maxExposure} onChange={(e) => setMaxExposure(e.target.value)} className="w-14 px-2 py-1.5 bg-[#0a0a0a] border border-[#333] text-white text-center focus:border-[var(--green)] outline-none" style={mono} />
            <span className="text-[var(--dim)]">% per position</span>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button onClick={saveSettings} disabled={saving} className="px-4 py-2 border border-[var(--green)] text-[var(--green)] hover:bg-[var(--green)] hover:text-black transition-colors uppercase tracking-wider text-[10px] font-semibold disabled:opacity-40">
              {saving ? "SAVING..." : "SAVE SETTINGS"}
            </button>
            {saveMessage && <span className="text-[var(--green)] text-[10px]">{saveMessage}</span>}
          </div>
        </div>
      </section>

      {/* TELEGRAM NOTIFICATIONS */}
      <section className="mb-8">
        <h2 className="text-xs font-semibold text-[var(--dim)] mb-4 tracking-widest border-b border-[var(--border)] pb-2">
          TELEGRAM NOTIFICATIONS
        </h2>
        <div className="space-y-4 text-xs" style={mono}>
          <div className="flex items-center gap-4">
            <span className="text-[var(--dim)] w-28 shrink-0">Status</span>
            {tgConfigured ? (
              <span className="text-[var(--green)]">Configured {tgEnabled ? "· Enabled" : "· Disabled"}</span>
            ) : (
              <span className="text-[var(--dim)]">Not configured</span>
            )}
          </div>
          <div className="flex items-center gap-4">
            <span className="text-[var(--dim)] w-28 shrink-0">Bot Token</span>
            <input
              type={tgShowToken ? "text" : "password"}
              value={tgBotToken}
              onChange={(e) => setTgBotToken(e.target.value)}
              placeholder={tgConfigured ? "(stored)" : "123456:ABC-DEF..."}
              className="flex-1 px-3 py-2 bg-[#0a0a0a] border border-[#333] text-white text-xs focus:border-[var(--green)] outline-none"
              style={mono}
            />
            <button onClick={() => setTgShowToken(!tgShowToken)} className="px-3 py-2 text-[10px] text-[var(--dim)] border border-[#444] hover:border-[var(--green)] hover:text-[var(--green)] transition-colors uppercase tracking-wider">
              {tgShowToken ? "HIDE" : "SHOW"}
            </button>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-[var(--dim)] w-28 shrink-0">Chat ID</span>
            <input
              type="text"
              value={tgChatId}
              onChange={(e) => setTgChatId(e.target.value)}
              placeholder="-100123456789"
              className="flex-1 px-3 py-2 bg-[#0a0a0a] border border-[#333] text-white text-xs focus:border-[var(--green)] outline-none"
              style={mono}
            />
          </div>
          <div className="flex items-center gap-4">
            <span className="text-[var(--dim)] w-28 shrink-0">Enabled</span>
            <button
              onClick={() => setTgEnabled(!tgEnabled)}
              className={`w-10 h-5 rounded-full transition-colors relative ${tgEnabled ? "bg-[var(--green)]" : "bg-[#333]"}`}
            >
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${tgEnabled ? "left-5" : "left-0.5"}`} />
            </button>
          </div>
          <div className="flex items-center gap-3 pt-1">
            <div className="w-28 shrink-0" />
            <button onClick={saveTelegram} disabled={tgSaving || (!tgBotToken && !tgConfigured)} className="px-4 py-2 border border-[var(--green)] text-[var(--green)] hover:bg-[var(--green)] hover:text-black transition-colors uppercase tracking-wider text-[10px] disabled:opacity-30">
              {tgSaving ? "SAVING…" : "SAVE"}
            </button>
            <button onClick={testTelegram} disabled={tgTesting || !tgConfigured} className="px-4 py-2 border border-[#444] text-[var(--dim)] hover:border-[var(--amber)] hover:text-[var(--amber)] transition-colors uppercase tracking-wider text-[10px] disabled:opacity-30">
              {tgTesting ? "SENDING…" : "▶ CONNECT & TEST"}
            </button>
            {tgStatus && <span className={tgStatus.startsWith("✓") ? "text-[var(--green)]" : "text-[var(--red)]"}>{tgStatus}</span>}
          </div>
          <div className="pt-2">
            <button onClick={() => setTgShowSetup(!tgShowSetup)} className="text-[10px] text-[var(--dim)] hover:text-white transition-colors tracking-widest">
              {tgShowSetup ? "▲ HIDE SETUP INSTRUCTIONS" : "▼ SETUP INSTRUCTIONS"}
            </button>
            {tgShowSetup && (
              <div className="mt-2 p-3 border border-[var(--border)] bg-[#0a0a0a] text-[10px] text-[var(--dim)] space-y-1 leading-relaxed">
                <p>1. Message <span className="text-white">@BotFather</span> on Telegram</p>
                <p>2. Send <span className="text-white">/newbot</span> and follow the prompts</p>
                <p>3. Copy the <span className="text-white">bot token</span> (looks like 123456:ABC-DEF…)</p>
                <p>4. Create a channel/group and add your bot as admin</p>
                <p>5. Send a message in the channel, then visit:</p>
                <p className="text-white ml-3">https://api.telegram.org/bot&lt;TOKEN&gt;/getUpdates</p>
                <p>6. Find the <span className="text-white">chat.id</span> value (negative number for groups)</p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* MOMENTUM ENGINE */}
      <section className="mb-8">
        <h2 className="text-xs font-semibold text-[var(--dim)] mb-4 tracking-widest border-b border-[var(--border)] pb-2">
          MOMENTUM ENGINE
        </h2>
        <div className="space-y-4 text-xs" style={mono}>
          <div className="flex items-center gap-4">
            <span className="text-[var(--dim)] w-28 shrink-0">Enabled</span>
            <button
              onClick={() => setMomEnabled(!momEnabled)}
              className={`w-10 h-5 rounded-full transition-colors relative ${momEnabled ? "bg-[var(--green)]" : "bg-[#333]"}`}
            >
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${momEnabled ? "left-5" : "left-0.5"}`} />
            </button>
            <span className="text-[var(--dim)]">{momEnabled ? "Momentum scan runs nightly" : "Momentum scan disabled"}</span>
          </div>
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <span className="text-[var(--dim)]">Min CHG%</span>
              <input type="number" step="1" value={momMinChg} onChange={(e) => setMomMinChg(e.target.value)} className="w-16 px-2 py-1.5 bg-[#0a0a0a] border border-[#333] text-white text-center focus:border-[var(--green)] outline-none" style={mono} />
              <span className="text-[var(--dim)]">%</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[var(--dim)]">Min Vol</span>
              <input type="number" step="0.1" value={momMinVol} onChange={(e) => setMomMinVol(e.target.value)} className="w-16 px-2 py-1.5 bg-[#0a0a0a] border border-[#333] text-white text-center focus:border-[var(--green)] outline-none" style={mono} />
              <span className="text-[var(--dim)]">×</span>
            </div>
          </div>
          <div>
            <p className="text-[var(--dim)] mb-2">Score weights (must sum to 1.00):</p>
            <div className="grid grid-cols-4 gap-3">
              {([["Regime", momWRegime, setMomWRegime], ["Breakout", momWBreakout, setMomWBreakout], ["Sector", momWSector, setMomWSector], ["Liquidity", momWLiquidity, setMomWLiquidity]] as [string, string, (v: string) => void][]).map(([label, value, setter]) => (
                <div key={label} className="flex flex-col items-center gap-1">
                  <span className="text-[10px] text-[var(--dim)]">{label}</span>
                  <input type="number" step="0.01" min="0" max="1" value={value} onChange={(e) => setter(e.target.value)} className="w-16 px-2 py-1.5 bg-[#0a0a0a] border border-[#333] text-white text-center focus:border-[var(--green)] outline-none" style={mono} />
                </div>
              ))}
            </div>
            {(() => {
              const sum = parseFloat(momWRegime) + parseFloat(momWBreakout) + parseFloat(momWSector) + parseFloat(momWLiquidity);
              const ok = Math.abs(sum - 1.0) <= 0.02;
              return (
                <p className={`text-[10px] mt-1 ${ok ? "text-[var(--green)]" : "text-[var(--red)]"}`}>
                  Sum: {isNaN(sum) ? "—" : sum.toFixed(2)} {ok ? "✓" : "⚠ must equal 1.00"}
                </p>
              );
            })()}
          </div>
          <div className="flex items-center gap-3 pt-1">
            <button onClick={saveMomentumSettings} disabled={momSaving} className="px-4 py-2 border border-[var(--green)] text-[var(--green)] hover:bg-[var(--green)] hover:text-black transition-colors uppercase tracking-wider text-[10px] font-semibold disabled:opacity-40">
              {momSaving ? "SAVING…" : "▶ SAVE"}
            </button>
            {momStatus && <span className={momStatus.startsWith("✓") ? "text-[var(--green)]" : "text-[var(--red)]"}>{momStatus}</span>}
          </div>
        </div>
      </section>

      {/* RECENT ALERTS */}
      <section className="mb-8">
        <h2 className="text-xs font-semibold text-[var(--dim)] mb-4 tracking-widest border-b border-[var(--border)] pb-2">
          ALERT NOTIFICATIONS
        </h2>
        <div className="space-y-2 text-xs" style={mono}>
          {alertsLoading ? (
            <p className="text-[var(--dim)]">Loading…</p>
          ) : alerts.length === 0 ? (
            <p className="text-[var(--dim)]">No unacknowledged alerts</p>
          ) : (
            <>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[var(--dim)]">{alerts.length} alert{alerts.length !== 1 ? "s" : ""}</span>
                <button onClick={clearAllAlerts} className="px-3 py-1 text-[9px] border border-[var(--red)] text-[var(--red)] hover:bg-[var(--red)] hover:text-black transition-colors uppercase tracking-wider">
                  CLEAR ALL
                </button>
              </div>
              {alerts.map((a) => (
                <div key={a.id} className="flex items-start gap-3 px-3 py-2 border border-[var(--border)] hover:bg-[#1a1a1a]">
                  <span className={a.severity === "critical" ? "text-[var(--red)]" : a.severity === "warning" ? "text-[var(--amber)]" : "text-[var(--dim)]"}>
                    {a.severity === "critical" ? "🔴" : a.severity === "warning" ? "🟡" : "ℹ️"}
                  </span>
                  <div className="flex-1 min-w-0">
                    <span className="font-semibold text-white">{a.ticker}</span>
                    <span className="text-[var(--dim)] ml-1.5">{a.type}</span>
                    <p className="text-[var(--dim)] text-[10px] mt-0.5 break-words">{a.message}</p>
                  </div>
                  <button onClick={() => acknowledgeAlert(a.id)} className="text-[var(--dim)] hover:text-white shrink-0">✕</button>
                </div>
              ))}
            </>
          )}
        </div>
      </section>

      {/* AUTO-EXECUTION */}
      <section className="mb-8">
        <h2 className="text-xs font-semibold text-[var(--amber)] mb-4 tracking-widest border-b border-[var(--amber)]/30 pb-2">
          ⚡ AUTO-EXECUTION
        </h2>
        <div className="space-y-4 text-xs" style={mono}>
          {/* Enable toggle */}
          <div className="flex items-center gap-4">
            <span className="text-[var(--dim)] w-28 shrink-0">Auto-execution</span>
            {!autoExecShowConfirm ? (
              <button
                onClick={() => {
                  if (autoExecEnabled) {
                    // Disable directly (no confirmation needed to turn off)
                    setAutoExecEnabled(false);
                    saveAutoExecSettings();
                  } else {
                    setAutoExecShowConfirm(true);
                  }
                }}
                className={`w-10 h-5 rounded-full transition-colors relative ${autoExecEnabled ? "bg-[var(--amber)]" : "bg-[#333]"}`}
              >
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${autoExecEnabled ? "left-5" : "left-0.5"}`} />
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={autoExecConfirmText}
                  onChange={(e) => setAutoExecConfirmText(e.target.value)}
                  placeholder='Type "ENABLE AUTO"'
                  className="w-40 px-2 py-1.5 bg-[#0a0a0a] border border-[var(--amber)]/40 text-white text-xs focus:border-[var(--amber)] outline-none"
                  style={mono}
                />
                <button
                  onClick={() => {
                    if (autoExecConfirmText === "ENABLE AUTO") {
                      setAutoExecEnabled(true);
                      setAutoExecShowConfirm(false);
                    }
                  }}
                  disabled={autoExecConfirmText !== "ENABLE AUTO"}
                  className="px-3 py-1.5 border border-[var(--amber)] text-[var(--amber)] hover:bg-[var(--amber)] hover:text-black transition-colors uppercase tracking-wider text-[10px] disabled:opacity-20 disabled:cursor-not-allowed"
                >
                  ENABLE
                </button>
                <button onClick={() => { setAutoExecShowConfirm(false); setAutoExecConfirmText(""); }} className="text-[var(--dim)] hover:text-white text-xs">✕</button>
              </div>
            )}
            <span className={autoExecEnabled ? "text-[var(--amber)]" : "text-[var(--dim)]"}>
              {autoExecEnabled ? "LIVE — real orders will be placed" : "Disabled"}
            </span>
          </div>

          {autoExecEnabled && (
            <div className="p-3 bg-[var(--amber)]/10 border border-[var(--amber)]/30 text-[var(--amber)] text-[10px]">
              ⚠ Auto-execution is <b>ACTIVE</b>. Grade {autoExecMinGrade === "A" ? "A" : "A and B"} signals from scans will place real market orders via your Trading 212 Live account after a {autoExecWindow}-minute cancellation window.
            </div>
          )}

          {/* Min grade */}
          <div className="flex items-center gap-4">
            <span className="text-[var(--dim)] w-28 shrink-0">Minimum grade</span>
            <select
              className="bg-[#0a0a0a] border border-[#333] text-white px-2 py-1.5 text-xs focus:border-[var(--amber)] outline-none"
              value={autoExecMinGrade}
              onChange={(e) => setAutoExecMinGrade(e.target.value)}
              style={mono}
            >
              <option value="A">A only</option>
              <option value="B">A and B</option>
            </select>
          </div>

          {/* Cancel window */}
          <div className="flex items-center gap-4">
            <span className="text-[var(--dim)] w-28 shrink-0">Cancel window</span>
            <input type="number" step="1" min="5" max="60" value={autoExecWindow} onChange={(e) => setAutoExecWindow(e.target.value)} className="w-16 px-2 py-1.5 bg-[#0a0a0a] border border-[#333] text-white text-center focus:border-[var(--amber)] outline-none" style={mono} />
            <span className="text-[var(--dim)]">minutes (5–60)</span>
          </div>

          {/* Max daily */}
          <div className="flex items-center gap-4">
            <span className="text-[var(--dim)] w-28 shrink-0">Max daily orders</span>
            <input type="number" step="1" min="1" max="10" value={autoExecMaxPerDay} onChange={(e) => setAutoExecMaxPerDay(e.target.value)} className="w-16 px-2 py-1.5 bg-[#0a0a0a] border border-[#333] text-white text-center focus:border-[var(--amber)] outline-none" style={mono} />
            <span className="text-[var(--dim)]">per calendar day</span>
          </div>

          {/* Execution hours */}
          <div className="flex items-center gap-4">
            <span className="text-[var(--dim)] w-28 shrink-0">Execution hours</span>
            <input type="number" step="1" min="0" max="23" value={autoExecStartHour} onChange={(e) => setAutoExecStartHour(e.target.value)} className="w-12 px-2 py-1.5 bg-[#0a0a0a] border border-[#333] text-white text-center focus:border-[var(--amber)] outline-none" style={mono} />
            <span className="text-[var(--dim)]">to</span>
            <input type="number" step="1" min="0" max="23" value={autoExecEndHour} onChange={(e) => setAutoExecEndHour(e.target.value)} className="w-12 px-2 py-1.5 bg-[#0a0a0a] border border-[#333] text-white text-center focus:border-[var(--amber)] outline-none" style={mono} />
            <span className="text-[var(--dim)]">UTC</span>
          </div>

          {/* Max per sector */}
          <div className="flex items-start gap-4">
            <span className="text-[var(--dim)] w-28 shrink-0 pt-1.5">Max per sector</span>
            <div>
              <div className="flex items-center gap-2">
                <input type="number" step="1" min="1" max="5" value={autoExecMaxPerSector} onChange={(e) => setAutoExecMaxPerSector(e.target.value)} className="w-16 px-2 py-1.5 bg-[#0a0a0a] border border-[#333] text-white text-center focus:border-[var(--amber)] outline-none" style={mono} />
                <span className="text-[var(--dim)]">positions per sector</span>
              </div>
              <p className="text-[10px] text-[#555] mt-0.5 max-w-[300px]">Prevents overexposure to correlated positions. Example: max 2 means no more than 2 Energy stocks open simultaneously.</p>
            </div>
          </div>

          {/* Save + Emergency */}
          <div className="flex items-center gap-3 pt-1">
            <button onClick={saveAutoExecSettings} disabled={autoExecSaving} className="px-4 py-2 border border-[var(--amber)] text-[var(--amber)] hover:bg-[var(--amber)] hover:text-black transition-colors uppercase tracking-wider text-[10px] font-semibold disabled:opacity-40">
              {autoExecSaving ? "SAVING…" : "▶ SAVE"}
            </button>

            {autoExecEnabled && (
              <button onClick={emergencyDisableAutoExec} disabled={autoExecDisabling} className="px-4 py-2 bg-[var(--red)]/20 border border-[var(--red)] text-[var(--red)] hover:bg-[var(--red)] hover:text-black transition-colors uppercase tracking-wider text-[10px] font-semibold disabled:opacity-40">
                {autoExecDisabling ? "DISABLING…" : "⛔ DISABLE ALL AUTO-EXECUTION"}
              </button>
            )}

            {autoExecStatus && <span className={autoExecStatus.startsWith("✓") ? "text-[var(--green)]" : autoExecStatus.startsWith("⛔") ? "text-[var(--red)]" : "text-[var(--red)]"}>{autoExecStatus}</span>}
          </div>

          {/* Execution history */}
          <div className="pt-3 border-t border-[var(--border)]">
            <button
              onClick={() => { setExecLogsExpanded(!execLogsExpanded); if (!execLogsExpanded) fetchExecLogs(); }}
              className="text-[var(--dim)] hover:text-white text-[10px] uppercase tracking-wider"
            >
              {execLogsExpanded ? "▾ Execution history" : "▸ Execution history"}
            </button>
            {execLogsExpanded && (
              <div className="mt-2 space-y-1 max-h-60 overflow-y-auto">
                {execLogs.length === 0 ? (
                  <p className="text-[var(--dim)] text-[10px]">No execution history</p>
                ) : (
                  execLogs.map((log) => (
                    <div key={log.id} className="flex items-start gap-2 text-[10px] px-2 py-1 border border-[var(--border)] hover:bg-[#1a1a1a]">
                      <span className={
                        log.event === "CONFIRMED" ? "text-[var(--green)]" :
                        log.event === "FAILED" || log.event === "PRE_FLIGHT_FAIL" || log.event === "STOP_PUSH_FAILED" ? "text-[var(--red)]" :
                        log.event === "CANCELLED" || log.event === "EXPIRED" ? "text-[var(--dim)]" :
                        "text-[var(--amber)]"
                      }>
                        {log.event}
                      </span>
                      <span className="text-[var(--dim)] shrink-0">
                        #{log.orderId}
                      </span>
                      <span className="text-white flex-1 break-words">{log.detail}</span>
                      <span className="text-[var(--dim)] shrink-0">
                        {new Date(log.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* STOP PUSH STATUS */}
      <section className="mb-8">
        <h2 className="text-xs font-semibold text-[var(--red)] mb-4 tracking-widest border-b border-[var(--red)]/30 pb-2">
          🛡 STOP PUSH STATUS
        </h2>
        <div className="space-y-4 text-xs" style={mono}>
          <div className="flex items-center gap-4">
            <span className="text-[var(--dim)] w-28 shrink-0">Unprotected</span>
            <span className={unprotectedTrades.length > 0 ? "text-[var(--red)] font-bold" : "text-[var(--green)]"}>
              {unprotectedTrades.length > 0
                ? `⚠ ${unprotectedTrades.length} position(s) without T212 stop`
                : "✓ All positions protected"}
            </span>
          </div>

          {unprotectedTrades.length > 0 && (
            <div className="space-y-2">
              {unprotectedTrades.map((t) => (
                <div key={t.id} className="flex items-center gap-3 px-3 py-1.5 border border-[var(--red)]/30 bg-[var(--red)]/5">
                  <span className="text-white font-bold">{t.ticker}</span>
                  <span className="text-[var(--dim)]">Attempts: {t.stopPushAttempts}</span>
                  {t.stopPushError && (
                    <span className="text-[var(--red)] text-[10px] truncate max-w-[300px]">{t.stopPushError}</span>
                  )}
                </div>
              ))}

              <button
                onClick={retryStopPush}
                disabled={pushRetrying}
                className="px-4 py-1.5 bg-[var(--red)] text-black text-[10px] font-bold tracking-wider hover:opacity-80 disabled:opacity-50"
              >
                {pushRetrying ? "PUSHING STOPS…" : "🔄 RETRY ALL STOP PUSHES"}
              </button>

              {pushStatus && (
                <p className="text-[var(--amber)] text-[10px]">{pushStatus}</p>
              )}
            </div>
          )}
        </div>
      </section>

      {/* RUNNER MANDATE */}
      <section className="mb-8">
        <h2 className="text-xs font-semibold text-[#00e5ff] mb-4 tracking-widest border-b border-[#00e5ff]/30 pb-2">
          🏃 RUNNER MANDATE
        </h2>
        <div className="space-y-4 text-xs" style={mono}>
          <div className="flex items-center gap-4">
            <span className="text-[var(--dim)] w-28 shrink-0">Runner mandate</span>
            <button
              onClick={() => setRunnerEnabled(!runnerEnabled)}
              className={`w-10 h-5 rounded-full transition-colors relative ${runnerEnabled ? "bg-[#00e5ff]" : "bg-[#333]"}`}
            >
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${runnerEnabled ? "left-5" : "left-0.5"}`} />
            </button>
            <span className="text-[var(--dim)]">{runnerEnabled ? "Enabled — one runner per cycle" : "Disabled"}</span>
          </div>

          <div className="flex items-center gap-4">
            <span className="text-[var(--dim)] w-28 shrink-0">Profit threshold</span>
            <input type="number" step="5" min="10" max="100" value={runnerThreshold} onChange={(e) => setRunnerThreshold(e.target.value)} className="w-16 px-2 py-1.5 bg-[#0a0a0a] border border-[#333] text-white text-center focus:border-[#00e5ff] outline-none" style={mono} />
            <span className="text-[var(--dim)]">% to activate wide exit</span>
          </div>

          <div className="flex items-center gap-4">
            <span className="text-[var(--dim)] w-28 shrink-0">Lookback period</span>
            <input type="number" step="1" min="5" max="60" value={runnerLookback} onChange={(e) => setRunnerLookback(e.target.value)} className="w-16 px-2 py-1.5 bg-[#0a0a0a] border border-[#333] text-white text-center focus:border-[#00e5ff] outline-none" style={mono} />
            <span className="text-[var(--dim)]">days (wide exit trailing stop window)</span>
          </div>

          <div className="flex items-center gap-4">
            <span className="text-[var(--dim)] w-28 shrink-0">Phase 1 logic</span>
            <span className="text-[#555]">Hard stop only (fixed)</span>
          </div>

          <div className="flex items-center gap-4">
            <span className="text-[var(--dim)] w-28 shrink-0">Current runner</span>
            {runnerTicker ? (
              <span className="text-[#00e5ff] font-bold">{runnerTicker}</span>
            ) : (
              <span className="text-[#555]">None</span>
            )}
          </div>

          <div className="flex items-center gap-4">
            <span className="text-[var(--dim)] w-28 shrink-0">Runner slot</span>
            <span className={runnerSlotAvailable ? "text-[var(--green)]" : "text-[var(--amber)]"}>
              {runnerSlotAvailable ? "AVAILABLE" : "OCCUPIED"}
            </span>
            {runnerPhase !== "none" && (
              <span className={`text-[10px] ${runnerPhase === "active" ? "text-[#00e5ff]" : "text-[var(--amber)]"}`}>
                {runnerPhase === "active" ? "Phase 2 — wide exit" : "Phase 1 — waiting"}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 pt-1">
            <button onClick={saveRunnerSettings} disabled={runnerSaving} className="px-4 py-2 border border-[#00e5ff] text-[#00e5ff] hover:bg-[#00e5ff] hover:text-black transition-colors uppercase tracking-wider text-[10px] font-semibold disabled:opacity-40">
              {runnerSaving ? "SAVING…" : "▶ SAVE"}
            </button>
            {runnerStatus && <span className={runnerStatus.startsWith("✓") ? "text-[var(--green)]" : "text-[var(--red)]"}>{runnerStatus}</span>}
          </div>
        </div>
      </section>

      {/* SYSTEM INFO */}
      <section className="mb-8">
        <h2 className="text-xs font-semibold text-[var(--dim)] mb-4 tracking-widest border-b border-[var(--border)] pb-2">
          SYSTEM INFO
        </h2>
        <div className="space-y-2 text-xs" style={mono}>
          <div className="flex gap-4"><span className="text-[var(--dim)] w-28">Universe</span><span>{data?.system.universeSize ?? "-"} tickers</span></div>
          <div className="flex gap-4"><span className="text-[var(--dim)] w-28">Last scan</span><span>{fmtTime(data?.system.lastScan ?? null)}</span></div>
          <div className="flex gap-4"><span className="text-[var(--dim)] w-28">Database</span><span className="text-[var(--green)]">Connected</span></div>
          <div className="flex gap-4"><span className="text-[var(--dim)] w-28">Yahoo Finance</span><span className="text-[var(--green)]">Active</span></div>
        </div>

        <div className="mt-6 pt-4 border-t border-[var(--border)]">
          <p className="text-[10px] text-[var(--dim)] font-semibold mb-3 tracking-widest uppercase">Data Export & Backup</p>
          <div className="space-y-3 text-xs" style={mono}>
            <div className="flex flex-wrap gap-3">
              <button onClick={() => downloadExport("trades")} className="px-3 py-1.5 border border-[var(--border)] text-[var(--dim)] hover:text-white hover:border-[var(--green)] transition-colors text-[10px] uppercase tracking-wider">
                Export Trades CSV
              </button>
              <button onClick={() => downloadExport("signals")} className="px-3 py-1.5 border border-[var(--border)] text-[var(--dim)] hover:text-white hover:border-[var(--green)] transition-colors text-[10px] uppercase tracking-wider">
                Export Signals CSV
              </button>
              <button onClick={() => downloadExport("full")} className="px-3 py-1.5 border border-[var(--border)] text-[var(--dim)] hover:text-white hover:border-[var(--green)] transition-colors text-[10px] uppercase tracking-wider">
                Download Full Backup
              </button>
            </div>
            <div className="flex flex-wrap gap-4 text-[var(--dim)]">
              <span>Last backup: <span className="text-white">{lastBackupAt ? fmtTime(lastBackupAt) : "Never"}</span></span>
              {backupDir && <span>Folder: <span className="text-white">{backupDir}</span></span>}
            </div>
            <div className="flex items-center gap-3">
              <button onClick={triggerBackup} disabled={backupRunning} className="px-3 py-1.5 border border-[var(--amber)] text-[var(--amber)] hover:bg-[var(--amber)] hover:text-black transition-colors text-[10px] uppercase tracking-wider disabled:opacity-40">
                {backupRunning ? "BACKING UP…" : "RUN BACKUP NOW"}
              </button>
              {backupResult && <span className={backupResult.startsWith("✓") ? "text-[var(--green)]" : "text-[var(--red)]"}>{backupResult}</span>}
            </div>
          </div>
        </div>

        <div className="mt-6 pt-4 border-t border-[var(--red)]/30">
          <p className="text-[10px] text-[var(--red)] font-semibold mb-3 tracking-widest uppercase">Danger Zone</p>
          <p className="text-[10px] text-[#555] mb-3">Type CONFIRM to enable destructive actions:</p>
          <div className="flex items-center gap-3" style={mono}>
            <input type="text" value={dangerConfirm} onChange={(e) => setDangerConfirm(e.target.value)} placeholder="CONFIRM" className="w-28 px-2 py-1.5 bg-[#0a0a0a] border border-[var(--red)]/40 text-white text-xs focus:border-[var(--red)] outline-none" style={mono} />
            <button onClick={() => dangerAction("clear-scans")} disabled={dangerConfirm !== "CONFIRM"} className="px-3 py-1.5 border border-[var(--red)] text-[var(--red)] hover:bg-[var(--red)] hover:text-black transition-colors uppercase tracking-wider text-[10px] disabled:opacity-20 disabled:cursor-not-allowed">
              CLEAR SCAN RESULTS
            </button>
            <button onClick={() => dangerAction("reset-positions")} disabled={dangerConfirm !== "CONFIRM"} className="px-3 py-1.5 border border-[var(--red)] text-[var(--red)] hover:bg-[var(--red)] hover:text-black transition-colors uppercase tracking-wider text-[10px] disabled:opacity-20 disabled:cursor-not-allowed">
              RESET ALL POSITIONS
            </button>
            <button onClick={() => dangerAction("reset-balance-history")} disabled={dangerConfirm !== "CONFIRM"} className="px-3 py-1.5 border border-[var(--red)] text-[var(--red)] hover:bg-[var(--red)] hover:text-black transition-colors uppercase tracking-wider text-[10px] disabled:opacity-20 disabled:cursor-not-allowed" title="Clears account snapshots only, trades are preserved">
              RESET BALANCE HISTORY
            </button>
          </div>
          {dangerResult && <p className="text-[10px] text-[var(--amber)] mt-2">{dangerResult}</p>}
        </div>
      </section>
    </main>
  );
}
