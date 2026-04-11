export const SECTOR_MAP: Record<string, string> = {
  // Yahoo sector name → TradeCore sector name

  // Technology
  "Technology": "Technology",
  "Electronic Technology": "Technology",
  "Information Technology": "Technology",
  "Software": "Technology",
  "Semiconductors": "Technology",
  "Communication Services": "Technology",

  // Biotech
  "Biotechnology": "Biotech",
  "Pharmaceuticals": "Biotech",
  "Drug Manufacturers": "Biotech",
  "Biopharmaceuticals": "Biotech",

  // Healthcare
  "Healthcare": "Healthcare",
  "Health Care": "Healthcare",
  "Medical Devices": "Healthcare",
  "Medical Instruments": "Healthcare",
  "Health Services": "Healthcare",
  "Diagnostics & Research": "Healthcare",

  // Energy
  "Energy": "Energy",
  "Oil & Gas": "Energy",
  "Utilities": "Energy",
  "Renewable Energy": "Energy",

  // Financial Services
  "Financial Services": "Financial Services",
  "Finance": "Financial Services",
  "Banks": "Financial Services",
  "Insurance": "Financial Services",
  "Capital Markets": "Financial Services",
  "Asset Management": "Financial Services",

  // Consumer Discretionary
  "Consumer Cyclical": "Consumer Discretionary",
  "Consumer Discretionary": "Consumer Discretionary",
  "Retail": "Consumer Discretionary",
  "Restaurants": "Consumer Discretionary",
  "Travel & Leisure": "Consumer Discretionary",

  // Industrials
  "Industrials": "Industrials",
  "Aerospace & Defense": "Industrials",
  "Transportation": "Industrials",
  "Construction": "Industrials",
  "Manufacturing": "Industrials",

  // Real Estate
  "Real Estate": "Real Estate",
  "REIT": "Real Estate",
};

export function normaliseSector(yahooSector: string): string {
  if (!yahooSector) return "Unknown";

  // Direct match
  if (SECTOR_MAP[yahooSector]) return SECTOR_MAP[yahooSector]!;

  // Partial match — check if any key is contained
  const lower = yahooSector.toLowerCase();
  for (const [key, value] of Object.entries(SECTOR_MAP)) {
    if (lower.includes(key.toLowerCase())) return value;
  }

  return "Unknown";
}
