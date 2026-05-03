#!/usr/bin/env python3
"""Add aircraft_category column to accidents table and classify each row.

Categories (broad-strokes — NTSB free-text aircraft_model is inconsistent):
  - wide-body   : long-haul jets w/ ≥2 aisles (Boeing 747/767/777/787, Airbus A300/A310/A330/A340/A350/A380, MD-11)
  - narrow-body : single-aisle jets (Boeing 737/717/757/MD-8x/9x, Airbus A220/A318/A319/A320/A321)
  - regional    : regional jets (Embraer ERJ/E-Jets, Bombardier CRJ, Sukhoi Superjet)
  - turboprop   : commercial turboprops (ATR, Q400/Dash-8, Saab, ATR, Beechcraft 1900/B200, Jetstream)
  - helicopter  : rotorcraft
  - ga          : general aviation (Cessna 1xx/2xx, Piper, Beechcraft Bonanza/Baron, Cirrus, etc.)
  - other       : military, gliders, balloons, ultralights, anything unmatched

Heuristic order matters — wide-body match fires before narrow-body so a row
like "BOEING 747-200" (which would match `BOEING 7\\d\\d` in narrow) wins
the wide bucket. GA is the catch-all for piston singles before "other".
"""
import re
import sqlite3
import sys

DB = sys.argv[1] if len(sys.argv) > 1 else "accidents.db.seed"

WIDE = re.compile(
    r"\b("
    r"747|767|777|787|"                         # Boeing
    r"A?300|A?310|A?330|A?340|A?350|A?380|"     # Airbus (incl. bare "300")
    r"MD-?11|MD11|"                             # McDonnell Douglas
    r"DC-?10|DC10|L-?1011|"                     # legacy wide-bodies
    r"IL-?96|IL96"                              # Ilyushin
    r")\b",
    re.IGNORECASE,
)

NARROW = re.compile(
    r"\b("
    r"737|717|757|727|707|"                     # Boeing
    r"A?220|A?318|A?319|A?320|A?321|"           # Airbus narrow
    r"MD-?8\d|MD-?9\d|MD8\d|MD9\d|"             # MD-80/90 family
    r"DC-?9|DC9|"                               # DC-9
    r"BAC[\s-]?1-?11|BAC111|"                   # BAC 1-11
    r"TU-?134|TU-?154|TU-?204|TU-?214|"         # Tupolev narrow jets
    r"YAK-?42|"                                 # Yak-42
    r"COMAC C919|C[\s-]?919"
    r")\b",
    re.IGNORECASE,
)

REGIONAL = re.compile(
    r"\b("
    r"ERJ-?\d+|EMB-?1[0-9]\d|EMBRAER 1[0-9]\d|E1[0-9]\d|E-?JET|"
    r"CRJ-?\d+|CRJ\d+|CL-?600|CL600|"
    r"DORNIER 328|DO[\s-]?328|"
    r"AVRO RJ|"
    r"FOKKER 70|FOKKER 100|F[\s-]?28|F-?70|F-?100|"
    r"SUKHOI SUPERJET|SSJ-?100|"
    r"AN-?148|AN148|AN-?158|"
    r"ARJ21|ARJ-?21"
    r")\b",
    re.IGNORECASE,
)

TURBOPROP = re.compile(
    r"\b("
    r"ATR[\s-]?\d|"
    r"DASH[\s-]?8|DHC-?8|Q[\s-]?100|Q[\s-]?200|Q[\s-]?300|Q[\s-]?400|"
    r"DHC-?6|DHC-?7|DHC-?2|DHC-?3|TWIN OTTER|"
    r"SAAB 340|SAAB 2000|SAAB-?340|SAAB-?2000|"
    r"JETSTREAM|BAE 31|BAE J|"
    r"BEECHCRAFT 1900|BE-?1900|"
    r"BEECHCRAFT B200|KING AIR|"
    r"FAIRCHILD METRO|SA227|SA-227|METRO III|METROLINER|"
    r"SHORTS 360|SHORTS 330|SD3-?60|"
    r"FOKKER 27|F-?27|FOKKER 50|F-?50|"
    r"LET 410|L-?410|"
    r"AN-?24|AN-?26|AN-?32|"
    r"IL-?18|IL18|"
    r"CASA 212|C[\s-]?212"
    r")\b",
    re.IGNORECASE,
)

HELICOPTER = re.compile(
    r"("
    r"HELICOPTER|"
    r"\bBELL[\s-]?[12-9]\d{2}|"                 # BELL 206/206B/407/etc.
    r"\bAGUSTA|\bAW1[0-9]\d|"                   # Agusta/Westland AW139/AW119
    r"\bA109|\bA119|\bA139|\bA169|\bA189|"
    r"\bEUROCOPTER|\bEC-?\d+|"
    r"\bAIRBUS HELICOPTERS|"
    r"\bAS[\s-]?\d{3}|"                         # Aerospatiale AS350/AS355
    r"\bSIKORSKY|\bS-?\d{2,}[A-Z]?\b|"
    r"\bROBINSON|\bR-?22|\bR-?44|\bR-?66|"
    r"\bMD HELICOPTER|\bMD[\s-]?5\d\d|\bMD[\s-]?6\d\d|\bMD[\s-]?9\d\d|"
    r"\bMI-?\d+|"
    r"\bKAMOV|\bKA-?\d+|"
    r"\bSCHWEIZER|"
    r"\bHUGHES \d{3}|"
    r"\bROTORWAY|\bROTORCRAFT"
    r")",
    re.IGNORECASE,
)

GA = re.compile(
    r"("
    r"\bCESSNA|"
    r"\bPIPER|\bPA-?\d+|"
    r"\bBEECHCRAFT|\bBEECH\b|\bBONANZA|\bDEBONAIR|\bMUSKETEER|\bSUNDOWNER|\bBARON|\bSIERRA\b|"
    r"\bCIRRUS|\bSR2[02]|\bSR-?2[02]|"
    r"\bMOONEY|"
    r"\bDIAMOND DA|\bDA-?\d+|"
    r"\bGRUMMAN AA|\bGRUMMAN G-?\d+|"
    r"\bGLASAIR|\bVAN'?S RV|\bRV-?\d+|"
    r"\bAERONCA|\bTAYLORCRAFT|\bLUSCOMBE|\bSTINSON|"
    r"\bMAULE|\bBELLANCA|"
    r"\bHUSKY|\bAVIAT|"
    r"\bAMERICAN CHAMPION|\bCITABRIA|\bDECATHLON|"
    r"\bAIR TRACTOR|\bAT-?\d{3}|"                 # ag/utility singles
    r"\bSWEARINGEN|\bSA226|\bSA227|\bMETRO\b|"
    r"\bLEARJET|\bLJ-?\d+|"                       # bizjets bucketed as GA
    r"\bGULFSTREAM|\bG-?[IVX]+\b|"
    r"\bHAWKER|\bBA[CE] [BCDH]?[1-9]\d{2}|"
    r"\bDASSAULT|\bFALCON \d|"
    r"\bCHAMPION 7|\bCHAMP\b|"
    r"\bAERO COMMANDER|\bROCKWELL COMMANDER|"
    r"\bANTONOV AN-?2|\bAN-?2[A-Z]?\b"            # An-2 utility biplane
    r")",
    re.IGNORECASE,
)


def classify(model: str) -> str:
    if not model:
        return "other"
    m = model.strip()
    if HELICOPTER.search(m):
        return "helicopter"
    if WIDE.search(m):
        return "wide-body"
    if REGIONAL.search(m):
        return "regional"
    if TURBOPROP.search(m):
        return "turboprop"
    if NARROW.search(m):
        return "narrow-body"
    if GA.search(m):
        return "ga"
    return "other"


def main() -> None:
    conn = sqlite3.connect(DB)
    cur = conn.cursor()

    cols = {row[1] for row in cur.execute("PRAGMA table_info(accidents)")}
    if "aircraft_category" not in cols:
        cur.execute("ALTER TABLE accidents ADD COLUMN aircraft_category TEXT")
        print("[migrate-category] added aircraft_category column", file=sys.stderr)

    rows = cur.execute("SELECT id, aircraft_model FROM accidents").fetchall()
    print(f"[migrate-category] classifying {len(rows)} rows…", file=sys.stderr)

    counts: dict[str, int] = {}
    updates = []
    for rid, model in rows:
        cat = classify(model or "")
        updates.append((cat, rid))
        counts[cat] = counts.get(cat, 0) + 1

    cur.executemany("UPDATE accidents SET aircraft_category = ? WHERE id = ?", updates)
    cur.execute(
        "CREATE INDEX IF NOT EXISTS idx_accidents_category ON accidents(aircraft_category)"
    )
    cur.execute(
        "CREATE INDEX IF NOT EXISTS idx_accidents_operator ON accidents(operator)"
    )
    conn.commit()
    conn.close()

    print("\n[migrate-category] distribution:", file=sys.stderr)
    for cat, n in sorted(counts.items(), key=lambda kv: -kv[1]):
        print(f"  {cat:12s} {n:>7,}", file=sys.stderr)


if __name__ == "__main__":
    main()
