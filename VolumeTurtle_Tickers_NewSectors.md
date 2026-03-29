# VolumeTurtle — Additional Tickers Across New Sectors
## Paste this into Vibecode in VSCode

---

## Instructions

In `/src/lib/universe/tickers.ts`, append these new sections
to the HIGH_RISK_UNIVERSE array.
Do not replace existing tickers — append only.

---

```typescript

  // ========== BIOTECH — CLINICAL CATALYSTS 2026 ==========
  // FDA calendar loaded with decisions — volume spikes on data readouts
  "MNMD",    // MindMed — psychedelic therapy, Phase 3 data H1 2026
  "OCGN",    // Ocugen — gene therapy Phase 3 data Q4 2026
  "KROS",    // Keros Therapeutics — musculoskeletal pipeline
  "KYTX",    // Kyverna Therapeutics — autoimmune
  "CELC",    // Celcuity — breast cancer targeted therapy
  "XENE",    // Xenon Pharmaceuticals — epilepsy Phase 3 readout 2026
  "TERN",    // Terns Pharmaceuticals — oncology/CML
  "DNLI",    // Denali Therapeutics — neurodegeneration
  "VNDA",    // Vanda Pharmaceuticals — multiple FDA decisions 2026
  "RCKT",    // Rocket Pharmaceuticals — gene therapy
  "LNTH",    // Lantheus Holdings — diagnostic imaging FDA decision Mar 2026
  "TNGX",    // Tango Therapeutics — oncology, 180% recent rally
  "STTK",    // Shattuck Labs — immuno-oncology
  "ALT",     // Altimmune — MASH/obesity pipeline
  "IBRX",    // ImmunityBio — bladder cancer approved therapy
  "MCRB",    // Seres Therapeutics — microbiome therapy
  "BIOHV",   // Biohaven — epilepsy/depression Kv7 activator
  "ADMA",    // ADMA Biologics — Asceniv growth, FDA yield approval
  "ANIP",    // ANI Pharmaceuticals — specialty pharma
  "LQDA",    // Liquidia Technologies — pulmonary hypertension
  "EVOM",    // Evommune — autoimmune EVO756 Phase 2b
  "KRYS",    // Krystal Biotech — gene therapy Vyjuvek
  "SPRY",    // ARS Pharmaceuticals — nasal allergy Neffy
  "CGON",    // CG Oncology — already may be in universe
  "DNTH",    // Dianthus Therapeutics — complement biology

  // ========== SEMIS — AI INFRASTRUCTURE PICKS 2026 ==========
  // BofA forecasts $1 trillion semiconductor sales in 2026
  "STX",     // Seagate Technology — #1 AI stock YTD, up 353%
  "LRCX",    // Lam Research — BofA top pick, etch equipment
  "KLAC",    // KLA Corporation — process control, BofA top pick
  "ENTG",    // Entegris — semiconductor materials
  "MKSI",    // MKS Instruments — process equipment
  "NVMI",    // Nova Measuring — metrology equipment
  "TER",     // Teradyne — semiconductor test equipment
  "TSEM",    // Tower Semiconductor — specialty foundry
  "MTSI",    // MACOM Technology — optical components AI
  "LITE",    // Lumentum — optical networking AI data centres
  "AKAM",    // Akamai Technologies — AI edge delivery
  "GFS",     // GlobalFoundries — specialty semis

  // ========== ROBOTICS & AUTONOMY ==========
  // Robotics identified as next major investment theme 2026
  "ISRG",    // Intuitive Surgical — surgical robots high beta
  "NNDM",    // Nano Dimension — additive manufacturing
  "IROQ",    // iRobot — consumer robotics
  "PATH",    // UiPath — enterprise automation
  "AIOT",    // Aiiot (if listed)
  "MBOT",    // Microbot Medical
  "SURGN",   // Surgen (surgical robotics)
  "SYM",     // Symbotic — AI warehouse automation
  "DXYZ",    // Destiny Tech100 — private tech exposure
  "JOBY",    // Joby Aviation — already in, air taxi
  "ACHR",    // Archer Aviation — already in, eVTOL

  // ========== DATA STORAGE & AI INFRASTRUCTURE ==========
  // AI training demands massive storage — underappreciated theme
  "PSTG",    // Pure Storage — flash storage AI
  "NTAP",    // NetApp — hybrid cloud storage
  "WDC",     // Western Digital — HDD/flash storage
  "MU",      // Micron Technology — HBM memory for AI
  "VRT",     // Vertiv Holdings — data centre cooling/power
  "DELL",    // Dell Technologies — AI server infrastructure
  "HPE",     // Hewlett Packard Enterprise — AI servers
  "SMCI",    // Super Micro Computer — AI server high beta

  // ========== OPTICAL NETWORKING (AI data centre buildout) ==========
  "CIEN",    // Ciena — optical networking
  "COHR",    // Coherent Corp — optical components
  "LITE",    // Lumentum — optical transceivers
  "IIVI",    // II-VI / Coherent merger entity
  "INFN",    // Infinera — optical transport

  // ========== GAMING & CONSUMER TECH HIGH BETA ==========
  "RBLX",    // Roblox — metaverse/gaming high beta
  "U",       // Unity Technologies — game engine
  "TTWO",    // Take-Two Interactive — gaming
  "EA",      // Electronic Arts — gaming catalyst plays
  "DKNG",    // DraftKings — sports betting high beta
  "PENN",    // Penn Entertainment — sports betting
  "RSI",     // Rush Street Interactive — online gaming
  "GENI",    // Genius Sports — sports data
  "EVERI",   // Everi Holdings — gaming tech
  "AGS",     // PlayAGS — gaming equipment

  // ========== CYBERSECURITY HIGH BETA ==========
  // Geopolitical tensions driving security spending
  "CRWD",    // CrowdStrike — endpoint security
  "S",       // SentinelOne — AI security
  "CYBR",    // CyberArk — identity security
  "TENB",    // Tenable Holdings — vulnerability management
  "QLYS",    // Qualys — cloud security
  "RPD",     // Rapid7 — security analytics
  "VRNS",    // Varonis Systems — data security
  "ZSCALER", // Zscaler — already ZS in universe check
  "FTNT",    // Fortinet — network security
  "CERT",    // Certara — biosimulation

  // ========== FINTECH & PAYMENTS HIGH BETA ==========
  "AFRM",    // Affirm Holdings — BNPL
  "SOFI",    // SoFi Technologies — digital bank
  "UPST",    // Upstart — AI lending
  "DAVE",    // Dave Inc — neobank
  "MQ",      // Marqeta — card issuing
  "RELY",    // Remitly — international payments
  "FLYW",    // Flywire — global payments
  "PAYO",    // Payoneer — SMB payments
  "GTPAY",   // (check availability)
  "STEP",    // StepStone Group — alternative investments
  "LPLA",    // LPL Financial — wealth management high beta
  "HOOD",    // Robinhood — retail investing platform

  // ========== CONSUMER DISCRETIONARY HIGH BETA ==========
  // Tariff-driven rotation — domestic US consumer plays
  "CVNA",    // Carvana — used cars high beta
  "DRVN",    // Driven Brands — auto services
  "ORLY",    // O'Reilly Auto — defensive but high beta
  "AZO",     // AutoZone — auto parts
  "TSLA",    // Tesla — autonomy/robotics thesis
  "RIVN",    // Rivian — EV high beta
  "LCID",    // Lucid Motors — EV speculative
  "NIO",     // NIO — Chinese EV, high beta
  "LI",      // Li Auto — Chinese EV
  "XPEV",    // XPeng — Chinese EV autonomy
  "GOEV",    // Canoo — EV speculative
  "WKHS",    // Workhorse Group — EV delivery

  // ========== UK SMALL/MID CAP HIGH BETA (LSE) ==========
  // Sectors under-represented in existing UK universe
  "AIM.L",   // AIM market ETF proxy if available
  "GAW.L",   // Games Workshop — tabletop gaming, high retail interest
  "FDEV.L",  // Frontier Developments — video games
  "TEAM.L",  // Team17 — indie games publisher
  "BOO.L",   // Boohoo — fast fashion high beta
  "ASOS.L",  // ASOS — online fashion
  "THG.L",   // THG Holdings — beauty/nutrition high beta
  "OCDO.L",  // Ocado — grocery tech high beta
  "AUTO.L",  // Auto Trader — online automotive
  "WISE.L",  // Wise — fintech payments
  "MONC.L",  // Monzo (if listed by 2026)
  "ANIC.L",  // Agronomics — alternative protein
  "CERES.L", // Ceres Power — fuel cell technology
  "ITM.L",   // ITM Power — hydrogen electrolyser
  "AFC.L",   // AFC Energy — hydrogen fuel cells
  "LOOP.L",  // Loops EV — electric vehicle
  "TRN.L",   // Trainline — digital rail ticketing
  "VTY.L",   // Vistry Group — housebuilder high beta
  "MNG.L",   // M&G — asset management
  "SDR.L",   // Schroders — asset management
  "JDW.L",   // JD Wetherspoon — pub chain narrative beta

  // ========== EUROPEAN HIGH BETA (available on T212) ==========
  "ASML",    // ASML — semis equipment, already in check
  "BESI.AS", // BE Semiconductor — packaging high beta
  "IMCD.AS", // IMCD — specialty chemicals distribution
  "ALFEN.AS",// Alfen — EV charging/energy storage Netherlands
  "NESTE.HE",// Neste — renewable fuels Finland
  "EVO.ST",  // Evolution Gaming — live casino Sweden
  "SINCH.ST",// Sinch — communications platform Sweden
  "VOLCAR-B.ST", // Volvo Cars — Swedish EV
  "IFX",     // Infineon — German semis
  "STM",     // STMicroelectronics — EU semis
  "SAP",     // SAP — enterprise software Germany
  "SIE",     // Siemens — industrial/automation Germany
  "DSFIR.AS",// Dufry / Avolta — travel retail
  "TKWY.AS", // Takeaway.com — food delivery Netherlands

  // ========== COMMODITIES & AGRICULTURE ETFs ==========
  // Broader commodity exposure via ETFs — clean signals
  "DBA",     // Invesco DB Agriculture ETF
  "WEAT",    // Teucrium Wheat Fund
  "CORN",    // Teucrium Corn Fund
  "SOYB",    // Teucrium Soybean Fund
  "JJC",     // iPath Bloomberg Copper ETN
  "PALL",    // Aberdeen Palladium ETF
  "PPLT",    // Aberdeen Platinum ETF
  "DBB",     // Invesco DB Base Metals ETF
  "PDBC",    // Invesco Optimum Yield Diversified Commodity

  // ========== LEVERAGED ETFs (high volume spike potential) ==========
  // These structurally generate large volume spikes — treat with care
  "SOXL",    // Direxion Daily Semiconductors 3x Bull
  "LABU",    // Direxion Daily S&P Biotech 3x Bull
  "NUGT",    // Direxion Daily Gold Miners 3x Bull
  "JNUG",    // Direxion Daily Junior Gold Miners 3x Bull
  "BOIL",    // ProShares Ultra Bloomberg Natural Gas 2x
  "UCO",     // ProShares Ultra Bloomberg Crude Oil 2x
  "GUSH",    // Direxion Daily S&P Oil & Gas E&P 2x Bull
  "ERX",     // Direxion Daily Energy 2x Bull
  "TNA",     // Direxion Daily Small Cap 3x Bull
  "TECL",    // Direxion Daily Technology 3x Bull

```

---

## Important notes on leveraged ETFs

Leveraged ETFs (SOXL, LABU, NUGT etc.) will generate frequent
volume spikes due to daily rebalancing and retail activity.
The system will catch these signals correctly.

However be aware:
- These decay over time due to daily rebalancing — not suitable for
  long holds. The trailing stop will naturally limit hold time.
- Volume spikes on leveraged ETFs can be mechanical not informational.
- Grade them with extra scrutiny — regime score matters more here.
- Consider smaller position sizes despite what the sizer suggests.

---

## After adding, run validation:

```
npm run validate
```

Some tickers to expect validation failures on:
- BIOHV, AIOT, MBOT, SURGN, GTPAY — may not be listed/available
- Some European suffixes (.AS, .ST, .HE) — Yahoo Finance coverage varies
- AIM.L — likely not a valid ticker, remove if fails
- MONC.L — Monzo not yet listed, remove if fails

Then run:
```
npm run scan:dry
```

With the biotech FDA calendar, semis infrastructure, and
leveraged ETF additions you should see a more diverse
range of signals firing across different market conditions.
