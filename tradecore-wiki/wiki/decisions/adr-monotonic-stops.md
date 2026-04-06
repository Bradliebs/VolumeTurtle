---
title: "ADR: Monotonic Stops Only"
category: decision
tags: [adr, stops, monotonic, risk]
updated: 2026-04-06
sources: []
confidence: high
---

Trailing stops may only rise or stay flat — never fall.

## Decision

**Date:** Pre-2026 (foundational)
**Status:** accepted

## Context

Trailing stop systems can either recalculate freely (allowing stops to fall during pullbacks) or enforce a one-way ratchet. The choice affects whipsaw frequency, realised gain protection, and psychological discipline.

## Decision

All stop levels are monotonic. Once a stop is ratcheted up, it can never be lowered — not by the nightly ratchet, not by Cruise Control, and not by T212 sync.

## Rationale

- Protects realised gains during normal pullbacks
- Prevents emotional override (no "just this once" lowering)
- T212 stop orders become immutable floors — the system can only tighten, never loosen
- Simpler code: `newStop = max(currentStop, calculatedStop)`

## Consequences

- Some trades will be stopped out during healthy pullbacks that would have recovered
- This is accepted as the cost of mechanical discipline
- The 10-day low trailing window provides enough slack for normal volatility

## See also

- [[trailing-stops]]
- [[sacred-files]]
