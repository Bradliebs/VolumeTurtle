"use client";

import React from "react";

interface Props {
  children: React.ReactNode;
  name: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Lightweight error boundary for individual dashboard sections.
 * If one panel crashes, others continue rendering.
 */
export class SectionErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[SectionErrorBoundary:${this.props.name}]`, error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            padding: "1rem",
            border: "1px solid #333",
            borderRadius: "0.5rem",
            background: "#1a0a0a",
            color: "#888",
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "0.75rem",
          }}
        >
          <p style={{ color: "#e5534b", marginBottom: "0.5rem" }}>
            {this.props.name} failed to render
          </p>
          <p style={{ fontSize: "0.65rem", wordBreak: "break-word" }}>
            {this.state.error?.message ?? "Unknown error"}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              marginTop: "0.5rem",
              padding: "0.25rem 0.75rem",
              background: "transparent",
              border: "1px solid #333",
              color: "#ccc",
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: "0.65rem",
            }}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
