const fs = require('fs');

// Full CSV data
const csvData = `AEHR,Aehr Test Systems,Technology,400000000
AIOT,PowerFleet Inc,Technology,300000000
AKYA,Akoya Biosciences,Healthcare,200000000
ALEC,Alector Inc,Biotech,400000000
ALVO,Alvotech,Biotech,1500000000
AMTB,Amerant Bancorp,Financial Services,400000000
ANAB,AnaptysBio Inc,Biotech,800000000
APGE,Apogee Therapeutics,Biotech,1500000000
ARHS,Arhaus Inc,Consumer Discretionary,1200000000
ARNA,Arcus Biosciences,Biotech,800000000
AROW,Arrow Financial,Financial Services,300000000
ARVN,Arvinas Inc,Biotech,1800000000
ASLE,AerSale Corp,Industrials,300000000
ASND,Ascendis Pharma,Biotech,8000000000
ASTS,AST SpaceMobile,Technology,3000000000
ATAI,Atai Life Sciences,Biotech,300000000
ATEC,Alphatec Holdings,Healthcare,700000000
ATNF,180 Life Sciences,Biotech,50000000
ATRC,AtriCure Inc,Healthcare,1500000000
AUCB,Auburn National Bancorp,Financial Services,100000000
AUPH,Aurinia Pharmaceuticals,Biotech,600000000
AUTL,Autolus Therapeutics,Biotech,700000000
AVDX,AvidXchange Holdings,Technology,1500000000
AVTE,Aerovate Therapeutics,Biotech,300000000
AXNX,Axonics Inc,Healthcare,1800000000
AZEK,AZEK Company,Industrials,3500000000
AZTA,Azenta Inc,Technology,2000000000
BAND,Bandwidth Inc,Technology,700000000
BARK,BARK Inc,Consumer Discretionary,200000000
BCAB,BioAtla Inc,Biotech,200000000
BCOV,Brightcove Inc,Technology,200000000
BDTX,Black Diamond Therapeutics,Biotech,200000000
BFLY,Butterfly Network,Healthcare,400000000
BHVN,Biohaven Ltd,Biotech,3000000000
BIGZ,BlackRock Innovation,Financial Services,500000000
BKSY,BlackSky Technology,Technology,300000000
BLFS,BioLife Solutions,Healthcare,400000000
BLTE,Belite Bio,Biotech,600000000
BLUE,bluebird bio,Biotech,300000000
BMBL,Bumble Inc,Technology,1500000000
BNGO,Bionano Genomics,Biotech,100000000
BNRG,Brenmiller Energy,Energy,50000000
BOLT,Bolt Biotherapeutics,Biotech,100000000
BOWX,BowX Acquisition,Technology,200000000
BPMC,Blueprint Medicines,Biotech,4000000000
BRDG,Bridge Investment Group,Financial Services,700000000
BRSP,BrightSpire Capital,Real Estate,700000000
BTSG,BrightSpring Health,Healthcare,2000000000
BURL,Burlington Stores,Consumer Discretionary,12000000000
CALX,Calix Inc,Technology,2500000000
CARS,Cars.com Inc,Technology,1000000000
CASH,Pathward Financial,Financial Services,1200000000
CBIO,Catalyst Biosciences,Biotech,50000000
CCRN,Cross Country Healthcare,Healthcare,700000000
CDMO,Avid Bioservices,Biotech,600000000
CDNA,CareDx Inc,Healthcare,700000000
CDRE,Cadre Holdings,Industrials,800000000
CELC,Celcuity Inc,Biotech,500000000
CERT,Certara Inc,Healthcare,3000000000
CEVA,CEVA Inc,Technology,500000000
CGEM,Cullinan Oncology,Biotech,400000000
CHRS,Coherus BioSciences,Biotech,200000000
CIFR,Cipher Mining,Technology,400000000
CINF,Cincinnati Financial,Financial Services,18000000000
CLDX,Celldex Therapeutics,Biotech,1500000000
CLFD,Clearfield Inc,Technology,400000000
CLNE,Clean Energy Fuels,Energy,600000000
CLPS,CLPS Technology,Technology,100000000
CLRO,ClearOne Inc,Technology,50000000
CMPO,CompoSecure Inc,Financial Services,500000000
CMRX,Chembio Diagnostics,Healthcare,50000000
CNMD,CONMED Corporation,Healthcare,1500000000
CNTB,Connect Biopharma,Biotech,300000000
CNXC,Concentrix Corp,Technology,4000000000
COCO,Vita Coco Company,Consumer Discretionary,600000000
COIN,Coinbase Global,Financial Services,40000000000
COLL,Collegium Pharmaceutical,Biotech,1000000000
COMM,CommScope Holding,Technology,700000000
COMP,Compass Inc,Real Estate,2000000000
COOK,Traeger Inc,Consumer Discretionary,300000000
COOP,Mr. Cooper Group,Financial Services,4000000000
CORT,Corcept Therapeutics,Biotech,3000000000
CPSH,CPS Technologies,Industrials,50000000
CRBP,Corbus Pharmaceuticals,Biotech,300000000
CRDF,Cardiff Oncology,Biotech,100000000
CRDO,Credo Technology,Technology,3000000000
CRNX,Crinetics Pharmaceuticals,Biotech,3000000000
CRON,Cronos Group,Consumer Discretionary,700000000
CRUS,Cirrus Logic,Technology,4000000000
CRVS,Corvus Pharmaceuticals,Biotech,100000000
CSTL,Castle Biosciences,Healthcare,500000000
CTLP,Cantaloupe Inc,Technology,400000000
CTMX,CytomX Therapeutics,Biotech,100000000
CTSO,Cytosorbents Corp,Healthcare,100000000
CYCN,Cyclerion Therapeutics,Biotech,50000000
CYRX,Cryoport Inc,Healthcare,400000000
DASH,DoorDash Inc,Consumer Discretionary,40000000000
DBVT,DBV Technologies,Biotech,200000000
DCBO,Docebo Inc,Technology,1000000000
DCGO,Docgo Inc,Healthcare,400000000
DFIN,Donnelley Financial,Technology,1500000000
DGII,Digi International,Technology,700000000
DIBS,1stDibs.com,Consumer Discretionary,200000000
DKDCA,Data Knights Acquisition,Technology,100000000
DNLI,Denali Therapeutics,Biotech,2500000000
DNTH,Dianthus Therapeutics,Biotech,300000000
DOMO,Domo Inc,Technology,500000000
DRIO,DarioHealth Corp,Healthcare,100000000
DRTS,Alpha Tau Medical,Healthcare,200000000
DSGN,Design Therapeutics,Biotech,200000000
DSSI,Diamond S Shipping,Energy,500000000
DTIL,Precision BioSciences,Biotech,100000000
DXCM,Dexcom Inc,Healthcare,25000000000
DYAI,Dyadic International,Biotech,100000000
ECVT,Ecovyst Inc,Industrials,700000000
EDGW,Edgewise Therapeutics,Biotech,1500000000
EFSC,Enterprise Financial,Financial Services,1200000000
EGAN,eGain Corporation,Technology,200000000
EGIO,Edgio Inc,Technology,100000000
ELEV,Elevation Oncology,Biotech,100000000
ELVN,Enliven Therapeutics,Biotech,800000000
EMBC,Embecta Corp,Healthcare,700000000
EMLD,FTAC Athena Acquisition,Financial Services,200000000
ENFN,Enfusion Inc,Technology,700000000
ENOV,Enovis Corporation,Healthcare,2000000000
ENSG,Ensign Group,Healthcare,4000000000
ENVB,Enveric Biosciences,Biotech,50000000
ENVX,Enovix Corporation,Technology,1500000000
EOLS,Evolent Health,Healthcare,2000000000
ERAS,Erasca Inc,Biotech,500000000
ERES,East Resources Acquisition,Energy,200000000
ERON,Eronics Inc,Technology,100000000
ESAB,ESAB Corporation,Industrials,4000000000
ESMT,EngageSmart Inc,Technology,3000000000
ETSY,Etsy Inc,Consumer Discretionary,8000000000
EVER,EverCommerce Inc,Technology,1500000000
EVGO,EVgo Inc,Energy,1000000000
EVTV,Envirotech Vehicles,Energy,50000000
EXAS,Exact Sciences,Healthcare,7000000000
EXEL,Exelixis Inc,Biotech,5000000000
EZPW,EZCORP Inc,Financial Services,500000000
FBIO,Fortress Biotech,Biotech,200000000
FCPT,Four Corners Property,Real Estate,2000000000
FDMT,4D Molecular Therapeutics,Biotech,500000000
FGNV,Forgen Inc,Industrials,100000000
FHTX,Frontier Medicines,Biotech,500000000
FIVN,Five9 Inc,Technology,2000000000
FLGT,Fulgent Genetics,Healthcare,500000000
FLNC,Fluence Energy,Energy,1500000000
FLXS,Flexsteel Industries,Consumer Discretionary,200000000
FMST,Foremost Lithium,Energy,50000000
FNKO,Funko Inc,Consumer Discretionary,400000000
FOLD,Amicus Therapeutics,Biotech,3000000000
FORA,Forian Inc,Technology,100000000
FORG,ForgeRock Inc,Technology,2000000000
FOUR,Shift4 Payments,Financial Services,5000000000
FRGE,Forge Global Holdings,Financial Services,300000000
FRPH,FRP Holdings,Real Estate,700000000
FSLY,Fastly Inc,Technology,1200000000
FSTR,L.B. Foster Company,Industrials,300000000
FTCI,FTC Solar,Energy,100000000
FTLF,FitLife Brands,Consumer Discretionary,100000000
FULC,Fulcrum Therapeutics,Biotech,300000000
FWRG,First Watch Restaurant,Consumer Discretionary,700000000
GCBC,Greene County Bancshares,Financial Services,200000000
GDYN,Grid Dynamics Holdings,Technology,500000000
GEVO,Gevo Inc,Energy,200000000
GHRS,GH Research,Biotech,700000000
GKOS,Glaukos Corporation,Healthcare,3000000000
GLBE,Global-E Online,Technology,5000000000
GLNG,Golar LNG,Energy,3000000000
GLPG,Galapagos NV,Biotech,3000000000
GLYC,GlycoMimetics Inc,Biotech,50000000
GMAB,Genmab AS,Biotech,15000000000
GNLX,Genelux Corporation,Biotech,200000000
GNPX,Genprobe Inc,Healthcare,100000000
GORV,Goliath Resources,Energy,50000000
GOSS,Gossamer Bio,Biotech,100000000
GRAM,Greenbrier Companies,Industrials,1000000000
GRND,Grindr Inc,Technology,1500000000
GRIN,Grindrod Shipping,Industrials,200000000
GRNV,GreenVision Acquisition,Energy,50000000
GRPN,Groupon Inc,Consumer Discretionary,200000000
GRTS,Gritstone bio,Biotech,100000000
GSIT,GSI Technology,Technology,100000000
GTHX,G1 Therapeutics,Biotech,200000000
GTLB,GitLab Inc,Technology,7000000000
GWRS,Global Water Technologies,Industrials,100000000
HALO,Halozyme Therapeutics,Biotech,5000000000
HARP,Harpoon Therapeutics,Biotech,200000000
HAYW,Hayward Holdings,Consumer Discretionary,2000000000
HCAT,Health Catalyst,Healthcare,400000000
HIMS,Hims & Hers Health,Healthcare,3500000000
HLIO,Helios Technologies,Industrials,2000000000
HLNE,Hamilton Lane,Financial Services,5000000000
HLTX,Heliox,Energy,100000000
HNGR,Hanger Inc,Healthcare,400000000
HOFV,Hall of Fame Resort,Consumer Discretionary,100000000
HOLO,MicroCloud Hologram,Technology,100000000
HOMB,Home BancShares,Financial Services,4000000000
HONE,HarborOne Bancorp,Financial Services,400000000
HOVNP,Hovnanian Enterprises,Real Estate,700000000
HRMY,Harmony Biosciences,Biotech,1000000000
HROW,Harrow Health,Healthcare,500000000
HRZN,Horizon Technology Finance,Financial Services,400000000
HSAI,Hesai Group,Technology,800000000
HTGM,HTG Molecular Diagnostics,Healthcare,50000000
HTOO,Fusion Fuel Green,Energy,50000000
HUMA,Humacyte Inc,Biotech,300000000
HWKN,Hawkins Inc,Industrials,1000000000
HYMC,Hycroft Mining,Energy,100000000
HYPD,HyperDynamics Corp,Energy,50000000
IDCC,InterDigital Inc,Technology,3000000000
IDYA,IDEAYA Biosciences,Biotech,2000000000
IFRX,InflaRx NV,Biotech,100000000
IGMS,IGM Biosciences,Biotech,400000000
IMGO,Imago BioSciences,Biotech,500000000
IMTX,Immatics NV,Biotech,700000000
INBX,Inhibrx Inc,Biotech,1500000000
INFU,InfuSystem Holdings,Healthcare,200000000
INGN,Inogen Inc,Healthcare,300000000
INMD,InMode Ltd,Healthcare,1500000000
INPX,Inpixon,Technology,50000000
INSG,Inseego Corp,Technology,100000000
INTA,Intapp Inc,Technology,2000000000
IRON,Disc Medicine,Biotech,700000000
ISEE,IVERIC bio,Biotech,1500000000
ISRG,Intuitive Surgical,Healthcare,150000000000
ITOS,iTeos Therapeutics,Biotech,700000000
ITRI,Itron Inc,Technology,3000000000
IVVD,Invacare Corporation,Healthcare,100000000
IXHL,Incannex Healthcare,Biotech,50000000
JANX,Janux Therapeutics,Biotech,1500000000
JNCE,Jounce Therapeutics,Biotech,100000000
JOBY,Joby Aviation,Industrials,5000000000
JSPR,Jasper Therapeutics,Biotech,200000000
JTEK,Jtek Corp,Technology,50000000
KALA,Kala Bio,Biotech,100000000
KALV,KalVista Pharmaceuticals,Biotech,200000000
KARO,Karooooo Ltd,Technology,1000000000
KCGI,Kensington Capital Acquisition,Financial Services,200000000
KDLY,Kindly MD,Healthcare,50000000
KIDS,OrthoPediatrics Corp,Healthcare,600000000
KINS,Kingstone Companies,Financial Services,100000000
KLXE,KLX Energy Services,Energy,200000000
KNSA,Kiniksa Pharmaceuticals,Biotech,800000000
KNWN,Know Labs,Technology,50000000
KPLT,Katapult Holdings,Financial Services,100000000
KRTX,Karuna Therapeutics,Biotech,3000000000
KRUS,Kura Sushi USA,Consumer Discretionary,300000000
KSCP,Knightscope Inc,Technology,100000000
KVUE,Kenvue Inc,Consumer Discretionary,40000000000
LABP,Landos Biopharma,Biotech,100000000
LBPH,Longboard Pharmaceuticals,Biotech,700000000
LCNB,LCNB Corp,Financial Services,200000000
LCUT,Lifetime Brands,Consumer Discretionary,200000000
LEGA,Lead Edge Growth Opportunities,Financial Services,200000000
LESL,Leslie's Inc,Consumer Discretionary,700000000
LGTY,Logility Inc,Technology,200000000
LKFN,Lakeland Financial,Financial Services,1500000000
LLAP,Terran Orbital,Technology,200000000
LMAT,LeMaitre Vascular,Healthcare,1000000000
LMNL,Liminal BioSciences,Biotech,100000000
LNSR,LENSAR Inc,Healthcare,100000000
LNTH,Lantheus Holdings,Healthcare,5000000000
LOGI,Logitech International,Technology,10000000000
LPCN,Lipocine Inc,Biotech,50000000
LPRO,Open Lending,Financial Services,700000000
LQDA,Liquidia Corporation,Biotech,1000000000
LRHC,La Rosa Holdings,Real Estate,50000000
LSCC,Lattice Semiconductor,Technology,6000000000
LSPD,Lightspeed Commerce,Technology,2000000000
LUNA,Luna Innovations,Technology,200000000
LVOX,Livevox Holdings,Technology,200000000
LYEL,Lyell Immunopharma,Biotech,400000000
LYFT,Lyft Inc,Consumer Discretionary,5000000000
LZAGY,Lazard Ltd,Financial Services,3000000000
MACK,Merrimack Pharmaceuticals,Biotech,200000000
MAPS,WM Technology,Technology,300000000
MASS,908 Devices,Technology,200000000
MBIO,Mustang Bio,Biotech,50000000
MBRX,Moleculin Biotech,Biotech,50000000
MBTC,Limelight Networks,Technology,100000000
MCBS,MetroCity Bankshares,Financial Services,300000000
MCRB,Seres Therapeutics,Biotech,300000000
MDAI,Spectral AI,Healthcare,100000000
MGNX,MacroGenics Inc,Biotech,300000000
MGYR,Magyar Bancorp,Financial Services,50000000
MHUA,Meihua International,Consumer Discretionary,100000000
MIRM,Mirum Pharmaceuticals,Biotech,1000000000
MKDW,Mekadox Corp,Technology,50000000
MLCO,Melco Resorts,Consumer Discretionary,3000000000
MLTX,MoonLake Immunotherapeutics,Biotech,2000000000
MMSI,Merit Medical Systems,Healthcare,2500000000
MNTK,Montauk Renewables,Energy,700000000
MODV,ModivCare Inc,Healthcare,400000000
MOLN,Molecure SA,Biotech,100000000
MORF,Morphic Therapeutic,Biotech,1500000000
MPLN,MultiPlan Corp,Healthcare,400000000
MPLX,MPLX LP,Energy,15000000000
MPWR,Monolithic Power Systems,Technology,20000000000
MRVI,Maravai LifeSciences,Healthcare,1000000000
MSGE,Madison Square Garden Entertainment,Consumer Discretionary,1500000000
MSGM,Motorsport Games,Consumer Discretionary,50000000
MSVB,Mid-Southern Savings Bank,Financial Services,50000000
MTCH,Match Group,Technology,8000000000
MTEM,Milestone Scientific,Healthcare,100000000
MTTR,Matterport Inc,Technology,700000000
MURA,Mural Oncology,Biotech,300000000
MVST,Microvast Holdings,Energy,300000000
MYGN,Myriad Genetics,Healthcare,1000000000
MYMD,MyMD Pharmaceuticals,Biotech,50000000
MYPS,PLAYSTUDIOS Inc,Consumer Discretionary,200000000
NARI,Inari Medical,Healthcare,2000000000
NBIX,Neurocrine Biosciences,Biotech,10000000000
NCPL,Netcapital Inc,Financial Services,50000000
NDAQ,Nasdaq Inc,Financial Services,35000000000
NDLS,Noodles & Company,Consumer Discretionary,100000000
NERV,Minerva Neurosciences,Biotech,100000000
NFLX,Netflix Inc,Consumer Discretionary,350000000000
NGNE,Neurogene Inc,Biotech,700000000
NHWK,NightHawk Radiology,Healthcare,50000000
NIOX,Circassia Group,Healthcare,100000000
NKTR,Nektar Therapeutics,Biotech,400000000
NKTX,Nkarta Inc,Biotech,300000000
NLSP,NLS Pharmaceutics,Biotech,50000000
NMRA,Neumora Therapeutics,Biotech,1000000000
NNOX,Nano-X Imaging,Healthcare,400000000
NOMD,Nomad Foods,Consumer Discretionary,3000000000
NOTV,Inotiv Inc,Healthcare,200000000
NRDS,NerdWallet Inc,Financial Services,600000000
NRIM,Northrim BanCorp,Financial Services,200000000
NRIX,Nurix Therapeutics,Biotech,700000000
NRSN,NeuroSense Therapeutics,Biotech,50000000
NRXP,NRx Pharmaceuticals,Biotech,50000000
NSTG,NanoString Technologies,Healthcare,200000000
NTST,NETSTREIT Corp,Real Estate,1000000000
NVTS,Navitas Semiconductor,Technology,1000000000
NWGL,Nature Wood Group,Industrials,50000000
NWTN,NWTN Inc,Consumer Discretionary,200000000
NXRT,NexPoint Residential,Real Estate,700000000
NXST,Nexstar Media Group,Consumer Discretionary,4000000000
NYAX,Nayax Ltd,Financial Services,700000000
NYMX,Nymox Pharmaceutical,Biotech,100000000
OABI,OcuSense Inc,Healthcare,50000000
OCFC,OceanFirst Financial,Financial Services,1000000000
OCUL,Ocular Therapeutix,Biotech,500000000
OFIX,Orthofix Medical,Healthcare,400000000
OFLX,Omega Flex Inc,Industrials,400000000
ONDS,Ondas Holdings,Technology,100000000
OPAD,Offerpad Solutions,Real Estate,100000000
OPRA,Opera Limited,Technology,700000000
OPRX,OptimizeRx Corp,Healthcare,200000000
OPTN,OptiNose Inc,Healthcare,100000000
ORIC,ORIC Pharmaceuticals,Biotech,300000000
ORKA,Orka Health,Healthcare,100000000
ORMP,Oramed Pharmaceuticals,Biotech,200000000
ORTX,Orchard Therapeutics,Biotech,300000000
OSBC,Old Second Bancorp,Financial Services,300000000
OSCR,Oscar Health,Healthcare,3000000000
OSUR,OraSure Technologies,Healthcare,400000000
OTLK,Outlook Therapeutics,Biotech,50000000
OTRK,Ontrak Inc,Healthcare,50000000
OUST,Ouster Inc,Technology,400000000
OVID,Ovid Therapeutics,Biotech,200000000
OYST,Oyster Point Pharma,Biotech,300000000
PACS,PACS Group,Healthcare,3000000000
PAHC,Phibro Animal Health,Healthcare,400000000
PAVM,PAVmed Inc,Healthcare,50000000
PAYO,Payoneer Global,Financial Services,2000000000
PBFS,Pioneer Bancorp,Financial Services,200000000
PBPB,Potbelly Corporation,Consumer Discretionary,200000000
PCOR,Procore Technologies,Technology,10000000000
PCRX,Pacira BioSciences,Healthcare,1000000000
PDCO,Patterson Companies,Healthcare,2000000000
PDSB,PDS Biotechnology,Biotech,100000000
PEAK,Healthpeak Properties,Real Estate,10000000000
PEBO,Peoples Bancorp,Financial Services,700000000
PETS,PetMed Express,Consumer Discretionary,200000000
PFMT,Performant Financial,Financial Services,200000000
PHAT,Phathom Pharmaceuticals,Biotech,400000000
PHIO,Phio Pharmaceuticals,Biotech,50000000
PIRS,Pieris Pharmaceuticals,Biotech,100000000
PKBK,Parke Bancorp,Financial Services,200000000
PKOH,Park-Ohio Holdings,Industrials,300000000
PLAB,Photronics Inc,Technology,700000000
PLBY,PLBY Group,Consumer Discretionary,100000000
PLCE,Children's Place,Consumer Discretionary,200000000
PLTM,Platinum Group Metals,Energy,100000000
PLUR,Pluri Inc,Biotech,100000000
PMVP,PMV Pharmaceuticals,Biotech,300000000
PNTM,Pontem Corp,Technology,100000000
PODD,Insulet Corporation,Healthcare,10000000000
POWI,Power Integrations,Technology,3000000000
PPBT,Purple Biotech,Biotech,50000000
PPIH,Perion Network,Technology,400000000
PRAX,Praxis Precision Medicine,Biotech,1000000000
PRGO,Perrigo Company,Healthcare,3000000000
PRLB,Proto Labs,Technology,700000000
PROC,Processa Pharmaceuticals,Biotech,50000000
PROF,Profound Medical,Healthcare,100000000
PROG,ProQR Therapeutics,Biotech,100000000
PRPH,ProPhase Labs,Healthcare,100000000
PRPB,Portman Ridge Finance,Financial Services,300000000
PRTA,Prothena Corporation,Biotech,1500000000
PRTS,CarParts.com,Consumer Discretionary,200000000
PRVB,Provention Bio,Biotech,700000000
PRXS,Proxima Clinical Research,Healthcare,50000000
PSFE,Paysafe Limited,Financial Services,700000000
PSHG,Performance Shipping,Industrials,50000000
PSIG,PSigma Corp,Technology,50000000
PSIX,Power Solutions International,Industrials,100000000
PSNL,Personalis Inc,Healthcare,200000000
PSTV,Plus Therapeutics,Biotech,50000000
PTGX,Protagonist Therapeutics,Biotech,2000000000
PTHP,Pathfinder Acquisition,Financial Services,100000000
PTIX,Protagene Inc,Biotech,50000000
PTLO,Portillo's Inc,Consumer Discretionary,500000000
PTRA,Proterra Inc,Energy,200000000
PTVE,Pactiv Evergreen,Industrials,2000000000
PUBM,PubMatic Inc,Technology,700000000
PUMP,ProPetro Holding,Energy,700000000
PVBC,Provident Bancorp,Financial Services,200000000
PWFL,PowerFleet Inc,Technology,300000000
PWSC,PowerSchool Holdings,Technology,3000000000
PXLW,Pixelworks Inc,Technology,100000000
PYCR,Paycor HCM,Technology,5000000000
PYPD,PolyPid Ltd,Biotech,50000000
PYPL,PayPal Holdings,Financial Services,65000000000
QCOM,Qualcomm Inc,Technology,160000000000
QDEL,QuidelOrtho Corp,Healthcare,2000000000
QFIN,360 DigiTech,Financial Services,3000000000
QGEN,Qiagen NV,Healthcare,10000000000
QNRX,Quoin Pharmaceuticals,Biotech,50000000
QNST,QuinStreet Inc,Technology,500000000
QTRX,Quanterix Corporation,Healthcare,600000000
QTWO,Q2 Holdings,Technology,3000000000
QUBT,Quantum Computing Inc,Technology,500000000
RAPT,RAPT Therapeutics,Biotech,100000000
RARE,Ultragenyx Pharmaceutical,Biotech,3000000000
RCAT,Red Cat Holdings,Technology,200000000
RCFA,RCF Acquisition,Financial Services,100000000
RCKT,Rocket Pharmaceuticals,Biotech,1000000000
RCKY,Rocky Brands,Consumer Discretionary,300000000
RCUS,Arcus Biosciences,Biotech,800000000
RDVT,Red Violet Inc,Technology,300000000
REAL,The RealReal Inc,Consumer Discretionary,400000000
REAX,The Real Brokerage,Real Estate,500000000
REFI,Chicago Atlantic Real Estate,Real Estate,300000000
RELY,Remitly Global,Financial Services,3000000000
RENB,Renovacor Inc,Biotech,100000000
RENT,Rent the Runway,Consumer Discretionary,100000000
REPL,Replimune Group,Biotech,700000000
RETO,ReTo Eco-Solutions,Industrials,50000000
REXR,Rexford Industrial Realty,Real Estate,8000000000
RFAC,RF Acquisition Corp,Financial Services,100000000
RFIL,RF Industries,Technology,50000000
RGEN,Repligen Corporation,Healthcare,5000000000
RGLD,Royal Gold Inc,Energy,8000000000
RGLS,Regulus Therapeutics,Biotech,100000000
RGNX,REGENXBIO Inc,Biotech,500000000
RLAY,Relay Therapeutics,Biotech,700000000
RLMD,Relmada Therapeutics,Biotech,200000000
RLTY,Cohen & Steers Real Estate,Real Estate,400000000
RMNI,Rimini Street,Technology,300000000
RNAC,Cartesian Therapeutics,Biotech,700000000
RNER,Range Nuclear Renaissance,Energy,50000000
RNLX,Renalytix PLC,Healthcare,50000000
RNST,Renasant Corporation,Financial Services,1000000000
ROAD,Construction Partners,Industrials,2000000000
ROIV,Roivant Sciences,Biotech,5000000000
ROLV,Rolf Benz AG,Consumer Discretionary,100000000
RONI,Rice Acquisition Corp,Energy,200000000
ROSG,Rosslyn Data Technologies,Technology,50000000
ROST,Ross Stores,Consumer Discretionary,45000000000
ROVR,Rover Group,Consumer Discretionary,400000000
RPID,Rapid Medical,Healthcare,100000000
RPSNF,Repligen Corp,Healthcare,5000000000
RPTX,Repare Therapeutics,Biotech,300000000
RRAC,Rigel Rock Acquisition,Financial Services,100000000
RRBI,Red River Bancshares,Financial Services,300000000
RSVR,Reservoir Media,Consumer Discretionary,400000000
RTLX,Raitel Corp,Technology,50000000
RUBY,Rubius Therapeutics,Biotech,100000000
RVNC,Revance Therapeutics,Healthcare,700000000
RVPH,Revive Pharma,Biotech,50000000
RXRX,Recursion Pharmaceuticals,Biotech,2000000000
RYTM,Rhythm Pharmaceuticals,Biotech,3000000000
RZLT,Rezolve AI,Technology,200000000
SAFE,Safehold Inc,Real Estate,2000000000
SAIA,Saia Inc,Industrials,6000000000
SAMA,Schultze Special Purpose,Financial Services,100000000
SAMG,Silvercrest Asset Management,Financial Services,200000000
SANG,Sana Biotechnology,Biotech,500000000
SATS,EchoStar Corporation,Technology,2000000000
SBFM,Sunshine Biopharma,Biotech,50000000
SBLK,Star Bulk Carriers,Industrials,2000000000
SBSW,Sibanye Stillwater,Energy,2000000000
SCKT,Socket Mobile,Technology,50000000
SCNI,Scinai Immunotherapeutics,Biotech,50000000
SCVL,Shoe Carnival,Consumer Discretionary,500000000
SDGR,Schrödinger Inc,Technology,2000000000
SDIG,Stronghold Digital Mining,Energy,200000000
SELB,Selecta Biosciences,Biotech,100000000
SENS,Sensata Technologies,Technology,3000000000
SERA,Sera Prognostics,Healthcare,100000000
SERV,Serve Robotics,Technology,400000000
SFBC,Sound Financial Bancorp,Financial Services,100000000
SFNC,Simmons First National,Financial Services,2000000000
SGBX,Safe & Green Holdings,Industrials,50000000
SGHT,Sight Sciences,Healthcare,200000000
SGMO,Sangamo Therapeutics,Biotech,200000000
SGRY,Surgery Partners,Healthcare,1500000000
SHAK,Shake Shack,Consumer Discretionary,3000000000
SHCR,Sharecare Inc,Healthcare,400000000
SHLS,Shoals Technologies,Energy,1000000000
SIDU,Sidus Space,Technology,50000000
SIOX,Sio Gene Therapies,Biotech,50000000
SISY,Sisyphus Capital,Financial Services,50000000
SITM,SiTime Corporation,Technology,1000000000
SKIL,Skillsoft Corp,Technology,200000000
SKWD,Skyward Specialty Insurance,Financial Services,1500000000
SLDB,Solid Biosciences,Biotech,200000000
SLGN,Silgan Holdings,Industrials,3000000000
SLNK,Sterling Infrastructure,Industrials,2000000000
SLNO,Soleno Therapeutics,Biotech,700000000
SLQT,SelectQuote Inc,Financial Services,300000000
SLRX,Salarius Pharmaceuticals,Biotech,50000000
SMMT,Summit Therapeutics,Biotech,5000000000
SMPL,Simply Good Foods,Consumer Discretionary,2000000000
SMTC,Semtech Corporation,Technology,2000000000
SNAX,Stryve Foods,Consumer Discretionary,50000000
SNBR,Sleep Number Corp,Consumer Discretionary,300000000
SNCR,Synchronoss Technologies,Technology,100000000
SNCY,Sun Country Airlines,Industrials,700000000
SNEX,StoneX Group,Financial Services,2000000000
SNOW,Snowflake Inc,Technology,50000000000
SNPO,Snap One Holdings,Technology,400000000
SNPS,Synopsys Inc,Technology,80000000000
SNSE,Sensei Biotherapeutics,Biotech,50000000
SNTG,Sentage Holdings,Financial Services,50000000
SNTX,Sontus Biosciences,Biotech,50000000
SNYR,Synergy CHC Corp,Healthcare,50000000
SOBR,SOBR Safe Inc,Technology,50000000
SOCH,Society Pass,Consumer Discretionary,50000000
SOFO,Sonic Foundry,Technology,50000000
SOLY,Solitario Resources,Energy,50000000
SONM,Sonim Technologies,Technology,50000000
SOTK,Sono-Tek Corporation,Technology,50000000
SOWG,Sow Good Inc,Consumer Discretionary,50000000
SPGX,Sustainable Green Team,Industrials,50000000
SPHR,Sphere Entertainment,Consumer Discretionary,2000000000
SPIR,Spire Global,Technology,300000000
SPNT,SiriusPoint Ltd,Financial Services,1500000000
SPOK,Spok Holdings,Healthcare,300000000
SPRB,Spruce Biosciences,Biotech,100000000
SPRC,SciSparc Ltd,Biotech,50000000
SPRO,Spero Therapeutics,Biotech,100000000
SPRY,ARS Pharmaceuticals,Biotech,700000000
SPTK,SportsTek Acquisition,Financial Services,100000000
SPWH,Sportsman's Warehouse,Consumer Discretionary,200000000
SQSP,Squarespace Inc,Technology,6000000000
SRAD,Sportradar Group,Technology,5000000000
SRDX,Surmodics Inc,Healthcare,500000000
SRGA,Surgalign Holdings,Healthcare,50000000
SRPT,Sarepta Therapeutics,Biotech,10000000000
SRRK,Scholar Rock,Biotech,1500000000
SRTS,Sensus Healthcare,Healthcare,100000000
SSBI,Summit State Bancorp,Financial Services,100000000
SSBK,Southern States Bancshares,Financial Services,200000000
SSIC,Silver Spike Investment,Financial Services,100000000
SSII,SS Innovations,Technology,50000000
SSKN,Strata Skin Sciences,Healthcare,100000000
SSTI,ShotSpotter Inc,Technology,300000000
SSTK,Shutterstock Inc,Technology,1500000000
SSYS,Stratasys Ltd,Technology,800000000
STAA,STAAR Surgical,Healthcare,1500000000
STBA,S&T Bancorp,Financial Services,1200000000
STCN,Steel Connect,Industrials,100000000
STEM,Stem Inc,Energy,300000000
STEP,StepStone Group,Financial Services,4000000000
STGW,Stagwell Inc,Technology,1000000000
STLD,Steel Dynamics,Industrials,18000000000
STNE,StoneCo Ltd,Financial Services,3000000000
STOK,Stoke Therapeutics,Biotech,500000000
STRO,Sutro Biopharma,Biotech,200000000
STRR,Star Equity Holdings,Technology,50000000
STRW,Strawberry Fields REIT,Real Estate,200000000
STWO,Aeac Equity Partners,Financial Services,100000000
STXS,Stereotaxis Inc,Healthcare,200000000
SUMO,Sumo Logic,Technology,1000000000
SUNL,Sunlight Financial,Financial Services,100000000
SURG,SurgiLogix Inc,Healthcare,50000000
SVFD,Save Foods,Technology,50000000
SVNX,7GC & Co Holdings,Technology,100000000
SWAG,Wag Group,Consumer Discretionary,100000000
SWAV,ShockWave Medical,Healthcare,5000000000
SWKH,SWK Holdings,Financial Services,200000000
SWVL,Swvl Holdings,Technology,50000000
SXTC,China SXT Pharmaceuticals,Biotech,50000000
SYBX,Synlogic Inc,Biotech,50000000
SYBT,Stock Yards Bancorp,Financial Services,2000000000
SYRS,Syros Pharmaceuticals,Biotech,50000000
SYTA,Sievert Laryngoscope,Healthcare,50000000
TACT,TransAct Technologies,Technology,100000000
TALK,Talkspace,Healthcare,200000000
TALO,Talos Energy,Energy,1200000000
TBLA,Taboola.com,Technology,700000000
TBMC,Trailblazer Merger,Financial Services,100000000
TBNK,Territorial Bancorp,Financial Services,100000000
TBPH,Theravance Biopharma,Biotech,600000000
TCBIO,Texas Capital Bancshares,Financial Services,3000000000
TCMD,Tactile Systems Technology,Healthcare,300000000
TCOA,Trident Digital Tech,Technology,50000000
TCRX,TScan Therapeutics,Biotech,100000000
TCVA,TCV Acquisition,Financial Services,100000000
TDTH,Tastemaker Acquisition,Consumer Discretionary,100000000
TDUP,ThredUp Inc,Consumer Discretionary,200000000
TELA,TELA Bio,Healthcare,200000000
TELL,Tellurian Inc,Energy,300000000
TENB,Tenable Holdings,Technology,5000000000
TERN,Terns Pharmaceuticals,Biotech,500000000
TGEN,Tricida Inc,Biotech,50000000
TGTX,TG Therapeutics,Biotech,3000000000
THRM,Gentherm Inc,Consumer Discretionary,900000000
THTX,Theratechnologies Inc,Biotech,100000000
TIPT,Tiptree Inc,Financial Services,400000000
TITN,Titan Machinery,Industrials,400000000
TKNO,Alpha Teknova,Healthcare,100000000
TLPH,Talphera Inc,Biotech,50000000
TLRY,Tilray Brands,Consumer Discretionary,1000000000
TMCI,Treace Medical Concepts,Healthcare,500000000
TMDX,TransMedics Group,Healthcare,2500000000
TNON,Tenon Medical,Healthcare,50000000
TNYA,Tenaya Therapeutics,Biotech,100000000
TORC,Restorbio Inc,Biotech,50000000
TPIC,TPI Composites,Industrials,200000000
TPVG,TriplePoint Venture Growth,Financial Services,300000000
TPXGY,Tempur-Pedic International,Consumer Discretionary,5000000000
TRDA,Entrada Therapeutics,Biotech,500000000
TREE,LendingTree Inc,Financial Services,500000000
TRMR,Tremor International,Technology,300000000
TRNX,Taronis Fuels,Energy,50000000
TRTX,TPG RE Finance Trust,Real Estate,1000000000
TRVI,Trevi Therapeutics,Biotech,200000000
TRVN,Trevena Inc,Biotech,50000000
TSHA,Taysha Gene Therapies,Biotech,200000000
TSLA,Tesla Inc,Consumer Discretionary,800000000000
TTGT,TechTarget Inc,Technology,1500000000
TTMI,TTM Technologies,Technology,1500000000
TUSK,Mammoth Energy Services,Energy,100000000
TWKS,Thoughtworks Holding,Technology,1000000000
TWST,Twist Bioscience,Biotech,700000000
TXMD,TherapeuticsMD,Healthcare,100000000
TXRH,Texas Roadhouse,Consumer Discretionary,10000000000
TZPS,Topaz Energy,Energy,3000000000
UBCP,United Bancorp,Financial Services,200000000
UBFO,United Security Bancshares,Financial Services,100000000
UBSI,United Bankshares,Financial Services,4000000000
UCTT,Ultra Clean Holdings,Technology,1500000000
UHAL,U-Haul Holding,Industrials,8000000000
UKXMY,Unknown,Technology,100000000
ULCC,Frontier Group Holdings,Industrials,1000000000
ULTA,Ulta Beauty,Consumer Discretionary,18000000000
UMAC,Unusual Machines,Technology,100000000
UNFI,United Natural Foods,Consumer Discretionary,700000000
UNIT,Uniti Group,Real Estate,1000000000
UNTY,Unity Bancorp,Financial Services,300000000
UPBD,Upbound Group,Financial Services,1000000000
UPLD,Upland Software,Technology,200000000
UPWK,Upwork Inc,Technology,2000000000
URGN,UroGen Pharma,Biotech,500000000
USAU,U.S. Gold Corp,Energy,50000000
USEG,U.S. Energy Corp,Energy,50000000
USPH,U.S. Physical Therapy,Healthcare,700000000
UTHR,United Therapeutics,Biotech,12000000000
UTMD,Utah Medical Products,Healthcare,300000000
UTSI,UTStarcom Holdings,Technology,100000000
UVSP,Univest Financial,Financial Services,700000000
VALE,Vale SA,Energy,40000000000
VALN,Valneva SE,Biotech,300000000
VBTX,Veritex Community Bank,Financial Services,1200000000
VCNX,Vaccinex Inc,Biotech,50000000
VCYT,Veracyte Inc,Healthcare,2000000000
VECO,Veeco Instruments,Technology,1200000000
VERA,Vera Therapeutics,Biotech,1500000000
VERB,Verb Technology,Technology,50000000
VERI,Veritone Inc,Technology,200000000
VERO,Venus Medtech,Healthcare,200000000
VERV,Verve Therapeutics,Biotech,1000000000
VGAS,Verde Clean Fuels,Energy,100000000
VGFC,The Very Good Food,Consumer Discretionary,50000000
VIAV,Viavi Solutions,Technology,2000000000
VIGL,Vigil Neuroscience,Biotech,300000000
VIPS,Vipshop Holdings,Consumer Discretionary,8000000000
VIRC,Virco Manufacturing,Consumer Discretionary,100000000
VIRI,Virios Therapeutics,Biotech,50000000
VIRT,Virtu Financial,Financial Services,4000000000
VISN,VisionWave Technologies,Technology,50000000
VISP,Vivos Therapeutics,Healthcare,50000000
VIST,Vista Oil & Gas,Energy,700000000
VITL,Vital Farms,Consumer Discretionary,1500000000
VIVE,Viveve Medical,Healthcare,50000000
VLGEA,Village Super Market,Consumer Discretionary,300000000
VLNS,Valens Semiconductor,Technology,200000000
VLON,Vallon Pharmaceuticals,Biotech,50000000
VMEO,Vimeo Inc,Technology,800000000
VNDA,Vanda Pharmaceuticals,Biotech,300000000
VNET,VNET Group,Technology,1000000000
VNRX,VolitionRx,Healthcare,50000000
VNTG,Vintage Wine Estates,Consumer Discretionary,100000000
VONE,Vnet One,Technology,50000000
VOXR,Vox Royalty,Energy,100000000
VRAY,ViewRay Inc,Healthcare,100000000
VRCA,Verrica Pharmaceuticals,Biotech,100000000
VREX,Varex Imaging,Healthcare,700000000
VRRM,Verra Mobility,Technology,3000000000
VRSK,Verisk Analytics,Financial Services,35000000000
VRSN,VeriSign Inc,Technology,20000000000
VRTS,Virtus Investment Partners,Financial Services,1000000000
VRTV,Veritiv Corporation,Industrials,1000000000
VSCO,Victoria's Secret,Consumer Discretionary,1000000000
VSTO,Vista Outdoor,Consumer Discretionary,1500000000
VTGN,Vistagen Therapeutics,Biotech,200000000
VTRS,Viatris Inc,Healthcare,10000000000
VVOS,Vivos Therapeutics,Healthcare,50000000
VVPR,VivoPower International,Energy,50000000
VXRT,Vaxart Inc,Biotech,200000000
VYGR,Voyager Therapeutics,Biotech,500000000
VYNT,Vyant Bio,Biotech,50000000
WAVD,WaveDancer Inc,Technology,50000000
WAVS,Western Acquisition Ventures,Financial Services,50000000
WBX,Wallbox NV,Energy,300000000
WCLD,WisdomTree Cloud Computing,Technology,300000000
WDAY,Workday Inc,Technology,60000000000
WDFC,WD-40 Company,Consumer Discretionary,2000000000
WDSY,Windsy Corp,Technology,50000000
WEST,Westrock Coffee,Consumer Discretionary,300000000
WETG,WeTrade Group,Financial Services,50000000
WFCF,Where Food Comes From,Consumer Discretionary,50000000
WFRD,Weatherford International,Energy,3000000000
WGMI,Valkyrie Bitcoin Miners ETF,Technology,100000000
WGSWF,Westgold Resources,Energy,100000000
WHLR,Wheeler REIT,Real Estate,50000000
WIFI,Boingo Wireless,Technology,300000000
WIMI,WiMi Hologram Cloud,Technology,100000000
WINT,Windtree Therapeutics,Biotech,50000000
WISA,WiSA Technologies,Technology,50000000
WISH,ContextLogic Inc,Consumer Discretionary,100000000
WKME,WalkMe Ltd,Technology,700000000
WLDN,Willdan Group,Industrials,300000000
WLFC,Willis Lease Finance,Industrials,400000000
WLMS,Williams Industrial Services,Industrials,50000000
WLTW,Willis Towers Watson,Financial Services,20000000000
WLYB,John Wiley & Sons,Consumer Discretionary,2000000000
WNEB,Western New England Bancorp,Financial Services,200000000
WNNR,Anner Acquisition Corp,Financial Services,100000000
WOLF,Wolfspeed Inc,Technology,1500000000
WORX,SCWorx Corp,Technology,50000000
WPRT,Westport Fuel Systems,Energy,300000000
WRAP,Wrap Technologies,Technology,100000000
WRLD,World Acceptance Corp,Financial Services,500000000
WRTC,Wrap Technologies,Technology,100000000
WSBC,WesBanco Inc,Financial Services,1500000000
WSFS,WSFS Financial,Financial Services,2000000000
WTBA,West Bancorporation,Financial Services,300000000
WTFC,Wintrust Financial,Financial Services,7000000000
WTTR,Select Water Solutions,Energy,800000000
WULF,TeraWulf Inc,Technology,800000000
WVVI,Willamette Valley Vineyards,Consumer Discretionary,100000000
WVVIP,Willamette Valley Vineyards,Consumer Discretionary,100000000
WYND,Wyndham Hotels & Resorts,Consumer Discretionary,5000000000
XBIT,XBiotech Inc,Biotech,300000000
XCUR,Exicure Inc,Biotech,50000000
XELB,Xcel Brands,Consumer Discretionary,50000000
XENE,Xenon Pharmaceuticals,Biotech,2000000000
XERS,Xeris Biopharma,Biotech,200000000
XFIN,ExcelFin Acquisition,Financial Services,100000000
XFOR,X4 Pharmaceuticals,Biotech,100000000
XGTI,XG Technology,Technology,50000000
XHUN,Xhun Corp,Technology,50000000
XNCR,Xencor Inc,Biotech,1500000000
XOMA,XOMA Corporation,Biotech,200000000
XPDB,Power & Digital Infrastructure,Energy,100000000
XPEL,XPEL Inc,Consumer Discretionary,800000000
XPER,Xperi Inc,Technology,500000000
XPON,Expion360,Energy,50000000
XPOF,Xponential Fitness,Consumer Discretionary,400000000
XPRO,Expro Group Holdings,Energy,1000000000
XRAY,Dentsply Sirona,Healthcare,4000000000
XRTX,Xartis Corp,Technology,50000000
XTIA,XTI Aerospace,Industrials,50000000
XTLB,XTL Biopharmaceuticals,Biotech,50000000
XWEL,XWELL Inc,Consumer Discretionary,50000000
XXII,22nd Century Group,Consumer Discretionary,100000000
XYLO,Xylocore Corp,Technology,50000000
YEXT,Yext Inc,Technology,1000000000
YGTY,Youngevity International,Consumer Discretionary,50000000
YMAB,Y-mAbs Therapeutics,Biotech,500000000
YORW,York Water Company,Industrials,500000000
YOSH,Yoshiharu Global,Consumer Discretionary,50000000
YOTA,Yotta Acquisition,Financial Services,100000000
YOUN,Yours Truly Acquisition,Financial Services,100000000
ZETA,Zeta Global Holdings,Technology,3000000000
ZFOX,ZeroFox Holdings,Technology,200000000
ZGNX,Zogenix Inc,Biotech,500000000
ZION,Zions Bancorporation,Financial Services,7000000000
ZJYL,Jin Medical International,Healthcare,50000000
ZLAB,Zymeworks Inc,Biotech,1500000000
ZNTE,Zentalis Pharmaceuticals,Biotech,200000000
ZNTL,Zentalis Pharmaceuticals,Biotech,200000000
ZOOZ,ZOOZ Power,Energy,100000000
ZPET,Zoom Telephonics,Technology,50000000
ZPNL,Zipline International,Technology,100000000
ZPTA,Zapata Computing,Technology,50000000
ZSAN,Zosano Pharma,Biotech,50000000
ZTLK,Zetlek Corp,Technology,50000000
ZUMZ,Zumiez Inc,Consumer Discretionary,300000000
ZURA,Zura Bio,Biotech,300000000
ZVRA,Zevra Therapeutics,Biotech,200000000
ZWRK,Z-Work Acquisition,Financial Services,100000000
ZYME,Zymeworks Inc,Biotech,1500000000
ZYXI,Zynex Medical,Healthcare,300000000`;

const content = fs.readFileSync('src/lib/universe/tickers.ts', 'utf8');
const existingSet = new Set([...content.matchAll(/"([A-Z0-9.\-]+)"/g)].map(m => m[1]));

// Same-company duplicates to remove (keep the first/better one)
const skipTickers = new Set([
  'PWFL',   // = AIOT (PowerFleet)
  'WRTC',   // = WRAP (Wrap Technologies)
  'VVOS',   // = VISP (Vivos Therapeutics)
  'RPSNF',  // = RGEN (Repligen, OTC)
  'ZYME',   // = ZLAB (Zymeworks)
  'ZNTE',   // = ZNTL (Zentalis)
  'ARNA',   // = RCUS already in file (Arcus Biosciences)
]);

// Parse CSV and filter
const entries = csvData.split('\n').map(line => {
  const [ticker, name, sector] = line.split(',');
  return { ticker: ticker.trim(), name: name.trim(), sector: sector.trim() };
}).filter(e => !existingSet.has(e.ticker) && !skipTickers.has(e.ticker));

// Group by sector
const sectors = {};
for (const e of entries) {
  if (!sectors[e.sector]) sectors[e.sector] = [];
  sectors[e.sector].push(e);
}

// Sort sectors and generate output
const sectorOrder = ['Technology', 'Biotech', 'Healthcare', 'Financial Services', 'Consumer Discretionary', 'Industrials', 'Energy', 'Real Estate'];
let output = '\n  // ========== NEW ADDITIONS — BROAD UNIVERSE EXPANSION ==========\n';

for (const sector of sectorOrder) {
  if (!sectors[sector]) continue;
  const items = sectors[sector].sort((a, b) => a.ticker.localeCompare(b.ticker));
  output += `\n  // --- ${sector} ---\n`;
  for (const item of items) {
    const padding = ' '.repeat(Math.max(1, 7 - item.ticker.length));
    output += `  "${item.ticker}",${padding}// ${item.name}\n`;
  }
}

console.log('New tickers to add:', entries.length);
console.log('Skipped (same-company dupes):', [...skipTickers].join(', '));
console.log('---');
console.log(output);

// Write the output to a temp file for easy copy
fs.writeFileSync('scripts/_newTickers.txt', output);
fs.unlinkSync(__filename);
