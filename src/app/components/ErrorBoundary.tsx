"use client";

import React from "react";

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0a0a",
          color: "#888",
          fontFamily: "'JetBrains Mono', monospace",
          padding: "2rem",
        }}>
          <div style={{ maxWidth: 480, textAlign: "center" }}>
            <p style={{ fontSize: "1.25rem", color: "#e5534b", marginBottom: "1rem" }}>
              Something went wrong
            </p>
            <p style={{ fontSize: "0.75rem", marginBottom: "1.5rem", wordBreak: "break-word" }}>
              {this.state.error?.message ?? "Unknown error"}
            </p>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.reload();
              }}
              style={{
                padding: "0.5rem 1.5rem",
                background: "transparent",
                border: "1px solid #333",
                color: "#ccc",
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: "0.75rem",
              }}
            >
              Reload
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
