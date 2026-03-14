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

  const [t212Env, setT212Env] = useState<"demo" | "live">("demo");
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

  useEffect(() => {
    fetchSettings();
  }, []);

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
      // silent
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
      await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ t212: { environment: t212Env, accountType } }),
      });
      fetchSettings();
    } catch {
      // silent
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
  const canSaveT212 = testResult?.success === true;

  return (
    <main className="min-h-screen p-4 max-w-[900px] mx-auto">
      {/* NAV */}
      <header className="flex items-center gap-4 border-b border-[var(--border)] pb-3 mb-6">
        <h1 className="text-xl font-bold tracking-tight text-[var(--green)]" style={mono}>VolumeTurtle</h1>
        <nav className="flex items-center gap-4 text-sm ml-4" style={mono}>
          <Link href="/" className="text-[var(--dim)] hover:text-white transition-colors">DASHBOARD</Link>
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
              <label className="flex items-center gap-2 cursor-pointer" onClick={() => setT212Env("demo")}>
                <span className={`w-3 h-3 rounded-full border-2 inline-flex items-center justify-center ${t212Env === "demo" ? "border-[var(--green)]" : "border-[#444]"}`}>
                  {t212Env === "demo" && <span className="w-1.5 h-1.5 rounded-full bg-[var(--green)]" />}
                </span>
                Demo
              </label>
              <label className="flex items-center gap-2 cursor-pointer" onClick={() => setT212Env("live")}>
                <span className={`w-3 h-3 rounded-full border-2 inline-flex items-center justify-center ${t212Env === "live" ? "border-[var(--green)]" : "border-[#444]"}`}>
                  {t212Env === "live" && <span className="w-1.5 h-1.5 rounded-full bg-[var(--green)]" />}
                </span>
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
            <label className="flex items-center gap-2 cursor-pointer" onClick={() => { if (data?.t212?.connected) setBalanceSource("t212"); }}>
              <span className={`w-3 h-3 rounded-full border-2 inline-flex items-center justify-center ${balanceSource === "t212" ? "border-[var(--green)]" : "border-[#444]"}`}>
                {balanceSource === "t212" && <span className="w-1.5 h-1.5 rounded-full bg-[var(--green)]" />}
              </span>
              <span className={!data?.t212?.connected ? "text-[#444]" : ""}>Pull from Trading 212</span>
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
          </div>
          {dangerResult && <p className="text-[10px] text-[var(--amber)] mt-2">{dangerResult}</p>}
        </div>
      </section>
    </main>
  );
}
