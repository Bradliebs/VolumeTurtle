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

  // ========== BIOTECH — CLINICAL CATALYSTS 2026 ==========
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
  "ADMA",    // ADMA Biologics — Asceniv growth, FDA yield approval
  "ANIP",    // ANI Pharmaceuticals — specialty pharma
  "LQDA",    // Liquidia Technologies — pulmonary hypertension
  "KRYS",    // Krystal Biotech — gene therapy Vyjuvek
  "SPRY",    // ARS Pharmaceuticals — nasal allergy Neffy

  // ========== SEMIS — AI INFRASTRUCTURE PICKS 2026 ==========
  "STX",     // Seagate Technology — AI stock, up 353%
  "LRCX",    // Lam Research — BofA top pick, etch equipment
  "KLAC",    // KLA Corporation — process control, BofA top pick
  "ENTG",    // Entegris — semiconductor materials
  "NVMI",    // Nova Measuring — metrology equipment
  "TER",     // Teradyne — semiconductor test equipment
  "TSEM",    // Tower Semiconductor — specialty foundry
  "MTSI",    // MACOM Technology — optical components AI
  "LITE",    // Lumentum — optical networking AI data centres
  "AKAM",    // Akamai Technologies — AI edge delivery
  "GFS",     // GlobalFoundries — specialty semis

  // ========== ROBOTICS & AUTONOMY ==========
  "ISRG",    // Intuitive Surgical — surgical robots high beta
  "NNDM",    // Nano Dimension — additive manufacturing
  "PATH",    // UiPath — enterprise automation
  "SYM",     // Symbotic — AI warehouse automation
  "DXYZ",    // Destiny Tech100 — private tech exposure

  // ========== DATA STORAGE & AI INFRASTRUCTURE ==========
  "PSTG",    // Pure Storage — flash storage AI
  "NTAP",    // NetApp — hybrid cloud storage
  "WDC",     // Western Digital — HDD/flash storage
  "MU",      // Micron Technology — HBM memory for AI
  "VRT",     // Vertiv Holdings — data centre cooling/power
  "DELL",    // Dell Technologies — AI server infrastructure
  "HPE",     // Hewlett Packard Enterprise — AI servers
  "SMCI",    // Super Micro Computer — AI server high beta

  // ========== OPTICAL NETWORKING (AI data centre buildout) ===========
  // IIVI merged into COHR, INFN acquired — both already in universe

  // ========== GAMING & CONSUMER TECH HIGH BETA ==========
  "RBLX",    // Roblox — metaverse/gaming high beta
  "U",       // Unity Technologies — game engine
  "TTWO",    // Take-Two Interactive — gaming
  "EA",      // Electronic Arts — gaming catalyst plays
  "RSI",     // Rush Street Interactive — online gaming
  "GENI",    // Genius Sports — sports data
  // EVERI and AGS — delisted/acquired

  // ========== CYBERSECURITY HIGH BETA ==========
  "CRWD",    // CrowdStrike — endpoint security
  "S",       // SentinelOne — AI security
  "CYBR",    // CyberArk — identity security
  "TENB",    // Tenable Holdings — vulnerability management
  "QLYS",    // Qualys — cloud security
  "RPD",     // Rapid7 — security analytics
  "VRNS",    // Varonis Systems — data security
  "FTNT",    // Fortinet — network security

  // ========== FINTECH & PAYMENTS HIGH BETA ==========
  "LPLA",    // LPL Financial — wealth management high beta

  // ========== CONSUMER DISCRETIONARY HIGH BETA ==========
  "DRVN",    // Driven Brands — auto services
  "ORLY",    // O'Reilly Auto — defensive but high beta
  "AZO",     // AutoZone — auto parts
  "TSLA",    // Tesla — autonomy/robotics thesis
  "NIO",     // NIO — Chinese EV, high beta
  "LI",      // Li Auto — Chinese EV
  "XPEV",    // XPeng — Chinese EV autonomy

  // ========== UK SMALL/MID CAP HIGH BETA (LSE) ==========
  "TEAM.L",  // Team17 — indie games publisher
  // BOO.L, ASOS.L — delisted or restructured
  "AUTO.L",  // Auto Trader — online automotive
  "ANIC.L",  // Agronomics — alternative protein
  // CERES.L, LOOP.L — delisted or unavailable on Yahoo
  "SDR.L",   // Schroders — asset management

  // ========== EUROPEAN HIGH BETA ==========
  "IFX.DE",  // Infineon — German semis
  "SAP",     // SAP — enterprise software Germany
  "SIE.DE",  // Siemens — industrial/automation Germany
  "DSFIR.AS",// Dufry / Avolta — travel retail

  // ========== COMMODITIES & AGRICULTURE ETFs ==========
  "DBA",     // Invesco DB Agriculture ETF
  "WEAT",    // Teucrium Wheat Fund
  "CORN",    // Teucrium Corn Fund
  "SOYB",    // Teucrium Soybean Fund
  "PALL",    // Aberdeen Palladium ETF
  "PPLT",    // Aberdeen Platinum ETF
  "DBB",     // Invesco DB Base Metals ETF
  "PDBC",    // Invesco Optimum Yield Diversified Commodity

  // ========== LEVERAGED ETFs (high volume spike potential) ==========
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

  // ========== NEW ADDITIONS -- BROAD UNIVERSE EXPANSION ==========

  // --- Technology ---
  "AEHR",   // Aehr Test Systems
  "AIOT",   // PowerFleet Inc
  "AVDX",   // AvidXchange Holdings
  "AZTA",   // Azenta Inc
  "BAND",   // Bandwidth Inc
  "BCOV",   // Brightcove Inc
  "BMBL",   // Bumble Inc
  "BOWX",   // BowX Acquisition
  "CALX",   // Calix Inc
  "CARS",   // Cars.com Inc
  "CEVA",   // CEVA Inc
  "CLFD",   // Clearfield Inc
  "CLPS",   // CLPS Technology
  "CLRO",   // ClearOne Inc
  "CNXC",   // Concentrix Corp
  "COMM",   // CommScope Holding
  "CRDO",   // Credo Technology
  "CRUS",   // Cirrus Logic
  "CTLP",   // Cantaloupe Inc
  "DCBO",   // Docebo Inc
  "DFIN",   // Donnelley Financial
  "DGII",   // Digi International
  "DKDCA",  // Data Knights Acquisition
  "DOMO",   // Domo Inc
  "EGAN",   // eGain Corporation
  "EGIO",   // Edgio Inc
  "ENFN",   // Enfusion Inc
  "ENVX",   // Enovix Corporation
  "ERON",   // Eronics Inc
  "ESMT",   // EngageSmart Inc
  "EVER",   // EverCommerce Inc
  "FIVN",   // Five9 Inc
  "FORA",   // Forian Inc
  "FORG",   // ForgeRock Inc
  "FSLY",   // Fastly Inc
  "GDYN",   // Grid Dynamics Holdings
  "GLBE",   // Global-E Online
  "GRND",   // Grindr Inc
  "GSIT",   // GSI Technology
  "GTLB",   // GitLab Inc
  "HOLO",   // MicroCloud Hologram
  "HSAI",   // Hesai Group
  "IDCC",   // InterDigital Inc
  "INPX",   // Inpixon
  "INSG",   // Inseego Corp
  "INTA",   // Intapp Inc
  "ITRI",   // Itron Inc
  "JTEK",   // Jtek Corp
  "KARO",   // Karooooo Ltd
  "KNWN",   // Know Labs
  "KSCP",   // Knightscope Inc
  "LGTY",   // Logility Inc
  "LLAP",   // Terran Orbital
  "LOGI",   // Logitech International
  "LSCC",   // Lattice Semiconductor
  "LSPD",   // Lightspeed Commerce
  "LUNA",   // Luna Innovations
  "LVOX",   // Livevox Holdings
  "MASS",   // 908 Devices
  "MBTC",   // Limelight Networks
  "MKDW",   // Mekadox Corp
  "MPWR",   // Monolithic Power Systems
  "MTCH",   // Match Group
  "MTTR",   // Matterport Inc
  "NVTS",   // Navitas Semiconductor
  "ONDS",   // Ondas Holdings
  "OPRA",   // Opera Limited
  "OUST",   // Ouster Inc
  "PCOR",   // Procore Technologies
  "PNTM",   // Pontem Corp
  "POWI",   // Power Integrations
  "PPIH",   // Perion Network
  "PRLB",   // Proto Labs
  "PSIG",   // PSigma Corp
  "PUBM",   // PubMatic Inc
  "PWSC",   // PowerSchool Holdings
  "PXLW",   // Pixelworks Inc
  "PYCR",   // Paycor HCM
  "QCOM",   // Qualcomm Inc
  "QNST",   // QuinStreet Inc
  "QTWO",   // Q2 Holdings
  "RDVT",   // Red Violet Inc
  "RFIL",   // RF Industries
  "RMNI",   // Rimini Street
  "ROSG",   // Rosslyn Data Technologies
  "RTLX",   // Raitel Corp
  "RZLT",   // Rezolve AI
  "SATS",   // EchoStar Corporation
  "SCKT",   // Socket Mobile
  "SDGR",   // Schr&ouml;dinger Inc
  "SENS",   // Sensata Technologies
  "SERV",   // Serve Robotics
  "SIDU",   // Sidus Space
  "SITM",   // SiTime Corporation
  "SKIL",   // Skilloft Corp
  "SNCR",   // Synchronoss Technologies
  "SNOW",   // Snowflake Inc
  "SNPO",   // Snap One Holdings
  "SNPS",   // Synopsys Inc
  "SOBR",   // SOBR Safe Inc
  "SOFO",   // Sonic Foundry
  "SONM",   // Sonim Technologies
  "SOTK",   // Sono-Tek Corporation
  "SPIR",   // Spire Global
  "SQSP",   // Squarespace Inc
  "SRAD",   // Sportradar Group
  "SSII",   // SS Innovations
  "SSTI",   // ShotSpotter Inc
  "SSTK",   // Shutterstock Inc
  "SSYS",   // Stratasys Ltd
  "STGW",   // Stagwell Inc
  "STRR",   // Star Equity Holdings
  "SUMO",   // Sumo Logic
  "SVFD",   // Save Foods
  "SVNX",   // 7GC & Co Holdings
  "SWVL",   // Swvl Holdings
  "TACT",   // TransAct Technologies
  "TBLA",   // Taboola.com
  "TCOA",   // Trident Digital Tech
  "TRMR",   // Tremor International
  "TTGT",   // TechTarget Inc
  "TTMI",   // TTM Technologies
  "TWKS",   // Thoughtworks Holding
  "UKXMY",  // Unknown
  "UMAC",   // Unusual Machines
  "UPLD",   // Upland Software
  "UPWK",   // Upwork Inc
  "UTSI",   // UTStarcom Holdings
  "VECO",   // Veeco Instruments
  "VERB",   // Verb Technology
  "VERI",   // Veritone Inc
  "VIAV",   // Viavi Solutions
  "VISN",   // VisionWave Technologies
  "VLNS",   // Valens Semiconductor
  "VMEO",   // Vimeo Inc
  "VNET",   // VNET Group
  "VONE",   // Vnet One
  "VRRM",   // Verra Mobility
  "VRSN",   // VeriSign Inc
  "WAVD",   // WaveDancer Inc
  "WCLD",   // WisdomTree Cloud Computing
  "WDAY",   // Workday Inc
  "WDSY",   // Windsy Corp
  "WGMI",   // Valkyrie Bitcoin Miners ETF
  "WIFI",   // Boingo Wireless
  "WIMI",   // WiMi Hologram Cloud
  "WISA",   // WiSA Technologies
  "WKME",   // WalkMe Ltd
  "WORX",   // SCWorx Corp
  "WRAP",   // Wrap Technologies
  "XGTI",   // XG Technology
  "XHUN",   // Xhun Corp
  "XPER",   // Xperi Inc
  "XRTX",   // Xartis Corp
  "XYLO",   // Xylocore Corp
  "YEXT",   // Yext Inc
  "ZETA",   // Zeta Global Holdings
  "ZFOX",   // ZeroFox Holdings
  "ZPET",   // Zoom Telephonics
  "ZPNL",   // Zipline International
  "ZPTA",   // Zapata Computing
  "ZTLK",   // Zetlek Corp

  // --- Biotech ---
  "ALEC",   // Alector Inc
  "ALVO",   // Alvotech
  "ANAB",   // AnaptysBio Inc
  "APGE",   // Apogee Therapeutics
  "ARVN",   // Arvinas Inc
  "ASND",   // Ascendis Pharma
  "ATAI",   // Atai Life Sciences
  "ATNF",   // 180 Life Sciences
  "AUPH",   // Aurinia Pharmaceuticals
  "AUTL",   // Autolus Therapeutics
  "AVTE",   // Aerovate Therapeutics
  "BCAB",   // BioAtla Inc
  "BDTX",   // Black Diamond Therapeutics
  "BHVN",   // Biohaven Ltd
  "BLTE",   // Belite Bio
  "BLUE",   // bluebird bio
  "BNGO",   // Bionano Genomics
  "BOLT",   // Bolt Biotherapeutics
  "BPMC",   // Blueprint Medicines
  "CBIO",   // Catalyst Biosciences
  "CDMO",   // Avid Bioservices
  "CGEM",   // Cullinan Oncology
  "CHRS",   // Coherus BioSciences
  "CLDX",   // Celldex Therapeutics
  "CNTB",   // Connect Biopharma
  "COLL",   // Collegium Pharmaceutical
  "CORT",   // Corcept Therapeutics
  "CRBP",   // Corbus Pharmaceuticals
  "CRDF",   // Cardiff Oncology
  "CRNX",   // Crinetics Pharmaceuticals
  "CRVS",   // Corvus Pharmaceuticals
  "CTMX",   // CytomX Therapeutics
  "CYCN",   // Cyclerion Therapeutics
  "DBVT",   // DBV Technologies
  "DSGN",   // Design Therapeutics
  "DTIL",   // Precision BioSciences
  "DYAI",   // Dyadic International
  "EDGW",   // Edgewise Therapeutics
  "ELEV",   // Elevation Oncology
  "ELVN",   // Enliven Therapeutics
  "ENVB",   // Enveric Biosciences
  "ERAS",   // Erasca Inc
  "FBIO",   // Fortress Biotech
  "FDMT",   // 4D Molecular Therapeutics
  "FHTX",   // Frontier Medicines
  "FULC",   // Fulcrum Therapeutics
  "GHRS",   // GH Research
  "GLPG",   // Galapagos NV
  "GLYC",   // GlycoMimetics Inc
  "GMAB",   // Genmab AS
  "GNLX",   // Genelux Corporation
  "GOSS",   // Gossamer Bio
  "GRTS",   // Gritstone bio
  "GTHX",   // G1 Therapeutics
  "HARP",   // Harpoon Therapeutics
  "HRMY",   // Harmony Biosciences
  "HUMA",   // Humacyte Inc
  "IDYA",   // IDEAYA Biosciences
  "IFRX",   // InflaRx NV
  "IGMS",   // IGM Biosciences
  "IMGO",   // Imago BioSciences
  "IMTX",   // Immatics NV
  "INBX",   // Inhibrx Inc
  "IRON",   // Disc Medicine
  "ISEE",   // IVERIC bio
  "ITOS",   // iTeos Therapeutics
  "IXHL",   // Incannex Healthcare
  "JANX",   // Janux Therapeutics
  "JNCE",   // Jounce Therapeutics
  "JSPR",   // Jasper Therapeutics
  "KALA",   // Kala Bio
  "KALV",   // KalVista Pharmaceuticals
  "KNSA",   // Kiniksa Pharmaceuticals
  "KRTX",   // Karuna Therapeutics
  "LABP",   // Landos Biopharma
  "LBPH",   // Longboard Pharmaceuticals
  "LMNL",   // Liminal BioSciences
  "LPCN",   // Lipocine Inc
  "LYEL",   // Lyell Immunopharma
  "MACK",   // Merrimack Pharmaceuticals
  "MBIO",   // Mustang Bio
  "MBRX",   // Moleculin Biotech
  "MGNX",   // MacroGenics Inc
  "MIRM",   // Mirum Pharmaceuticals
  "MLTX",   // MoonLake Immunotherapeutics
  "MOLN",   // Molecure SA
  "MORF",   // Morphic Therapeutic
  "MURA",   // Mural Oncology
  "MYMD",   // MyMD Pharmaceuticals
  "NBIX",   // Neurocrine Biosciences
  "NERV",   // Minerva Neurosciences
  "NGNE",   // Neurogene Inc
  "NKTR",   // Nektar Therapeutics
  "NKTX",   // Nkarta Inc
  "NLSP",   // NLS Pharmaceutics
  "NMRA",   // Neumora Therapeutics
  "NRIX",   // Nurix Therapeutics
  "NRSN",   // NeuroSense Therapeutics
  "NRXP",   // NRx Pharmaceuticals
  "NYMX",   // Nymox Pharmaceutical
  "OCUL",   // Ocular Therapeutix
  "ORIC",   // ORIC Pharmaceuticals
  "ORMP",   // Oramed Pharmaceuticals
  "ORTX",   // Orchard Therapeutics
  "OTLK",   // Outlook Therapeutics
  "OVID",   // Ovid Therapeutics
  "OYST",   // Oyster Point Pharma
  "PDSB",   // PDS Biotechnology
  "PHAT",   // Phathom Pharmaceuticals
  "PHIO",   // Phio Pharmaceuticals
  "PIRS",   // Pieris Pharmaceuticals
  "PLUR",   // Pluri Inc
  "PMVP",   // PMV Pharmaceuticals
  "PPBT",   // Purple Biotech
  "PRAX",   // Praxis Precision Medicine
  "PROC",   // Processa Pharmaceuticals
  "PROG",   // ProQR Therapeutics
  "PRTA",   // Prothena Corporation
  "PRVB",   // Provention Bio
  "PSTV",   // Plus Therapeutics
  "PTIX",   // Protagene Inc
  "PYPD",   // PolyPid Ltd
  "QNRX",   // Quoin Pharmaceuticals
  "RAPT",   // RAPT Therapeutics
  "RARE",   // Ultragenyx Pharmaceutical
  "RENB",   // Renovacor Inc
  "REPL",   // Replimune Group
  "RGLS",   // Regulus Therapeutics
  "RGNX",   // REGENXBIO Inc
  "RLAY",   // Relay Therapeutics
  "RLMD",   // Relmada Therapeutics
  "RNAC",   // Cartesian Therapeutics
  "ROIV",   // Roivant Sciences
  "RPTX",   // Repare Therapeutics
  "RUBY",   // Rubius Therapeutics
  "RVPH",   // Revive Pharma
  "RYTM",   // Rhythm Pharmaceuticals
  "SANG",   // Sana Biotechnology
  "SBFM",   // Sunshine Biopharma
  "SCNI",   // Scinai Immunotherapeutics
  "SELB",   // Selecta Biosciences
  "SGMO",   // Sangamo Therapeutics
  "SIOX",   // Sio Gene Therapies
  "SLDB",   // Solid Biosciences
  "SLNO",   // Soleno Therapeutics
  "SLRX",   // Salarius Pharmaceuticals
  "SMMT",   // Summit Therapeutics
  "SNSE",   // Sensei Biotherapeutics
  "SNTX",   // Sontus Biosciences
  "SPRB",   // Spruce Biosciences
  "SPRC",   // SciSparc Ltd
  "SPRO",   // Spero Therapeutics
  "SRRK",   // Scholar Rock
  "STOK",   // Stoke Therapeutics
  "STRO",   // Sutro Biopharma
  "SXTC",   // China SXT Pharmaceuticals
  "SYBX",   // Synlogic Inc
  "SYRS",   // Syros Pharmaceuticals
  "TBPH",   // Theravance Biopharma
  "TCRX",   // TScan Therapeutics
  "TGEN",   // Tricida Inc
  "THTX",   // Theratechnologies Inc
  "TLPH",   // Talphera Inc
  "TNYA",   // Tenaya Therapeutics
  "TORC",   // Restorbio Inc
  "TRDA",   // Entrada Therapeutics
  "TRVI",   // Trevi Therapeutics
  "TRVN",   // Trevena Inc
  "TSHA",   // Taysha Gene Therapies
  "TWST",   // Twist Bioscience
  "URGN",   // UroGen Pharma
  "UTHR",   // United Therapeutics
  "VALN",   // Valneva SE
  "VCNX",   // Vaccinex Inc
  "VERA",   // Vera Therapeutics
  "VERV",   // Verve Therapeutics
  "VIGL",   // Vigil Neuroscience
  "VIRI",   // Virios Therapeutics
  "VLON",   // Vallon Pharmaceuticals
  "VRCA",   // Verrica Pharmaceuticals
  "VTGN",   // Vistagen Therapeutics
  "VXRT",   // Vaxart Inc
  "VYGR",   // Voyager Therapeutics
  "VYNT",   // Vyant Bio
  "WINT",   // Windtree Therapeutics
  "XBIT",   // XBiotech Inc
  "XCUR",   // Exicure Inc
  "XERS",   // Xeris Biopharma
  "XFOR",   // X4 Pharmaceuticals
  "XNCR",   // Xencor Inc
  "XOMA",   // XOMA Corporation
  "XTLB",   // XTL Biopharmaceuticals
  "YMAB",   // Y-mAbs Therapeutics
  "ZGNX",   // Zogenix Inc
  "ZLAB",   // Zymeworks Inc
  "ZNTL",   // Zentalis Pharmaceuticals
  "ZSAN",   // Zosano Pharma
  "ZURA",   // Zura Bio
  "ZVRA",   // Zevra Therapeutics

  // --- Healthcare ---
  "AKYA",   // Akoya Biosciences
  "ATEC",   // Alphatec Holdings
  "ATRC",   // AtriCure Inc
  "AXNX",   // Axonics Inc
  "BFLY",   // Butterfly Network
  "BLFS",   // BioLife Solutions
  "BTSG",   // BrightSpring Health
  "CCRN",   // Cross Country Healthcare
  "CDNA",   // CareDx Inc
  "CMRX",   // Chembio Diagnostics
  "CNMD",   // CONMED Corporation
  "CSTL",   // Castle Biosciences
  "CTSO",   // Cytosorbents Corp
  "CYRX",   // Cryoport Inc
  "DCGO",   // Docgo Inc
  "DRIO",   // DarioHealth Corp
  "DRTS",   // Alpha Tau Medical
  "DXCM",   // Dexcom Inc
  "EMBC",   // Embecta Corp
  "ENOV",   // Enovis Corporation
  "ENSG",   // Ensign Group
  "EOLS",   // Evolent Health
  "EXAS",   // Exact Sciences
  "FLGT",   // Fulgent Genetics
  "GKOS",   // Glaukos Corporation
  "GNPX",   // Genprobe Inc
  "HCAT",   // Health Catalyst
  "HNGR",   // Hanger Inc
  "HROW",   // Harrow Health
  "HTGM",   // HTG Molecular Diagnostics
  "INFU",   // InfuSystem Holdings
  "INGN",   // Inogen Inc
  "INMD",   // InMode Ltd
  "IVVD",   // Invacare Corporation
  "KDLY",   // Kindly MD
  "KIDS",   // OrthoPediatrics Corp
  "LMAT",   // LeMaitre Vascular
  "LNSR",   // LENSAR Inc
  "MDAI",   // Spectral AI
  "MMSI",   // Merit Medical Systems
  "MODV",   // ModivCare Inc
  "MPLN",   // MultiPlan Corp
  "MRVI",   // Maravai LifeSciences
  "MTEM",   // Milestone Scientific
  "MYGN",   // Myriad Genetics
  "NARI",   // Inari Medical
  "NHWK",   // NightHawk Radiology
  "NIOX",   // Circassia Group
  "NNOX",   // Nano-X Imaging
  "NOTV",   // Inotiv Inc
  "NSTG",   // NanoString Technologies
  "OABI",   // OcuSense Inc
  "OFIX",   // Orthofix Medical
  "OPRX",   // OptimizeRx Corp
  "OPTN",   // OptiNose Inc
  "ORKA",   // Orka Health
  "OSCR",   // Oscar Health
  "OSUR",   // OraSure Technologies
  "OTRK",   // Ontrak Inc
  "PACS",   // PACS Group
  "PAHC",   // Phibro Animal Health
  "PAVM",   // PAVmed Inc
  "PCRX",   // Pacira BioSciences
  "PDCO",   // Patterson Companies
  "PODD",   // Insulet Corporation
  "PROF",   // Profound Medical
  "PRPH",   // ProPhase Labs
  "PRXS",   // Proxima Clinical Research
  "PSNL",   // Personalis Inc
  "QDEL",   // QuidelOrtho Corp
  "QGEN",   // Qiagen NV
  "QTRX",   // Quanterix Corporation
  "RGEN",   // Repligen Corporation
  "RNLX",   // Renalytix PLC
  "RPID",   // Rapid Medical
  "RVNC",   // Revance Therapeutics
  "SERA",   // Sera Prognostics
  "SGHT",   // Sight Sciences
  "SGRY",   // Surgery Partners
  "SHCR",   // Sharecare Inc
  "SNYR",   // Synergy CHC Corp
  "SPOK",   // Spok Holdings
  "SRDX",   // Surmodics Inc
  "SRGA",   // Surgalign Holdings
  "SRTS",   // Sensus Healthcare
  "SSKN",   // Strata Skin Sciences
  "STAA",   // STAAR Surgical
  "STXS",   // Stereotaxis Inc
  "SURG",   // SurgiLogix Inc
  "SWAV",   // ShockWave Medical
  "SYTA",   // Sievert Laryngoscope
  "TALK",   // Talkspace
  "TCMD",   // Tactile Systems Technology
  "TELA",   // TELA Bio
  "TKNO",   // Alpha Teknova
  "TMCI",   // Treace Medical Concepts
  "TNON",   // Tenon Medical
  "TXMD",   // TherapeuticsMD
  "USPH",   // U.S. Physical Therapy
  "UTMD",   // Utah Medical Products
  "VCYT",   // Veracyte Inc
  "VERO",   // Venus Medtech
  "VISP",   // Vivos Therapeutics
  "VIVE",   // Viveve Medical
  "VNRX",   // VolitionRx
  "VRAY",   // ViewRay Inc
  "VREX",   // Varex Imaging
  "VTRS",   // Viatris Inc
  "XRAY",   // Dentsply Sirona
  "ZJYL",   // Jin Medical International
  "ZYXI",   // Zynex Medical

  // --- Financial Services ---
  "AMTB",   // Amerant Bancorp
  "AROW",   // Arrow Financial
  "AUCB",   // Auburn National Bancorp
  "BIGZ",   // BlackRock Innovation
  "BRDG",   // Bridge Investment Group
  "CASH",   // Pathward Financial
  "CINF",   // Cincinnati Financial
  "CMPO",   // CompoSecure Inc
  "COOP",   // Mr. Cooper Group
  "EFSC",   // Enterprise Financial
  "EMLD",   // FTAC Athena Acquisition
  "EZPW",   // EZCORP Inc
  "FOUR",   // Shift4 Payments
  "FRGE",   // Forge Global Holdings
  "GCBC",   // Greene County Bancshares
  "HLNE",   // Hamilton Lane
  "HOMB",   // Home BancShares
  "HONE",   // HarborOne Bancorp
  "HRZN",   // Horizon Technology Finance
  "KCGI",   // Kensington Capital Acquisition
  "KINS",   // Kingstone Companies
  "KPLT",   // Katapult Holdings
  "LCNB",   // LCNB Corp
  "LEGA",   // Lead Edge Growth Opportunities
  "LKFN",   // Lakeland Financial
  "LPRO",   // Open Lending
  "LZAGY",  // Lazard Ltd
  "MCBS",   // MetroCity Bankshares
  "MGYR",   // Magyar Bancorp
  "MSVB",   // Mid-Southern Savings Bank
  "NCPL",   // Netcapital Inc
  "NDAQ",   // Nasdaq Inc
  "NRIM",   // Northrim BanCorp
  "NYAX",   // Nayax Ltd
  "OCFC",   // OceanFirst Financial
  "OSBC",   // Old Second Bancorp
  "PBFS",   // Pioneer Bancorp
  "PEBO",   // Peoples Bancorp
  "PFMT",   // Performant Financial
  "PKBK",   // Parke Bancorp
  "PRPB",   // Portman Ridge Finance
  "PTHP",   // Pathfinder Acquisition
  "PVBC",   // Provident Bancorp
  "PYPL",   // PayPal Holdings
  "QFIN",   // 360 DigiTech
  "RCFA",   // RCF Acquisition
  "RFAC",   // RF Acquisition Corp
  "RNST",   // Renasant Corporation
  "RRAC",   // Rigel Rock Acquisition
  "RRBI",   // Red River Bancshares
  "SAMA",   // Schultze Special Purpose
  "SAMG",   // Silvercrest Asset Management
  "SFBC",   // Sound Financial Bancorp
  "SFNC",   // Simmons First National
  "SISY",   // Sisyphus Capital
  "SKWD",   // Skyward Specialty Insurance
  "SLQT",   // SelectQuote Inc
  "SNEX",   // StoneX Group
  "SNTG",   // Sentage Holdings
  "SPNT",   // SiriusPoint Ltd
  "SPTK",   // SportsTek Acquisition
  "SSBI",   // Summit State Bancorp
  "SSBK",   // Southern States Bancshares
  "SSIC",   // Silver Spike Investment
  "STBA",   // S&T Bancorp
  "STNE",   // StoneCo Ltd
  "STWO",   // Aeac Equity Partners
  "SUNL",   // Sunlight Financial
  "SWKH",   // SWK Holdings
  "SYBT",   // Stock Yards Bancorp
  "TBMC",   // Trailblazer Merger
  "TBNK",   // Territorial Bancorp
  "TCBIO",  // Texas Capital Bancshares
  "TCVA",   // TCV Acquisition
  "TIPT",   // Tiptree Inc
  "TPVG",   // TriplePoint Venture Growth
  "TREE",   // LendingTree Inc
  "UBCP",   // United Bancorp
  "UBFO",   // United Security Bancshares
  "UBSI",   // United Bankshares
  "UNTY",   // Unity Bancorp
  "UPBD",   // Upbound Group
  "UVSP",   // Univest Financial
  "VBTX",   // Veritex Community Bank
  "VIRT",   // Virtu Financial
  "VRSK",   // Verisk Analytics
  "VRTS",   // Virtus Investment Partners
  "WAVS",   // Western Acquisition Ventures
  "WETG",   // WeTrade Group
  "WLTW",   // Willis Towers Watson
  "WNEB",   // Western New England Bancorp
  "WNNR",   // Anner Acquisition Corp
  "WRLD",   // World Acceptance Corp
  "WSBC",   // WesBanco Inc
  "WSFS",   // WSFS Financial
  "WTBA",   // West Bancorporation
  "WTFC",   // Wintrust Financial
  "XFIN",   // ExcelFin Acquisition
  "YOTA",   // Yotta Acquisition
  "YOUN",   // Yours Truly Acquisition
  "ZION",   // Zions Bancorporation
  "ZWRK",   // Z-Work Acquisition

  // --- Consumer Discretionary ---
  "ARHS",   // Arhaus Inc
  "BARK",   // BARK Inc
  "BURL",   // Burlington Stores
  "COCO",   // Vita Coco Company
  "COOK",   // Traeger Inc
  "CRON",   // Cronos Group
  "DASH",   // DoorDash Inc
  "DIBS",   // 1stDibs.com
  "ETSY",   // Etsy Inc
  "FLXS",   // Flexsteel Industries
  "FNKO",   // Funko Inc
  "FTLF",   // FitLife Brands
  "FWRG",   // First Watch Restaurant
  "GRPN",   // Groupon Inc
  "HAYW",   // Hayward Holdings
  "HOFV",   // Hall of Fame Resort
  "KRUS",   // Kura Sushi USA
  "KVUE",   // Kenvue Inc
  "LCUT",   // Lifetime Brands
  "LESL",   // Leslie's Inc
  "LYFT",   // Lyft Inc
  "MHUA",   // Meihua International
  "MLCO",   // Melco Resorts
  "MSGE",   // Madison Square Garden Entertainment
  "MSGM",   // Motorsport Games
  "MYPS",   // PLAYSTUDIOS Inc
  "NDLS",   // Noodles & Company
  "NFLX",   // Netflix Inc
  "NOMD",   // Nomad Foods
  "NWTN",   // NWTN Inc
  "NXST",   // Nexstar Media Group
  "PBPB",   // Potbelly Corporation
  "PETS",   // PetMed Express
  "PLBY",   // PLBY Group
  "PLCE",   // Children's Place
  "PRTS",   // CarParts.com
  "PTLO",   // Portillo's Inc
  "RCKY",   // Rocky Brands
  "REAL",   // The RealReal Inc
  "RENT",   // Rent the Runway
  "ROLV",   // Rolf Benz AG
  "ROST",   // Ross Stores
  "ROVR",   // Rover Group
  "RSVR",   // Reservoir Media
  "SCVL",   // Shoe Carnival
  "SHAK",   // Shake Shack
  "SMPL",   // Simply Good Foods
  "SNAX",   // Stryve Foods
  "SNBR",   // Sleep Number Corp
  "SOCH",   // Society Pass
  "SOWG",   // Sow Good Inc
  "SPHR",   // Sphere Entertainment
  "SPWH",   // Sportsman's Warehouse
  "SWAG",   // Wag Group
  "TDTH",   // Tastemaker Acquisition
  "TDUP",   // ThredUp Inc
  "THRM",   // Gentherm Inc
  "TLRY",   // Tilray Brands
  "TPXGY",  // Tempur-Pedic International
  "TXRH",   // Texas Roadhouse
  "ULTA",   // Ulta Beauty
  "UNFI",   // United Natural Foods
  "VGFC",   // The Very Good Food
  "VIPS",   // Vipshop Holdings
  "VIRC",   // Virco Manufacturing
  "VITL",   // Vital Farms
  "VLGEA",  // Village Super Market
  "VNTG",   // Vintage Wine Estates
  "VSCO",   // Victoria's Secret
  "VSTO",   // Vista Outdoor
  "WDFC",   // WD-40 Company
  "WEST",   // Westrock Coffee
  "WFCF",   // Where Food Comes From
  "WISH",   // ContextLogic Inc
  "WLYB",   // John Wiley & Sons
  "WVVI",   // Willamette Valley Vineyards
  "WVVIP",  // Willamette Valley Vineyards
  "WYND",   // Wyndham Hotels & Resorts
  "XELB",   // Xcel Brands
  "XPEL",   // XPEL Inc
  "XPOF",   // Xponential Fitness
  "XWEL",   // XWELL Inc
  "XXII",   // 22nd Century Group
  "YGTY",   // Youngevity International
  "YOSH",   // Yoshiharu Global
  "ZUMZ",   // Zumiez Inc

  // --- Industrials ---
  "ASLE",   // AerSale Corp
  "AZEK",   // AZEK Company
  "CDRE",   // Cadre Holdings
  "CPSH",   // CPS Technologies
  "ECVT",   // Ecovyst Inc
  "ESAB",   // ESAB Corporation
  "FGNV",   // Forgen Inc
  "FSTR",   // L.B. Foster Company
  "GRAM",   // Greenbrier Companies
  "GRIN",   // Grindrod Shipping
  "GWRS",   // Global Water Technologies
  "HLIO",   // Helios Technologies
  "HWKN",   // Hawkins Inc
  "NWGL",   // Nature Wood Group
  "OFLX",   // Omega Flex Inc
  "PKOH",   // Park-Ohio Holdings
  "PSHG",   // Performance Shipping
  "PSIX",   // Power Solutions International
  "PTVE",   // Pactiv Evergreen
  "RETO",   // ReTo Eco-Solutions
  "ROAD",   // Construction Partners
  "SAIA",   // Saia Inc
  "SGBX",   // Safe & Green Holdings
  "SLGN",   // Silgan Holdings
  "SLNK",   // Sterling Infrastructure
  "SNCY",   // Sun Country Airlines
  "SPGX",   // Sustainable Green Team
  "STCN",   // Steel Connect
  "TITN",   // Titan Machinery
  "TPIC",   // TPI Composites
  "UHAL",   // U-Haul Holding
  "ULCC",   // Frontier Group Holdings
  "VRTV",   // Veritiv Corporation
  "WLDN",   // Willdan Group
  "WLFC",   // Willis Lease Finance
  "WLMS",   // Williams Industrial Services
  "XTIA",   // XTI Aerospace
  "YORW",   // York Water Company

  // --- Energy ---
  "BNRG",   // Brenmiller Energy
  "CLNE",   // Clean Energy Fuels
  "DSSI",   // Diamond S Shipping
  "ERES",   // East Resources Acquisition
  "EVTV",   // Envirotech Vehicles
  "FLNC",   // Fluence Energy
  "FMST",   // Foremost Lithium
  "FTCI",   // FTC Solar
  "GEVO",   // Gevo Inc
  "GLNG",   // Golar LNG
  "GORV",   // Goliath Resources
  "GRNV",   // GreenVision Acquisition
  "HLTX",   // Heliox
  "HTOO",   // Fusion Fuel Green
  "HYPD",   // HyperDynamics Corp
  "KLXE",   // KLX Energy Services
  "MNTK",   // Montauk Renewables
  "MPLX",   // MPLX LP
  "MVST",   // Microvast Holdings
  "PLTM",   // Platinum Group Metals
  "PTRA",   // Proterra Inc
  "PUMP",   // ProPetro Holding
  "RGLD",   // Royal Gold Inc
  "RNER",   // Range Nuclear Renaissance
  "RONI",   // Rice Acquisition Corp
  "SBSW",   // Sibanye Stillwater
  "SDIG",   // Stronghold Digital Mining
  "SOLY",   // Solitario Resources
  "TALO",   // Talos Energy
  "TELL",   // Tellurian Inc
  "TRNX",   // Taronis Fuels
  "TUSK",   // Mammoth Energy Services
  "TZPS",   // Topaz Energy
  "USAU",   // U.S. Gold Corp
  "USEG",   // U.S. Energy Corp
  "VGAS",   // Verde Clean Fuels
  "VIST",   // Vista Oil & Gas
  "VOXR",   // Vox Royalty
  "VVPR",   // VivoPower International
  "WBX",    // Wallbox NV
  "WFRD",   // Weatherford International
  "WGSWF",  // Westgold Resources
  "WPRT",   // Westport Fuel Systems
  "WTTR",   // Select Water Solutions
  "XPDB",   // Power & Digital Infrastructure
  "XPON",   // Expion360
  "XPRO",   // Expro Group Holdings
  "ZOOZ",   // ZOOZ Power

  // --- Real Estate ---
  "BRSP",   // BrightSpire Capital
  "COMP",   // Compass Inc
  "FCPT",   // Four Corners Property
  "FRPH",   // FRP Holdings
  "HOVNP",  // Hovnanian Enterprises
  "LRHC",   // La Rosa Holdings
  "NTST",   // NETSTREIT Corp
  "NXRT",   // NexPoint Residential
  "OPAD",   // Offerpad Solutions
  "PEAK",   // Healthpeak Properties
  "REAX",   // The Real Brokerage
  "REFI",   // Chicago Atlantic Real Estate
  "REXR",   // Rexford Industrial Realty
  "RLTY",   // Cohen & Steers Real Estate
  "SAFE",   // Safehold Inc
  "STRW",   // Strawberry Fields REIT
  "TRTX",   // TPG RE Finance Trust
  "UNIT",   // Uniti Group
  "WHLR",   // Wheeler REIT


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
