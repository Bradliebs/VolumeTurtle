import React from "react";
import { mono } from "./helpers";

export function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="inline-block px-2 py-0.5 text-xs font-medium rounded border"
      style={{ color, borderColor: color, ...mono }}
    >
      {label}
    </span>
  );
}
