/** Minimal quote shape needed for liquidity checks */
interface QuoteLike {
  close: number;
  volume: number;
}

export const HIGH_RISK_UNIVERSE: string[] = [

  // ========== AI / HIGH BETA TECH ==========
  "SOUN",    // SoundHound AI
  "BBAI",    // BigBear.ai
  "RZLV",    // Rezolve AI
  "APLD",    // Applied Digital
  "CRWV",    // CoreWeave
  "ALAB",    // Astera Labs
  "AI",      // C3.ai
  "NBIS",    // Nebius Group
  "SMTC",    // Semtech
  "BTBT",    // Bit Brother
  "IREN",    // Iris Energy
  "ARQQ",    // Arqit Quantum
  "GFAI",    // Guardforce AI
  "AIXI",    // Xiao-I Corporation
  "AITX",    // Artificial Intelligence Tech
  "MGNI",    // Magnite
  "TTD",     // The Trade Desk (high beta ad tech)
  "HIMS",    // Hims & Hers Health
  "DOCS",    // Doximity
  "CERT",    // Certara

  // ========== QUANTUM COMPUTING ==========
  "QBTS",    // D-Wave Quantum
  "IONQ",    // IonQ
  "RGTI",    // Rigetti Computing
  "QUBT",    // Quantum Computing Inc
  "QTUM",    // Defiance Quantum ETF (liquid proxy)

  // ========== SPACE / DEEP TECH ==========
  "RKLB",    // Rocket Lab
  "ASTS",    // AST SpaceMobile
  "LUNR",    // Intuitive Machines
  "RDW",     // Redwire
  "MNTS",    // Momentus
  "SPCE",    // Virgin Galactic
  "PL",      // Planet Labs
  "BKSY",    // BlackSky Technology
  "SATL",    // Satellogic

  // ========== ROBOTICS / AUTONOMY ==========
  "JOBY",    // Joby Aviation
  "ACHR",    // Archer Aviation
  "EVTL",    // Vertical Aerospace
  "RBOT",    // Vicarious Surgical
  "GPRO",    // GoPro (high narrative beta)
  "BLBD",    // Blue Bird (EV bus)

  // ========== CRYPTO-ADJACENT & BITCOIN PROXIES ==========
  "MSTR",    // MicroStrategy
  "RIOT",    // Riot Platforms
  "CLSK",    // CleanSpark
  "WULF",    // TeraWulf
  "MARA",    // Marathon Digital
  "HUT",     // Hut 8
  "CIFR",    // Cipher Mining
  "BITF",    // Bitfarms
  "HIVE",    // HIVE Digital
  "COIN",    // Coinbase
  "HOOD",    // Robinhood (crypto proxy)
  "GLXY",    // Galaxy Digital (if available)
  "MTPLF",   // Metaplanet (if available)

  // ========== NUCLEAR / ENERGY TRANSITION ==========
  "OKLO",    // Oklo
  "NNE",     // Nano Nuclear Energy
  "SMR",     // NuScale Power
  "UUUU",    // Energy Fuels
  "UEC",     // Uranium Energy
  "DNN",     // Denison Mines
  "URG",     // Ur-Energy
  "CCJ",     // Cameco (uranium major, high beta)
  "BWXT",    // BWX Technologies
  "LEU",     // Centrus Energy
  "LTBR",    // Lightbridge

  // ========== CLEAN ENERGY / SOLAR / EV ==========
  "RUN",     // Sunrun
  "PLUG",    // Plug Power
  "CHPT",    // ChargePoint
  "BLNK",    // Blink Charging
  "FSLR",    // First Solar (high beta)
  "ARRY",    // Array Technologies
  "STEM",    // Stem Inc
  "SHLS",    // Shoals Technologies
  "EVGO",    // EVgo
  "LCID",    // Lucid Motors
  "RIVN",    // Rivian
  "GOEV",    // Canoo
  "WKHS",    // Workhorse Group

  // ========== BIOTECH / CLINICAL STAGE ==========
  "RXRX",    // Recursion Pharma
  "CRSP",    // CRISPR Therapeutics
  "BEAM",    // Beam Therapeutics
  "EDIT",    // Editas Medicine
  "NTLA",    // Intellia Therapeutics
  "ARWR",    // Arrowhead Pharma
  "IONS",    // Ionis Pharma
  "SRPT",    // Sarepta Therapeutics
  "NVAX",    // Novavax
  "MRNA",    // Moderna (high beta)
  "BNTX",    // BioNTech
  "ACAD",    // Acadia Pharma
  "PRGO",    // Perrigo
  "FOLD",    // Amicus Therapeutics
  "IMVT",    // Immunovant
  "LEGN",    // Legend Biotech
  "ARQT",    // Arcutis Biotherapeutics
  "TMDX",    // TransMedics Group
  "AXSM",    // Axsome Therapeutics
  "NUVL",    // Nuvalent
  "KYMR",    // Kymera Therapeutics
  "RVMD",    // Revolution Medicines
  "VKTX",    // Viking Therapeutics
  "GILD",    // Gilead (catalyst-driven)
  "INCY",    // Incyte
  "EXEL",    // Exelixis

  // ========== COMMODITY / RESOURCE PLAYS ==========
  "AG",      // First Majestic Silver
  "PAAS",    // Pan American Silver
  "HL",      // Hecla Mining
  "EXK",     // Endeavour Silver
  "CDE",     // Coeur Mining
  "WPM",     // Wheaton Precious Metals
  "AEM",     // Agnico Eagle
  "GOLD",    // Barrick Gold
  "NEM",     // Newmont
  "MP",      // MP Materials (rare earth)
  "UAMY",    // United States Antimony
  "CLF",     // Cleveland-Cliffs
  "AA",      // Alcoa
  "CENX",    // Century Aluminum
  "HYMC",    // Hycroft Mining
  "USAS",    // Americas Gold and Silver
  "FCX",     // Freeport-McMoRan (high beta copper)
  "TECK",    // Teck Resources
  "VALE",    // Vale (iron ore/nickel)
  "RIO",     // Rio Tinto ADR

  // ========== HIGH BETA FINTECH / RETAIL NARRATIVE ==========
  "SOFI",    // SoFi Technologies
  "UPST",    // Upstart Holdings
  "OPEN",    // Opendoor Technologies
  "CVNA",    // Carvana
  "AFRM",    // Affirm Holdings
  "PSFE",    // Paysafe
  "RELY",    // Remitly
  "DAVE",    // Dave Inc
  "MQ",      // Marqeta
  "PAYO",    // Payoneer
  "INDI",    // indie Semiconductor
  "STEP",    // StepStone Group
  "DKNG",    // DraftKings
  "PENN",    // Penn Entertainment
  "FUBO",    // FuboTV
  "ROKU",    // Roku

  // ========== UK HIGH BETA (LSE) ==========
  "ANTO.L",  // Antofagasta (copper, high beta)
  "FRES.L",  // Fresnillo (silver/gold)
  "AAL.L",   // Anglo American
  "RIO.L",   // Rio Tinto
  "GLEN.L",  // Glencore
  "BHP.L",   // BHP Group
  "SOLG.L",  // SolGold (speculative copper)
  "OXB.L",   // Oxford Biomedica
  "HBR.L",   // Harbor Energy
  "CHAR.L",  // Chariot (energy)
  "ITM.L",   // ITM Power (hydrogen)
  "AFC.L",   // AFC Energy
  "WISE.L",  // Wise (high beta fintech)
  "THG.L",   // THG (high volatility)
  "OCDO.L",  // Ocado (high beta tech/retail)

  // ========== EUROPEAN HIGH BETA ==========
  "ASML",    // ASML (high beta semis, US listed)
  "ALFEN.AS",// Alfen (Dutch EV/energy)
  "BESI.AS", // BE Semiconductor
  "IMCD.AS", // IMCD Group
  "NESTE.HE",// Neste (Finnish clean energy)
  "SINCH.ST",// Sinch (Swedish comms tech)
  "EVO.ST",  // Evolution Gaming
  "VOLCAR-B.ST", // Volvo Cars
  "STM",     // STMicroelectronics

  // ========== TURNAROUND / DISTRESSED HIGH BETA ==========
  "PTON",    // Peloton
  "BYND",    // Beyond Meat
  "WRBY",    // Warby Parker
  "BIRD",    // Allbirds
  "FIGS",    // FIGS
  "MAPS",    // WM Technology
  "GETY",    // Getty Images
  "NRDS",    // NerdWallet
  "LMND",    // Lemonade
  "ROOT",    // Root Insurance
  "METC",    // Ramaco Resources
  "WOLF",    // Wolfspeed (watch only — Chapter 11)

  // ========== DEFENCE & GEOPOLITICAL (March 2026 active) ==========
  "KTOS",    // Kratos Defense & Security
  "PLTR",    // Palantir (AI/defence high beta)
  "DRS",     // Leonardo DRS
  "CACI",    // CACI International
  "VVX",     // V2X Inc
  "LDOS",    // Leidos Holdings
  "RCAT",    // Red Cat Holdings (drone defence)
  "AVAV",    // AeroVironment (drone systems)
  "OSIS",    // OSI Systems

  // ========== HEALTHCARE HIGH BETA (sector rotating in March 2026) ==========
  "CGON",    // CG Oncology
  "DNTH",    // Dianthus Therapeutics
  "AMPX",    // Amprius Technologies
  "ALNY",    // Alnylam Pharmaceuticals
  "PCVX",    // Vaxcyte
  "RCUS",    // Arcus Biosciences
  "TGTX",    // TG Therapeutics
  "PRCT",    // Procept BioRobotics
  "INVA",    // Innoviva
  "ESTA",    // Establishment Labs
  "HALO",    // Halozyme Therapeutics
  "INSM",    // Insmed
  "PTGX",    // Protagonist Therapeutics

  // ========== NUCLEAR & ENERGY COMMODITIES (geopolitical premium) ==========
  "UROY",    // Uranium Royalty Corp
  "EU",      // enCore Energy
  "CVV",     // CVD Equipment
  "GEV",     // GE Vernova (grid/energy)
  "VST",     // Vistra Energy (high beta power)
  "CEG",     // Constellation Energy

  // ========== UK LSE HIGH BETA (active this week) ==========
  "QQ.L",    // QinetiQ Group
  "RR.L",    // Rolls-Royce Holdings
  "IMI.L",   // IMI plc
  "TRN.L",   // Trainline
  "VTY.L",   // Vistry Group (housebuilder)
  "MNG.L",   // M&G plc
  "MGNS.L",  // Morgan Sindall
  "SPX.L",   // SPX Technologies
  "ECOR.L",  // e-Therapeutics
  "RWS.L",   // RWS Holdings
  "JDW.L",   // JD Wetherspoon (narrative beta)
  "FOUR.L",  // 4imprint Group
  "GAW.L",   // Games Workshop (high retail interest)
  "FDEV.L",  // Frontier Developments

  // ========== CRYPTO ETFs & PROXIES (liquid on T212) ==========
  "BITO",    // ProShares Bitcoin Strategy ETF
  "IBIT",    // iShares Bitcoin Trust ETF
  "GBTC",    // Grayscale Bitcoin Trust
  "MSTU",    // MicroStrategy leveraged ETF (2x)
  "CONL",    // GraniteShares 2x Long COIN
  "SATO",    // Invesco Alerian Galaxy Crypto Economy ETF

  // ========== AI INFRASTRUCTURE & SEMIS (still active) ==========
  "CIEN",    // Ciena Corporation (optical networking)
  "COHR",    // Coherent Corp (AI data centre)
  "ACLS",    // Axcelis Technologies
  "ONTO",    // Onto Innovation
  "FORM",    // FormFactor
  "PLAB",    // Photronics
  "AEIS",    // Advanced Energy Industries
  "MKSI",    // MKS Instruments
  "UCTT",    // Ultra Clean Holdings
  "CAMT",    // Camtek

  // ========== COMMODITIES & MATERIALS HIGH BETA ==========
  "ATEX",    // Anterios
  "ABAT",    // American Battery Technology
  "MTH",     // Meritage Homes
  "TMHC",    // Taylor Morrison Home
  "KBH",     // KB Home
  "PHM",     // PulteGroup (housing sentiment plays)

  // ========== FINTECH & PAYMENTS HIGH BETA ==========
  "FLYW",    // Flywire
  "RPAY",    // Repay Holdings
  "PRAA",    // PRA Group

  // ========== NARRATIVE / MEME ADJACENT (retail driven) ==========
  "BBBY",    // (check if relisted post-bankruptcy)
  "IMPP",    // Imperial Petroleum
  "AEYE",    // AudioEye
  "GEVI",    // GreenVision (check liquidity)

  // ========== ENERGY — OIL & GAS HIGH BETA (Hormuz shock March 2026) ==========
  "XOM",     // ExxonMobil — Permian titan, $20B buyback
  "CVX",     // Chevron — 1M bpd Permian milestone
  "COP",     // ConocoPhillips — pure upstream high beta
  "OXY",     // Occidental Petroleum — Buffett holding, high beta
  "DVN",     // Devon Energy — US shale high beta
  "FANG",    // Diamondback Energy — Permian pure play
  "APA",     // APA Corporation — international exposure
  "PR",      // Permian Resources
  "CTRA",    // Coterra Energy
  "SM",      // SM Energy — small cap high beta
  "MTDR",    // Matador Resources
  "CHRD",    // Chord Energy
  "NOG",     // Northern Oil and Gas

  // ========== ENERGY SERVICES (leverage to oil price) ==========
  "SLB",     // Schlumberger — services giant
  "HAL",     // Halliburton
  "BKR",     // Baker Hughes
  "WHD",     // Cactus Inc
  "PTEN",    // Patterson-UTI Energy
  "RIG",     // Transocean — offshore drilling high beta
  "VAL",     // Valaris — offshore drilling

  // ========== LNG & MIDSTREAM (supply shock plays) ==========
  "LNG",     // Cheniere Energy — LNG exports
  "NFE",     // New Fortress Energy — LNG high beta
  "NEXT",    // NextDecade — LNG development
  "TRGP",    // Targa Resources
  "WMB",     // Williams Companies

  // ========== MATERIALS & MINING (17.8% YTD, active sector) ==========
  "SCCO",    // Southern Copper
  "NUE",     // Nucor — steel high beta
  "STLD",    // Steel Dynamics
  "CMC",     // Commercial Metals


  // ========== URANIUM (nuclear renaissance active) ==========
  "NXE",     // NexGen Energy

  // ========== PRECIOUS METALS — SILVER & GOLD HIGH BETA ==========
  "SLV",     // iShares Silver Trust ETF
  "SILJ",    // ETFMG Prime Junior Silver ETF

  "KGC",     // Kinross Gold
  "AU",      // AngloGold Ashanti
  "NGD",     // New Gold
  "BTG",     // B2Gold
  "IAG",     // IAMGOLD
  "OR",      // Osisko Gold Royalties

  // ========== COPPER PLAYS (AI infrastructure + energy transition) ==========
  "COPX",    // Global X Copper Miners ETF
  "CPER",    // US Copper Index ETF
  "ARIS",    // Aris Mining

  // ========== DEFENCE (geopolitical spending surge) ==========
  "HII",     // Huntington Ingalls — shipbuilding
  "GD",      // General Dynamics
  "LMT",     // Lockheed Martin
  "RTX",     // RTX Corporation
  "NOC",     // Northrop Grumman
  "SAIC",    // Science Applications

  // ========== UK DEFENCE & ENERGY (LSE active) ==========
  "BP.L",    // BP — oil price beneficiary
  "SHEL.L",  // Shell
  "TLW.L",   // Tullow Oil — high beta oil
  "ENQ.L",   // EnQuest — high beta oil

  // ========== AI PHYSICAL INFRASTRUCTURE (power demand theme) ==========
  "NRG",     // NRG Energy
  "PWR",     // Quanta Services — grid buildout
  "POWL",    // Powell Industries — electrical infrastructure
  "FCEL",    // FuelCell Energy
  "BE",      // Bloom Energy
  "GTLS",    // Chart Industries — industrial gas/LNG equipment

  // ========== SHIPPING (commodity transport bottleneck) ==========
  "ZIM",     // ZIM Integrated Shipping — high beta
  "SBLK",    // Star Bulk Carriers
  "EGLE",    // Eagle Bulk Shipping
  "NMM",     // Navios Maritime Partners
  "CTRM",    // Castor Maritime — speculative
  "TOPS",    // TOP Ships — speculative

  // ========== FERTILISERS & AGRICULTURE (food security theme) ==========
  "MOS",     // Mosaic Company — potash/phosphate
  "NTR",     // Nutrien — fertiliser major
  "CF",      // CF Industries — nitrogen
  "CTVA",    // Corteva — agri science
  "ANDE",    // Andersons

  // ========== INDUSTRIAL METALS ETFs (easy broad exposure) ==========
  "PICK",    // iShares MSCI Global Metals & Mining ETF
  "REMX",    // VanEck Rare Earth/Strategic Metals ETF
  "SIL",     // Global X Silver Miners ETF
  "GDX",     // VanEck Gold Miners ETF
  "GDXJ",    // VanEck Junior Gold Miners ETF — high beta

];

/**
 * Return the full universe with duplicates removed.
 */
export function getUniverse(): string[] {
  return Array.from(new Set(HIGH_RISK_UNIVERSE));
}

export type MarketFilter = "LSE" | "US" | "EU" | "ALL";

const NON_US_SUFFIXES = [".L", ".AS", ".ST", ".HE", ".CO"];

/**
 * Filter universe by market region.
 */
export function filterUniverseByMarket(
  tickers: string[],
  market: MarketFilter,
): string[] {
  switch (market) {
    case "LSE":
      return tickers.filter((t) => t.endsWith(".L"));
    case "EU":
      return tickers.filter(
        (t) =>
          t.endsWith(".AS") ||
          t.endsWith(".ST") ||
          t.endsWith(".HE") ||
          t.endsWith(".CO"),
      );
    case "US":
      return tickers.filter(
        (t) => !NON_US_SUFFIXES.some((s) => t.endsWith(s)),
      );
    case "ALL":
    default:
      return tickers;
  }
}

/**
 * Return true if the ticker's average daily dollar volume exceeds
 * the minimum threshold. Non-US tickers use a lower threshold
 * since LSE/European volumes are naturally lower.
 */
export function hasMinimumLiquidity(
  ticker: string,
  quotes: QuoteLike[],
): boolean {
  const last20 = quotes.slice(-20);
  if (last20.length < 10) return false;

  const avgDollarVolume =
    last20.reduce((sum, q) => sum + q.close * q.volume, 0) / last20.length;

  const isNonUS =
    ticker.endsWith(".L") ||
    ticker.endsWith(".AS") ||
    ticker.endsWith(".ST") ||
    ticker.endsWith(".HE") ||
    ticker.endsWith(".CO");

  const threshold = isNonUS ? 500_000 : 1_000_000;
  return avgDollarVolume >= threshold;
}
