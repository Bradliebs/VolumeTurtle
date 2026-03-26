# VolumeTurtle — T212 Position Import & Reconciliation Prompt
## Paste this into Vibecode in VSCode

---

## Overview

Users may place trades directly on Trading 212 without going through
the VolumeTurtle dashboard. These positions show as UNTRACKED in the
T212 portfolio view.

Add a reconciliation workflow that:
1. Detects untracked T212 positions
2. Allows the user to import them into VolumeTurtle with one click
3. Calculates correct stops and risk based on actual entry price
4. Marks them as TRACKED once imported

---

## Current State

The T212 portfolio panel shows 7 positions all marked UNTRACKED:
CVV, SRPT, CVX, SATL, FOLD, XOM, OXY

These exist in Trading 212 but have no corresponding Trade record
in the VolumeTurtle database.

---

## Change 1 — Import Single Position API Route

Create `/src/app/api/t212/import/route.ts`

```typescript
// POST /api/t212/import
// Body: T212Position object
// Creates a Trade record from a T212 position
// Calculates ATR-based stops from historical data

import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { ticker, quantity, avgPrice, currentPrice } = body

  // 1. Fetch historical quotes for this ticker
  // Need 120 days for ATR20 and 50-day MA calculations
  const quotes = await fetchEODQuotes([ticker])
  const tickerQuotes = quotes[ticker]

  if (!tickerQuotes || tickerQuotes.length < 20) {
    return NextResponse.json(
      { error: `Insufficient data for ${ticker}` },
      { status: 400 }
    )
  }

  // 2. Calculate ATR20
  const atr20 = calculateATR20(tickerQuotes)

  // 3. Calculate stops based on actual entry price
  const hardStop = avgPrice - (2 * atr20)
  const trailingStop = calculate10DayLow(tickerQuotes)
  const currentStop = Math.max(hardStop, trailingStop)

  // 4. Calculate risk
  const riskPerShare = avgPrice - hardStop
  const dollarRisk = riskPerShare * quantity

  // 5. Create Trade record
  const trade = await prisma.trade.create({
    data: {
      ticker,
      entryDate: new Date(),      // use today as import date
      entryPrice: avgPrice,
      shares: quantity,
      hardStop,
      trailingStop: currentStop,
      currentStop,
      status: 'OPEN',
      // Signal fields — estimated from position data
      volumeRatio: null,          // unknown — placed outside system
      rangePosition: null,        // unknown
      atr20,
      importedFromT212: true,     // flag as manually imported
      importedAt: new Date(),
    }
  })

  // 6. Write initial stop history record
  await prisma.stopHistory.create({
    data: {
      tradeId: trade.id,
      date: new Date(),
      stopLevel: currentStop,
      stopType: hardStop > trailingStop ? 'HARD' : 'TRAILING',
      changed: false,
      changeAmount: null,
      note: 'Imported from T212 — initial stop calculated on import',
    }
  })

  return NextResponse.json({
    success: true,
    trade,
    calculatedStops: {
      hardStop,
      trailingStop,
      currentStop,
      atr20,
      riskPerShare,
      dollarRisk,
    }
  })
}
```

---

## Change 2 — Import All Untracked Positions

Create `/src/app/api/t212/import-all/route.ts`

```typescript
// POST /api/t212/import-all
// Imports all untracked T212 positions at once
// Returns summary of what was imported

export async function POST(req: NextRequest) {
  // 1. Fetch all T212 positions
  const t212Positions = await getOpenPositions(t212Settings)

  // 2. Fetch all open VolumeTurtle trades
  const vtTrades = await prisma.trade.findMany({
    where: { status: 'OPEN' }
  })

  // 3. Find untracked positions
  // Match by ticker symbol (after T212 → Yahoo mapping)
  const trackedTickers = new Set(vtTrades.map(t => t.ticker))
  const untracked = t212Positions.filter(
    p => !trackedTickers.has(mapT212ToYahoo(p.ticker))
  )

  // 4. Import each untracked position
  const imported = []
  const failed = []

  for (const position of untracked) {
    try {
      const result = await importPosition(position)
      imported.push(result)
    } catch (err) {
      failed.push({ ticker: position.ticker, error: err.message })
    }
  }

  return NextResponse.json({
    success: true,
    imported: imported.length,
    failed: failed.length,
    details: { imported, failed }
  })
}
```

---

## Change 3 — Update Prisma Schema

Add fields to Trade model in `/prisma/schema.prisma`:

```prisma
model Trade {
  // ... existing fields ...

  importedFromT212  Boolean   @default(false)
  importedAt        DateTime?
  manualEntry       Boolean   @default(false)

  // Add note field to StopHistory
}

model StopHistory {
  // ... existing fields ...
  note  String?   // optional note explaining stop change
}
```

Run `npx prisma db push` after this change.

---

## Change 4 — T212 Portfolio Panel UI

Update the T212 portfolio panel to handle untracked positions.

**Current state — UNTRACKED badge:**
```
CVV    20    $5.18    $6.11    +$14.22    UNTRACKED
```

**New state — Import button:**
```
CVV    20    $5.18    $6.11    +$14.22    [ IMPORT → VT ]
```

When user clicks IMPORT → VT on a single position:
1. Show a preview panel:

```
IMPORT CVV INTO VOLUMETURTLE

Position from Trading 212:
  Ticker:        CVV
  Quantity:      20 shares
  Avg entry:     $5.18
  Current price: $6.11
  Current P&L:   +$14.22

Calculated by VolumeTurtle:
  ATR20:         $0.22
  Hard stop:     $4.74  (2x ATR below entry)
  10-day low:    $5.01
  Active stop:   $5.01  (higher of hard/trailing)
  Risk/share:    $0.44
  Total risk:    $8.80

  ⚠ This position was entered outside the signal system
    Volume ratio and range position are unknown
    Stop levels are calculated from current data

[ CANCEL ]    [ CONFIRM IMPORT ]
```

2. On confirm: calls POST /api/t212/import
3. Position moves from UNTRACKED to TRACKED
4. Appears in Open Positions table with all stop management

**Add "IMPORT ALL UNTRACKED" button at top of T212 panel:**
```
TRADING 212 PORTFOLIO — 7 positions    [ IMPORT ALL UNTRACKED ]
```

Clicking it:
1. Shows confirmation modal:
   ```
   Import 7 untracked positions into VolumeTurtle?
   
   Stops will be calculated from current ATR data.
   Entry dates will be set to today (import date).
   Signal data (volume ratio, grade) will be unknown.
   
   [ CANCEL ]    [ IMPORT ALL 7 POSITIONS ]
   ```
2. Calls POST /api/t212/import-all
3. Shows progress: "Importing 1/7... 2/7... done"
4. All positions become TRACKED

---

## Change 5 — Imported Position Display

In the Open Positions table, imported positions display
slightly differently to signal-generated positions:

```
TICKER   ENTRY DATE   ENTRY    SHARES   HARD STOP  ...  SOURCE
CVV      26 Mar 26    $5.18    20       $4.74      ...  📥 T212 Import
SRPT     26 Mar 26    $22.40   6.07     $20.56     ...  📥 T212 Import
HBR.L    12 Mar 26    £2.81    44.17    £2.54      ...  📊 Signal
```

SOURCE column:
- 📥 T212 Import — manually placed on T212, imported after
- 📊 Signal — generated by VolumeTurtle scan
- ✏ Manual — entered manually via dashboard

This gives you a clear audit trail of how each position originated.

---

## Change 6 — DAILY INSTRUCTIONS for Imported Positions

Imported positions should appear in DAILY INSTRUCTIONS
exactly like signal-generated positions:

```
DAILY INSTRUCTIONS — 26 Mar 2026

─── CVV (📥 T212 Import) ──────────────────────────

  Status      HOLD — no action needed today
  Your stop   $5.01
  Set on      26 Mar 2026 (imported)
  Note        Position imported from T212 — stop calculated on import

─── SRPT (📥 T212 Import) ─────────────────────────

  ⚠ UPDATE YOUR STOP ON TRADING 212
  Move stop from  $20.56
  Move stop to    $21.80
  Change          +$1.24 (trailing stop ratcheted up)
```

Once imported, these positions are managed identically
to signal-generated positions. The import source is noted
but doesn't affect stop management or exit logic.

---

## Change 7 — Retroactive Signal Matching

When importing a position, attempt to find a matching
signal that may have fired recently:

```typescript
// Look for a ScanResult for this ticker in the last 5 trading days
const recentSignal = await prisma.scanResult.findFirst({
  where: {
    ticker: yahooTicker,
    signalFired: true,
    scanDate: {
      gte: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
    }
  },
  orderBy: { scanDate: 'desc' }
})

if (recentSignal) {
  // Populate signal fields from the scan result
  trade.volumeRatio = recentSignal.volumeRatio
  trade.rangePosition = recentSignal.rangePosition
  trade.compositeScore = recentSignal.compositeScore
  trade.compositeGrade = recentSignal.compositeGrade

  // Note on the import
  importNote = `Matched to signal from ${recentSignal.scanDate} — 
    volume ${recentSignal.volumeRatio}x, grade ${recentSignal.compositeGrade}`
}
```

This means if CVV fired a signal on March 24th and you bought it
that evening, the import will automatically connect the trade
to that signal record. Grade, volume ratio, and composite score
all get populated correctly.

---

## Summary

After this prompt:

✓ Single position import with stop preview
✓ Import all untracked positions at once  
✓ Stops calculated automatically from ATR data
✓ Retroactive signal matching where possible
✓ Imported positions appear in DAILY INSTRUCTIONS
✓ SOURCE column shows trade origin
✓ Full stop history tracking from import date forward
✓ All 7 current T212 positions can be imported immediately
