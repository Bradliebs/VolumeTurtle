# VolumeTurtle — New Tickers March 2026
## Paste this into Vibecode in VSCode

---

## Instructions

In `/src/lib/universe/tickers.ts`, append these new sections
to the HIGH_RISK_UNIVERSE array.
Do not replace existing tickers — append only.

---

```typescript

  // ========== ENERGY — OIL & GAS HIGH BETA (Hormuz shock March 2026) ==========
  // Oil above $100, XLE up 25% YTD — this is the active sector right now
  "XOM",     // ExxonMobil — Permian titan, $20B buyback
  "CVX",     // Chevron — 1M bpd Permian milestone
  "COP",     // ConocoPhillips — pure upstream high beta
  "OXY",     // Occidental Petroleum — Buffett holding, high beta
  "DVN",     // Devon Energy — US shale high beta
  "FANG",    // Diamondback Energy — Permian pure play
  "MRO",     // Marathon Oil
  "APA",     // APA Corporation — international exposure
  "PR",      // Permian Resources
  "CTRA",    // Coterra Energy
  "SM",      // SM Energy — small cap high beta
  "MTDR",    // Matador Resources
  "CHRD",    // Chord Energy
  "VTLE",    // Vital Energy
  "NOG",     // Northern Oil and Gas

  // ========== ENERGY SERVICES (leverage to oil price) ==========
  "SLB",     // Schlumberger — services giant
  "HAL",     // Halliburton
  "BKR",     // Baker Hughes
  "WHD",     // Cactus Inc
  "NR",      // Newpark Resources
  "PTEN",    // Patterson-UTI Energy
  "RIG",     // Transocean — offshore drilling high beta
  "VAL",     // Valaris — offshore drilling
  "DO",      // Diamond Offshore

  // ========== LNG & MIDSTREAM (supply shock plays) ==========
  "LNG",     // Cheniere Energy — LNG exports
  "TELL",    // Tellurian — LNG speculative
  "NFE",     // New Fortress Energy — LNG high beta
  "NEXT",    // NextDecade — LNG development
  "TRGP",    // Targa Resources
  "WMB",     // Williams Companies

  // ========== MATERIALS & MINING (17.8% YTD, active sector) ==========
  "FCX",     // Freeport-McMoRan — copper at multi-year highs
  "SCCO",    // Southern Copper
  "TECK",    // Teck Resources — diversified miner
  "CLF",     // Cleveland-Cliffs — steel
  "NUE",     // Nucor — steel high beta
  "STLD",    // Steel Dynamics
  "CMC",     // Commercial Metals
  "MP",      // MP Materials — rare earth critical minerals
  "UAMY",    // US Antimony — critical minerals
  "NioCorp",  // NioCorp Developments
  "NOVN",    // Novan

  // ========== URANIUM (nuclear renaissance active) ==========
  "CCJ",     // Cameco — uranium major
  "NXE",     // NexGen Energy
  "DNN",     // Denison Mines
  "UUUU",    // Energy Fuels
  "UEC",     // Uranium Energy
  "URG",     // Ur-Energy
  "EU",      // enCore Energy
  "UROY",    // Uranium Royalty
  "LEU",     // Centrus Energy
  "BWXT",    // BWX Technologies

  // ========== PRECIOUS METALS — SILVER & GOLD HIGH BETA ==========
  // Silver classified as critical mineral, industrial + safe haven demand
  "SLV",     // iShares Silver Trust ETF
  "SILJ",    // ETFMG Prime Junior Silver ETF
  "AG",      // First Majestic Silver
  "PAAS",    // Pan American Silver
  "HL",      // Hecla Mining
  "EXK",     // Endeavour Silver
  "MAG",     // MAG Silver
  "CDE",     // Coeur Mining
  "GATO",    // Gatos Silver
  "SILV",    // SilverCrest Metals
  "AEM",     // Agnico Eagle
  "KGC",     // Kinross Gold
  "AU",      // AngloGold Ashanti
  "NGD",     // New Gold
  "BTG",     // B2Gold
  "IAG",     // IAMGOLD
  "OR",      // Osisko Gold Royalties
  "SAND",    // Sandstorm Gold

  // ========== COPPER PLAYS (AI infrastructure + energy transition) ==========
  "COPX",    // Global X Copper Miners ETF
  "WIRE",    // Encore Wire — domestic copper
  "CPER",    // US Copper Index ETF
  "ARIS",    // Aris Mining

  // ========== DEFENCE (geopolitical spending surge) ==========
  "HII",     // Huntington Ingalls — shipbuilding
  "GD",      // General Dynamics
  "LMT",     // Lockheed Martin
  "RTX",     // RTX Corporation
  "NOC",     // Northrop Grumman
  "KTOS",    // Kratos Defense — high beta defence
  "RCAT",    // Red Cat Holdings — drone systems
  "AVAV",    // AeroVironment
  "PLTR",    // Palantir — AI defence
  "CACI",    // CACI International
  "LDOS",    // Leidos
  "SAIC",    // Science Applications
  "DRS",     // Leonardo DRS

  // ========== UK DEFENCE & ENERGY (LSE active) ==========
  "BAE.L",   // BAE Systems
  "QQ.L",    // QinetiQ
  "RR.L",    // Rolls-Royce
  "BP.L",    // BP — oil price beneficiary
  "SHEL.L",  // Shell
  "HBR.L",   // Harbour Energy — already in, confirm
  "TLW.L",   // Tullow Oil — high beta oil
  "ENQ.L",   // EnQuest — high beta oil
  "CHAR.L",  // Chariot — energy speculative
  "AMER.L",  // Amryt Pharma / check current status

  // ========== AI PHYSICAL INFRASTRUCTURE (power demand theme) ==========
  // AI driving massive power and cooling demand — physical assets
  "VST",     // Vistra Energy — power generation
  "CEG",     // Constellation Energy — nuclear power
  "NRG",     // NRG Energy
  "GEV",     // GE Vernova — grid equipment
  "PWR",     // Quanta Services — grid buildout
  "POWL",    // Powell Industries — electrical infrastructure
  "FCEL",    // FuelCell Energy
  "BE",      // Bloom Energy
  "GTLS",    // Chart Industries — industrial gas/LNG equipment
  "ARIS",    // Aris Mining

  // ========== SHIPPING (commodity transport bottleneck) ==========
  "ZIM",     // ZIM Integrated Shipping — high beta
  "SBLK",    // Star Bulk Carriers
  "GOGL",    // Golden Ocean Group
  "EGLE",    // Eagle Bulk Shipping
  "NMM",     // Navios Maritime Partners
  "CTRM",    // Castor Maritime — speculative
  "TOPS",    // TOP Ships — speculative
  "IMPP",    // Imperial Petroleum

  // ========== FERTILISERS & AGRICULTURE (food security theme) ==========
  "MOS",     // Mosaic Company — potash/phosphate
  "NTR",     // Nutrien — fertiliser major
  "CF",      // CF Industries — nitrogen
  "CTVA",    // Corteva — agri science
  "ANDE",    // Andersons

  // ========== INDUSTRIAL METALS ETFs (easy broad exposure) ==========
  "PICK",    // iShares MSCI Global Metals & Mining ETF
  "REMX",    // VanEck Rare Earth/Strategic Metals ETF
  "COPX",    // Global X Copper Miners ETF
  "SIL",     // Global X Silver Miners ETF
  "GDX",     // VanEck Gold Miners ETF
  "GDXJ",    // VanEck Junior Gold Miners ETF — high beta

```

---

## Context for these additions

The March 2026 market is experiencing a major sector rotation:

- Energy (XLE) up 25% YTD — oil above $100 on Hormuz supply shock
- Materials up 17.8% YTD — copper at multi-year highs
- Silver reclassified as critical mineral — industrial + defence demand
- Uranium bull market continuing — nuclear renaissance
- Defence spending surging globally — geopolitical premium
- AI physical infrastructure — power, cooling, grid buildout

Tech and AI software are under pressure from tariffs and AI fatigue.
The rotation is toward real, physical, tangible assets.

These additions directly target the sectors with the most
volume spike potential in the current environment.

---

## After adding, run validation:

```
npm run validate
```

Remove any tickers that fail Yahoo Finance fetch.
Some smaller shipping and mining names may not be available.

Then run:
```
npm run scan:dry
```

You should see significantly more signals firing given the
active commodity/energy environment.
```
