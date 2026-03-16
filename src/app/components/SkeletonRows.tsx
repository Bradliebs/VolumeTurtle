import React from "react";

export function SkeletonRows({ cols, rows = 3 }: { cols: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r}>
          {Array.from({ length: cols }).map((_, c) => (
            <td key={c} className="px-3 py-2">
              <div className="h-4 rounded bg-[#222] animate-skeleton" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
