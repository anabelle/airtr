import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import { fileURLToPath } from "node:url";
import AdmZip from "adm-zip";

const OPEN_FLIGHTS_URL =
  "https://raw.githubusercontent.com/jpatokal/openflights/master/data/airports.dat";
const OURAIRPORTS_AIRPORTS_URL =
  "https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/airports.csv";
const OURAIRPORTS_RUNWAYS_URL =
  "https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/runways.csv";
const WORLD_BANK_GDP_URL =
  "https://api.worldbank.org/v2/en/indicator/NY.GDP.PCAP.CD?downloadformat=csv";
const GEONAMES_CITIES_URL = "https://download.geonames.org/export/dump/cities15000.zip";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = path.resolve(SCRIPT_DIR, "..");
const DATA_DIR = path.join(SCRIPT_DIR, "data-cache");
const OPEN_FLIGHTS_FILE = path.join(DATA_DIR, "airports.dat");
const OURAIRPORTS_AIRPORTS_FILE = path.join(DATA_DIR, "ourairports-airports.csv");
const OURAIRPORTS_RUNWAYS_FILE = path.join(DATA_DIR, "ourairports-runways.csv");
const WORLD_BANK_ZIP = path.join(DATA_DIR, "worldbank-gdp.zip");
const GEONAMES_ZIP = path.join(DATA_DIR, "cities15000.zip");
const GEONAMES_TXT = path.join(DATA_DIR, "cities15000.txt");
const OUTPUT_DIR = path.join(PACKAGE_DIR, "src");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "airports.ts");

const ISO_COUNTRY_MAP = {
  Afghanistan: "AF",
  Albania: "AL",
  Algeria: "DZ",
  Andorra: "AD",
  Angola: "AO",
  AntiguaAndBarbuda: "AG",
  Argentina: "AR",
  Armenia: "AM",
  Australia: "AU",
  Austria: "AT",
  Azerbaijan: "AZ",
  Bahamas: "BS",
  Bahrain: "BH",
  Bangladesh: "BD",
  Barbados: "BB",
  Belarus: "BY",
  Belgium: "BE",
  Belize: "BZ",
  Benin: "BJ",
  Bhutan: "BT",
  Bolivia: "BO",
  BosniaAndHerzegovina: "BA",
  Botswana: "BW",
  Brazil: "BR",
  Brunei: "BN",
  Bulgaria: "BG",
  BurkinaFaso: "BF",
  Burundi: "BI",
  Cambodia: "KH",
  Cameroon: "CM",
  Canada: "CA",
  CapeVerde: "CV",
  CentralAfricanRepublic: "CF",
  Chad: "TD",
  Chile: "CL",
  China: "CN",
  Colombia: "CO",
  Comoros: "KM",
  Congo: "CG",
  CongoDemocraticRepublic: "CD",
  CostaRica: "CR",
  CoteDIvoire: "CI",
  Croatia: "HR",
  Cuba: "CU",
  Cyprus: "CY",
  CzechRepublic: "CZ",
  Denmark: "DK",
  Djibouti: "DJ",
  Dominica: "DM",
  DominicanRepublic: "DO",
  Ecuador: "EC",
  Egypt: "EG",
  ElSalvador: "SV",
  EquatorialGuinea: "GQ",
  Eritrea: "ER",
  Estonia: "EE",
  Eswatini: "SZ",
  Ethiopia: "ET",
  Fiji: "FJ",
  Finland: "FI",
  France: "FR",
  Gabon: "GA",
  Gambia: "GM",
  Georgia: "GE",
  Germany: "DE",
  Ghana: "GH",
  Greece: "GR",
  Grenada: "GD",
  Guatemala: "GT",
  Guinea: "GN",
  GuineaBissau: "GW",
  Guyana: "GY",
  Haiti: "HT",
  Honduras: "HN",
  Hungary: "HU",
  Iceland: "IS",
  India: "IN",
  Indonesia: "ID",
  Iran: "IR",
  Iraq: "IQ",
  Ireland: "IE",
  Israel: "IL",
  Italy: "IT",
  Jamaica: "JM",
  Japan: "JP",
  Jordan: "JO",
  Kazakhstan: "KZ",
  Kenya: "KE",
  Kiribati: "KI",
  Kuwait: "KW",
  Kyrgyzstan: "KG",
  Laos: "LA",
  Latvia: "LV",
  Lebanon: "LB",
  Lesotho: "LS",
  Liberia: "LR",
  Libya: "LY",
  Liechtenstein: "LI",
  Lithuania: "LT",
  Luxembourg: "LU",
  Madagascar: "MG",
  Malawi: "MW",
  Malaysia: "MY",
  Maldives: "MV",
  Mali: "ML",
  Malta: "MT",
  MarshallIslands: "MH",
  Mauritania: "MR",
  Mauritius: "MU",
  Mexico: "MX",
  Micronesia: "FM",
  Moldova: "MD",
  Monaco: "MC",
  Mongolia: "MN",
  Montenegro: "ME",
  Morocco: "MA",
  Mozambique: "MZ",
  Myanmar: "MM",
  Namibia: "NA",
  Nauru: "NR",
  Nepal: "NP",
  Netherlands: "NL",
  NewZealand: "NZ",
  Nicaragua: "NI",
  Niger: "NE",
  Nigeria: "NG",
  NorthKorea: "KP",
  NorthMacedonia: "MK",
  Norway: "NO",
  Oman: "OM",
  Pakistan: "PK",
  Palau: "PW",
  Panama: "PA",
  PapuaNewGuinea: "PG",
  Paraguay: "PY",
  Peru: "PE",
  Philippines: "PH",
  Poland: "PL",
  Portugal: "PT",
  Qatar: "QA",
  Romania: "RO",
  Russia: "RU",
  Rwanda: "RW",
  SaintKittsAndNevis: "KN",
  SaintLucia: "LC",
  SaintVincentAndTheGrenadines: "VC",
  Samoa: "WS",
  SanMarino: "SM",
  SaoTomeAndPrincipe: "ST",
  SaudiArabia: "SA",
  Senegal: "SN",
  Serbia: "RS",
  Seychelles: "SC",
  SierraLeone: "SL",
  Singapore: "SG",
  Slovakia: "SK",
  Slovenia: "SI",
  SolomonIslands: "SB",
  Somalia: "SO",
  SouthAfrica: "ZA",
  SouthKorea: "KR",
  SouthSudan: "SS",
  Spain: "ES",
  SriLanka: "LK",
  Sudan: "SD",
  Suriname: "SR",
  Sweden: "SE",
  Switzerland: "CH",
  Syria: "SY",
  Taiwan: "TW",
  Tajikistan: "TJ",
  Tanzania: "TZ",
  Thailand: "TH",
  TimorLeste: "TL",
  Togo: "TG",
  Tonga: "TO",
  TrinidadAndTobago: "TT",
  Tunisia: "TN",
  Turkey: "TR",
  Turkmenistan: "TM",
  Tuvalu: "TV",
  Uganda: "UG",
  Ukraine: "UA",
  UnitedArabEmirates: "AE",
  UnitedKingdom: "GB",
  UnitedStates: "US",
  Uruguay: "UY",
  Uzbekistan: "UZ",
  Vanuatu: "VU",
  VaticanCity: "VA",
  Venezuela: "VE",
  Vietnam: "VN",
  Yemen: "YE",
  Zambia: "ZM",
  Zimbabwe: "ZW",
  BahamasThe: "BS",
  GambiaThe: "GM",
  CongoRepublicOf: "CG",
  CongoDemocraticRepublicOf: "CD",
  BoliviaPlurinationalStateOf: "BO",
  VenezuelaBolivarianRepublicOf: "VE",
  IranIslamicRepublicOf: "IR",
  KoreaRepublicOf: "KR",
  KoreaDemocraticPeopleSRepublicOf: "KP",
  MoldovaRepublicOf: "MD",
  TanzaniaUnitedRepublicOf: "TZ",
  LaosPeoplesDemocraticRepublic: "LA",
  SyriaArabRepublic: "SY",
  RussianFederation: "RU",
  BruneiDarussalam: "BN",
  VietnamSocialistRepublicOf: "VN",
  UnitedStatesOfAmerica: "US",
  UnitedKingdomOfGreatBritainAndNorthernIreland: "GB",
  CaboVerde: "CV",
  Czechia: "CZ",
  CoteDIvoireIvoryCoast: "CI",
  EswatiniSwaziland: "SZ",
  MicronesiaFederatedStatesOf: "FM",
  NorthMacedoniaRepublicOf: "MK",
};

const BUSINESS_IATAS = new Set([
  "ATL",
  "PEK",
  "LHR",
  "HND",
  "DXB",
  "ORD",
  "DFW",
  "JFK",
  "CDG",
  "AMS",
  "FRA",
  "IST",
  "MAD",
  "BCN",
  "MUC",
  "ZRH",
  "VIE",
  "FCO",
  "CPH",
  "ARN",
  "HEL",
  "DUB",
  "MAN",
  "LGW",
  "BRU",
  "LIS",
  "OSL",
  "DME",
  "LED",
  "DOH",
  "AUH",
  "RUH",
  "JED",
  "SIN",
  "HKG",
  "ICN",
  "PVG",
  "CAN",
  "TPE",
  "BKK",
  "KUL",
  "CGK",
  "BOM",
  "DEL",
  "SYD",
  "MEL",
  "LAX",
  "SFO",
  "SEA",
  "DEN",
  "PHX",
  "LAS",
  "MSP",
  "DTW",
  "MIA",
  "MCO",
  "IAH",
  "EWR",
  "BOS",
  "DCA",
  "IAD",
  "YYZ",
  "YVR",
  "YUL",
  "MEX",
  "GRU",
  "GIG",
  "SCL",
  "LIM",
  "BOG",
  "EZE",
  "CPT",
  "JNB",
  "CAI",
  "NBO",
  "ADD",
]);

const SKI_IATAS = new Set([
  "GVA",
  "INN",
  "SZG",
  "ZRH",
  "MUC",
  "GNB",
  "LYS",
  "TRN",
  "MXP",
  "VCE",
  "SLC",
  "DEN",
  "ASE",
  "EGE",
  "JAC",
  "YYC",
  "YVR",
  "YXS",
  "UIO",
  "SCL",
]);

const BEACH_IATAS = new Set([
  "CUN",
  "PUJ",
  "NAS",
  "MBJ",
  "CZM",
  "AUA",
  "SJU",
  "HNL",
  "OGG",
  "LIR",
  "DPS",
  "SYD",
  "OOL",
  "BNE",
  "MIA",
  "FLL",
]);

const normalizeCountryName = (name) => name.replace(/[^A-Za-z]/g, "");

const ensureDir = (dir) => {
  fs.mkdirSync(dir, { recursive: true });
};

const downloadFile = (url, outputPath, maxRedirects = 10) =>
  new Promise((resolve, reject) => {
    if (maxRedirects <= 0) {
      reject(new Error(`Too many redirects for ${url}`));
      return;
    }
    const file = fs.createWriteStream(outputPath);
    const client = url.startsWith("https") ? https : http;
    client
      .get(url, (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          file.close();
          fs.unlinkSync(outputPath);
          const redirectUrl = res.headers.location.startsWith("/")
            ? new URL(res.headers.location, url).href
            : res.headers.location;
          downloadFile(redirectUrl, outputPath, maxRedirects - 1)
            .then(resolve)
            .catch(reject);
          return;
        }
        if (res.statusCode && res.statusCode >= 400) {
          file.close();
          fs.unlinkSync(outputPath);
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        res.pipe(file);
        file.on("finish", () => file.close(resolve));
      })
      .on("error", (err) => {
        file.close();
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        reject(err);
      });
  });

const readFile = (filePath) => fs.readFileSync(filePath, "utf8");

const parseCsvLine = (line) => {
  const parts = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      parts.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  parts.push(current);
  return parts;
};

const parseOpenFlights = (csv) => {
  const lines = csv.split("\n");
  const airports = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const parts = parseCsvLine(line);

    const type = parts[12];
    if (type !== "airport") continue;

    const iata = parts[4];
    if (!iata || iata === "\\N" || iata.length !== 3) continue;

    const lat = parseFloat(parts[6]);
    const lon = parseFloat(parts[7]);
    if (Number.isNaN(lat) || Number.isNaN(lon)) continue;

    const tz = parts[11] !== "\\N" ? parts[11] : "UTC";

    airports.push({
      id: parts[0],
      name: parts[1],
      city: parts[2],
      country: parts[3],
      iata,
      icao: parts[5] !== "\\N" ? parts[5] : "",
      latitude: lat,
      longitude: lon,
      altitude: Number.parseInt(parts[8], 10) || 0,
      timezone: tz,
    });
  }
  return airports;
};

const parseOurAirportsAirports = (csv) => {
  const lines = csv.split("\n").filter(Boolean);
  const header = parseCsvLine(lines[0]);
  const identIndex = header.indexOf("ident");
  const iataIndex = header.indexOf("iata_code");
  const gpsCodeIndex = header.indexOf("gps_code");

  const airportIdentByIata = new Map();
  const airportIdentByGpsCode = new Map();

  for (let i = 1; i < lines.length; i += 1) {
    const parts = parseCsvLine(lines[i]);
    const ident = parts[identIndex]?.trim();
    if (!ident) continue;

    const iata = parts[iataIndex]?.trim();
    if (iata && !airportIdentByIata.has(iata)) {
      airportIdentByIata.set(iata, ident);
    }

    const gpsCode = parts[gpsCodeIndex]?.trim();
    if (gpsCode && !airportIdentByGpsCode.has(gpsCode)) {
      airportIdentByGpsCode.set(gpsCode, ident);
    }
  }

  return { airportIdentByIata, airportIdentByGpsCode };
};

const parseOurAirportsRunways = (csv) => {
  const lines = csv.split("\n").filter(Boolean);
  const header = parseCsvLine(lines[0]);
  const airportIdentIndex = header.indexOf("airport_ident");
  const lengthFtIndex = header.indexOf("length_ft");

  const runwayLengthByAirportIdent = new Map();

  for (let i = 1; i < lines.length; i += 1) {
    const parts = parseCsvLine(lines[i]);
    const airportIdent = parts[airportIdentIndex]?.trim();
    const runwayLengthFt = Number.parseInt(parts[lengthFtIndex], 10);
    if (!airportIdent || Number.isNaN(runwayLengthFt)) continue;

    const existingLength = runwayLengthByAirportIdent.get(airportIdent) ?? 0;
    if (runwayLengthFt > existingLength) {
      runwayLengthByAirportIdent.set(airportIdent, runwayLengthFt);
    }
  }

  return runwayLengthByAirportIdent;
};

const findRunwayLengthFt = (
  airport,
  airportIdentByIata,
  airportIdentByGpsCode,
  runwayLengthByAirportIdent,
) => {
  if (airport.icao) {
    const directLength = runwayLengthByAirportIdent.get(airport.icao);
    if (directLength != null) return directLength;

    const gpsMappedIdent = airportIdentByGpsCode.get(airport.icao);
    if (gpsMappedIdent) {
      const gpsMappedLength = runwayLengthByAirportIdent.get(gpsMappedIdent);
      if (gpsMappedLength != null) return gpsMappedLength;
    }
  }

  const iataMappedIdent = airportIdentByIata.get(airport.iata);
  if (iataMappedIdent) {
    const iataMappedLength = runwayLengthByAirportIdent.get(iataMappedIdent);
    if (iataMappedLength != null) return iataMappedLength;
  }

  return null;
};

const formatScalar = (value) => {
  if (value === null) return "null";
  return typeof value === "string" ? JSON.stringify(value) : String(value);
};

const formatAirport = (airport) => `  {
    id: ${formatScalar(airport.id)},
    name: ${formatScalar(airport.name)},
    iata: ${formatScalar(airport.iata)},
    icao: ${formatScalar(airport.icao)},
    latitude: ${formatScalar(airport.latitude)},
    longitude: ${formatScalar(airport.longitude)},
    altitude: ${formatScalar(airport.altitude)},
    runwayLengthFt: ${formatScalar(airport.runwayLengthFt)},
    timezone: ${formatScalar(airport.timezone)},
    country: ${formatScalar(airport.country)},
    city: ${formatScalar(airport.city)},
    population: ${formatScalar(airport.population)},
    gdpPerCapita: ${formatScalar(airport.gdpPerCapita)},
    tags: [${airport.tags.map((tag) => JSON.stringify(tag)).join(", ")}],
  }`;

const formatAirportsFile = (airports) => `// auto-generated file
import type { Airport } from "@acars/core";

export const airports: Airport[] = [
${airports.map(formatAirport).join(",\n")}
];
`;

const parseWorldBankGdp = (zipPath) => {
  const zip = new AdmZip(zipPath);
  const entry = zip
    .getEntries()
    .find(
      (e) => e.entryName.startsWith("API_NY.GDP.PCAP.CD") && !e.entryName.startsWith("Metadata"),
    );
  if (!entry) {
    throw new Error("World Bank GDP CSV not found in zip");
  }
  const content = entry
    .getData()
    .toString("utf8")
    .replace(/^\uFEFF/, "")
    .replace(/\r/g, "");
  const lines = content.split("\n").filter(Boolean);
  const headerIndex = lines.findIndex((line) => {
    const cleaned = line.replace(/^"/, "").replace(/"/g, "");
    return cleaned.startsWith("Country Name");
  });
  if (headerIndex === -1) {
    throw new Error('Could not find header row ("Country Name") in World Bank CSV');
  }
  const header = lines[headerIndex].split(",");
  const yearColumns = header.slice(4).map((year) => year.replace(/"/g, "").trim());
  const yearIndices = yearColumns
    .map((year, idx) => ({ year: Number.parseInt(year, 10), idx: idx + 4 }))
    .filter((year) => !Number.isNaN(year.year));
  const latestYears = yearIndices.sort((a, b) => b.year - a.year);

  const gdpByIso = new Map();
  for (let i = headerIndex + 1; i < lines.length; i += 1) {
    const row = lines[i];
    if (!row.trim()) continue;
    const cols = row.split(",").map((col) => col.replace(/"/g, "").trim());
    const countryName = cols[0];
    const isoCode = cols[1];
    if (!isoCode || isoCode.length !== 3) continue;

    let value = null;
    for (const year of latestYears) {
      const raw = cols[year.idx];
      if (raw) {
        const parsed = Number.parseFloat(raw);
        if (!Number.isNaN(parsed)) {
          value = parsed;
          break;
        }
      }
    }

    if (value != null) {
      gdpByIso.set(isoCode, { value, countryName });
    }
  }

  return gdpByIso;
};

const parseGeoNames = (filePath) => {
  const lines = readFile(filePath).split("\n").filter(Boolean);
  const cities = [];
  for (const line of lines) {
    const parts = line.split("\t");
    if (parts.length < 15) continue;
    const name = parts[1];
    const lat = Number.parseFloat(parts[4]);
    const lon = Number.parseFloat(parts[5]);
    const countryCode = parts[8];
    const population = Number.parseInt(parts[14], 10) || 0;
    if (Number.isNaN(lat) || Number.isNaN(lon)) continue;
    cities.push({ name, lat, lon, countryCode, population });
  }
  return cities;
};

const toRadians = (value) => (value * Math.PI) / 180;
const haversineKm = (lat1, lon1, lat2, lon2) => {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
};

const findNearestCityPopulation = (airport, cityIndex) => {
  const candidates = cityIndex.get(airport.countryCode) || [];
  let best = null;
  for (const city of candidates) {
    const distance = haversineKm(airport.latitude, airport.longitude, city.lat, city.lon);
    if (distance > 100) continue;
    if (!best || city.population > best.population) {
      best = { ...city, distance };
    } else if (best && city.population === best.population && distance < best.distance) {
      best = { ...city, distance };
    }
  }
  return best ? best.population : null;
};

const classifyTags = (airport, population) => {
  const tags = [];
  if (SKI_IATAS.has(airport.iata) || (airport.altitude > 2500 && Math.abs(airport.latitude) > 35)) {
    tags.push("ski");
    return tags;
  }

  if (
    BEACH_IATAS.has(airport.iata) ||
    (Math.abs(airport.latitude) <= 30 && airport.altitude < 500)
  ) {
    tags.push("beach");
    return tags;
  }

  if (BUSINESS_IATAS.has(airport.iata) || population >= 2000000) {
    tags.push("business");
    return tags;
  }

  tags.push("general");
  return tags;
};

const buildCountryCode = (name) => {
  const normalized = normalizeCountryName(name);
  return ISO_COUNTRY_MAP[normalized] ?? null;
};

const toIso3 = (iso2) => {
  const map = {
    AF: "AFG",
    AL: "ALB",
    DZ: "DZA",
    AD: "AND",
    AO: "AGO",
    AG: "ATG",
    AR: "ARG",
    AM: "ARM",
    AU: "AUS",
    AT: "AUT",
    AZ: "AZE",
    BS: "BHS",
    BH: "BHR",
    BD: "BGD",
    BB: "BRB",
    BY: "BLR",
    BE: "BEL",
    BZ: "BLZ",
    BJ: "BEN",
    BT: "BTN",
    BO: "BOL",
    BA: "BIH",
    BW: "BWA",
    BR: "BRA",
    BN: "BRN",
    BG: "BGR",
    BF: "BFA",
    BI: "BDI",
    KH: "KHM",
    CM: "CMR",
    CA: "CAN",
    CV: "CPV",
    CF: "CAF",
    TD: "TCD",
    CL: "CHL",
    CN: "CHN",
    CO: "COL",
    KM: "COM",
    CG: "COG",
    CD: "COD",
    CR: "CRI",
    CI: "CIV",
    HR: "HRV",
    CU: "CUB",
    CY: "CYP",
    CZ: "CZE",
    DK: "DNK",
    DJ: "DJI",
    DM: "DMA",
    DO: "DOM",
    EC: "ECU",
    EG: "EGY",
    SV: "SLV",
    GQ: "GNQ",
    ER: "ERI",
    EE: "EST",
    SZ: "SWZ",
    ET: "ETH",
    FJ: "FJI",
    FI: "FIN",
    FR: "FRA",
    GA: "GAB",
    GM: "GMB",
    GE: "GEO",
    DE: "DEU",
    GH: "GHA",
    GR: "GRC",
    GD: "GRD",
    GT: "GTM",
    GN: "GIN",
    GW: "GNB",
    GY: "GUY",
    HT: "HTI",
    HN: "HND",
    HU: "HUN",
    IS: "ISL",
    IN: "IND",
    ID: "IDN",
    IR: "IRN",
    IQ: "IRQ",
    IE: "IRL",
    IL: "ISR",
    IT: "ITA",
    JM: "JAM",
    JP: "JPN",
    JO: "JOR",
    KZ: "KAZ",
    KE: "KEN",
    KI: "KIR",
    KW: "KWT",
    KG: "KGZ",
    LA: "LAO",
    LV: "LVA",
    LB: "LBN",
    LS: "LSO",
    LR: "LBR",
    LY: "LBY",
    LI: "LIE",
    LT: "LTU",
    LU: "LUX",
    MG: "MDG",
    MW: "MWI",
    MY: "MYS",
    MV: "MDV",
    ML: "MLI",
    MT: "MLT",
    MH: "MHL",
    MR: "MRT",
    MU: "MUS",
    MX: "MEX",
    FM: "FSM",
    MD: "MDA",
    MC: "MCO",
    MN: "MNG",
    ME: "MNE",
    MA: "MAR",
    MZ: "MOZ",
    MM: "MMR",
    NA: "NAM",
    NR: "NRU",
    NP: "NPL",
    NL: "NLD",
    NZ: "NZL",
    NI: "NIC",
    NE: "NER",
    NG: "NGA",
    KP: "PRK",
    MK: "MKD",
    NO: "NOR",
    OM: "OMN",
    PK: "PAK",
    PW: "PLW",
    PA: "PAN",
    PG: "PNG",
    PY: "PRY",
    PE: "PER",
    PH: "PHL",
    PL: "POL",
    PT: "PRT",
    QA: "QAT",
    RO: "ROU",
    RU: "RUS",
    RW: "RWA",
    KN: "KNA",
    LC: "LCA",
    VC: "VCT",
    WS: "WSM",
    SM: "SMR",
    ST: "STP",
    SA: "SAU",
    SN: "SEN",
    RS: "SRB",
    SC: "SYC",
    SL: "SLE",
    SG: "SGP",
    SK: "SVK",
    SI: "SVN",
    SB: "SLB",
    SO: "SOM",
    ZA: "ZAF",
    KR: "KOR",
    SS: "SSD",
    ES: "ESP",
    LK: "LKA",
    SD: "SDN",
    SR: "SUR",
    SE: "SWE",
    CH: "CHE",
    SY: "SYR",
    TW: "TWN",
    TJ: "TJK",
    TZ: "TZA",
    TH: "THA",
    TL: "TLS",
    TG: "TGO",
    TO: "TON",
    TT: "TTO",
    TN: "TUN",
    TR: "TUR",
    TM: "TKM",
    TV: "TUV",
    UG: "UGA",
    UA: "UKR",
    AE: "ARE",
    GB: "GBR",
    US: "USA",
    UY: "URY",
    UZ: "UZB",
    VU: "VUT",
    VA: "VAT",
    VE: "VEN",
    VN: "VNM",
    YE: "YEM",
    ZM: "ZMB",
    ZW: "ZWE",
  };
  return map[iso2] || null;
};

async function main() {
  ensureDir(DATA_DIR);

  if (!fs.existsSync(OPEN_FLIGHTS_FILE)) {
    console.log("Downloading OpenFlights airport data...");
    await downloadFile(OPEN_FLIGHTS_URL, OPEN_FLIGHTS_FILE);
  }

  if (!fs.existsSync(OURAIRPORTS_AIRPORTS_FILE)) {
    console.log("Downloading OurAirports airport data...");
    await downloadFile(OURAIRPORTS_AIRPORTS_URL, OURAIRPORTS_AIRPORTS_FILE);
  }

  if (!fs.existsSync(OURAIRPORTS_RUNWAYS_FILE)) {
    console.log("Downloading OurAirports runway data...");
    await downloadFile(OURAIRPORTS_RUNWAYS_URL, OURAIRPORTS_RUNWAYS_FILE);
  }

  if (!fs.existsSync(WORLD_BANK_ZIP)) {
    console.log("Downloading World Bank GDP per capita data...");
    await downloadFile(WORLD_BANK_GDP_URL, WORLD_BANK_ZIP);
  }

  if (!fs.existsSync(GEONAMES_ZIP)) {
    console.log("Downloading GeoNames cities15000 data...");
    await downloadFile(GEONAMES_CITIES_URL, GEONAMES_ZIP);
  }

  if (!fs.existsSync(GEONAMES_TXT)) {
    console.log("Extracting GeoNames data...");
    const zip = new AdmZip(GEONAMES_ZIP);
    const entry = zip.getEntry("cities15000.txt");
    if (!entry) throw new Error("cities15000.txt not found in GeoNames zip");
    fs.writeFileSync(GEONAMES_TXT, entry.getData());
  }

  const openFlightsCsv = readFile(OPEN_FLIGHTS_FILE);
  const ourAirportsCsv = readFile(OURAIRPORTS_AIRPORTS_FILE);
  const ourAirportsRunwaysCsv = readFile(OURAIRPORTS_RUNWAYS_FILE);
  const gdpByIso3 = parseWorldBankGdp(WORLD_BANK_ZIP);
  const cities = parseGeoNames(GEONAMES_TXT);
  const { airportIdentByIata, airportIdentByGpsCode } = parseOurAirportsAirports(ourAirportsCsv);
  const runwayLengthByAirportIdent = parseOurAirportsRunways(ourAirportsRunwaysCsv);

  const cityIndex = new Map();
  for (const city of cities) {
    const list = cityIndex.get(city.countryCode) || [];
    list.push(city);
    cityIndex.set(city.countryCode, list);
  }

  const rawAirports = parseOpenFlights(openFlightsCsv);
  const enriched = [];

  for (const airport of rawAirports) {
    const iso2 = buildCountryCode(airport.country);
    const iso3 = iso2 ? toIso3(iso2) : null;
    const gdp = iso3 ? gdpByIso3.get(iso3)?.value : null;
    const population = iso2
      ? findNearestCityPopulation({ ...airport, countryCode: iso2 }, cityIndex)
      : null;

    const airportPopulation = population ?? 250000;
    const airportGdp = gdp ?? 15000;

    const tags = classifyTags(
      { ...airport, iata: airport.iata, altitude: airport.altitude, latitude: airport.latitude },
      airportPopulation,
    );

    enriched.push({
      id: airport.id,
      name: airport.name,
      iata: airport.iata,
      icao: airport.icao,
      latitude: airport.latitude,
      longitude: airport.longitude,
      altitude: airport.altitude,
      runwayLengthFt: findRunwayLengthFt(
        airport,
        airportIdentByIata,
        airportIdentByGpsCode,
        runwayLengthByAirportIdent,
      ),
      timezone: airport.timezone,
      country: iso2 ?? "XX",
      city: airport.city,
      population: Math.round(airportPopulation),
      gdpPerCapita: Math.round(airportGdp),
      tags,
    });
  }

  console.log(`Parsed ${enriched.length} valid airports.`);

  const fileContent = formatAirportsFile(enriched);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, fileContent);
  console.log(`Successfully wrote ${OUTPUT_FILE}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
