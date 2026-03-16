"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });

      if (res.ok) {
        router.push("/");
      } else {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? "Login failed");
      }
    } catch {
      setError("Connection failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--background, #0a0a0a)",
        fontFamily: "'IBM Plex Sans', sans-serif",
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          background: "var(--card, #141414)",
          border: "1px solid #222",
          borderRadius: 12,
          padding: "2.5rem 2rem",
          width: "100%",
          maxWidth: 380,
          display: "flex",
          flexDirection: "column",
          gap: "1.25rem",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <h1 style={{ color: "#fff", fontSize: "1.5rem", margin: 0 }}>
            🐢 VolumeTurtle
          </h1>
          <p style={{ color: "#888", fontSize: "0.875rem", marginTop: 4 }}>
            Enter your dashboard token to continue
          </p>
        </div>

        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Dashboard token"
          autoFocus
          style={{
            background: "#1a1a1a",
            border: "1px solid #333",
            borderRadius: 8,
            padding: "0.75rem 1rem",
            color: "#fff",
            fontSize: "0.9375rem",
            outline: "none",
          }}
        />

        {error && (
          <p style={{ color: "var(--red, #ef4444)", fontSize: "0.875rem", margin: 0 }}>
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading || !token}
          style={{
            background: loading ? "#333" : "var(--green, #22c55e)",
            color: "#000",
            border: "none",
            borderRadius: 8,
            padding: "0.75rem",
            fontSize: "0.9375rem",
            fontWeight: 600,
            cursor: loading ? "wait" : "pointer",
            opacity: !token ? 0.5 : 1,
          }}
        >
          {loading ? "Logging in…" : "Login"}
        </button>
      </form>
    </div>
  );
}
