#!/usr/bin/env python3
"""Null out coordinates that obviously don't match the location text.

Why: ~43% of US-flagged accident rows have longitudes < 65°W absolute —
clearly wrong, the result of an upstream DMS/DDM decoder that lost the
high digit during ingest. "Atlanta, GA, United States" with lon=-8.7075
plots in the Gulf of Guinea, not Georgia.

This migration is intentionally a one-way nullify, not an attempt to
"fix" the broken value. We can't reliably reconstruct the lost digit
(was 84.4 truncated to 8.7? or to -84.7? both plausible). Showing
fewer-but-correct points is the right trade vs. showing many-but-
plotted-on-the-wrong-continent points; users have already noticed.

A follow-up migration can re-geocode broken rows from location text
using OpenFlights airports.dat (city → lat/lon lookup) — that's a
separate, larger change. This script just stops the bleeding.

Detection: location text contains a country/state hint, and lat/lon
sit outside that country's plausible bounding box. Country bboxes
include offshore territory (Alaska/Hawaii in the US, Sakhalin in
Russia) but stay tight enough to flag obvious wrongs.
"""
import re
import sqlite3
import sys

DB = sys.argv[1] if len(sys.argv) > 1 else "accidents.db.seed"

# (country regex matched against UPPER(location), lat range, lon range).
# Order matters: first match wins, so put state-suffix patterns ahead of
# generic "USA". Bboxes are inclusive, with a small margin for coastal
# accidents that happened just offshore.
RULES = [
    # USA — every row that ends in ", XX, United States" or "(YYY airport
    # in the US)" should plot in continental US, Alaska, Hawaii, or
    # nearby ocean. Lon range allows up to -180 (Aleutians) and +(-50)
    # (Maine) margin.
    (re.compile(r",\s*(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC|PR|VI|GU|AS),\s*UNITED STATES"),
     (16, 72), (-180, -50)),
    (re.compile(r"\b(UNITED STATES|USA)\b"), (16, 72), (-180, -50)),
    # Canada
    (re.compile(r"\bCANADA\b"), (40, 84), (-141, -50)),
    # Russia — straddles antimeridian, so lon goes (-180, -168) U (19, 180).
    (re.compile(r"\bRUSSIA\b"), (41, 82), (19, 180)),
    # Brazil
    (re.compile(r"\bBRAZIL\b"), (-34, 6), (-74, -34)),
    # Mexico
    (re.compile(r"\bMEXICO\b"), (14, 33), (-118, -86)),
    # France — mainland; Réunion / French Guiana excluded, but those
    # rarely land in the dataset under "France" anyway.
    (re.compile(r"\bFRANCE\b"), (41, 51.5), (-5.5, 10)),
    # Germany
    (re.compile(r"\bGERMANY\b"), (47, 56), (5, 16)),
    # United Kingdom
    (re.compile(r"\b(UNITED KINGDOM|UK\b|ENGLAND|SCOTLAND|WALES)"), (49, 61), (-9, 2)),
    # Australia
    (re.compile(r"\bAUSTRALIA\b"), (-44, -10), (112, 154)),
    # India
    (re.compile(r"\bINDIA\b"), (6, 36), (68, 98)),
    # China
    (re.compile(r"\bCHINA\b"), (18, 54), (73, 135)),
    # Japan
    (re.compile(r"\bJAPAN\b"), (24, 46), (122, 146)),
    # Argentina
    (re.compile(r"\bARGENTINA\b"), (-55, -21), (-74, -53)),
    # Italy
    (re.compile(r"\bITALY\b"), (35, 47), (6, 19)),
    # Spain
    (re.compile(r"\bSPAIN\b"), (27, 44), (-19, 5)),
    # Indonesia
    (re.compile(r"\bINDONESIA\b"), (-11, 6), (95, 141)),
]


def is_outside(lat: float, lon: float, lat_range, lon_range) -> bool:
    if lat is None or lon is None:
        return False
    if not (lat_range[0] <= lat <= lat_range[1]):
        return True
    if not (lon_range[0] <= lon <= lon_range[1]):
        return True
    return False


def main() -> None:
    conn = sqlite3.connect(DB)
    cur = conn.cursor()

    rows = cur.execute(
        """
        SELECT id, location, lat, lon
        FROM accidents
        WHERE lat IS NOT NULL AND lat != 0 AND lat != 0.000001
        """
    ).fetchall()
    print(f"[fix-coords] scanning {len(rows):,} geocoded rows…", file=sys.stderr)

    broken = []
    for rid, location, lat, lon in rows:
        if not location:
            continue
        upper = location.upper()
        for rx, lat_r, lon_r in RULES:
            if rx.search(upper):
                if is_outside(lat, lon, lat_r, lon_r):
                    broken.append(rid)
                break

    print(
        f"[fix-coords] {len(broken):,} rows have lat/lon outside their "
        f"location's plausible bbox — nulling.",
        file=sys.stderr,
    )

    if broken:
        # Batch update in chunks to keep the SQL parameter count reasonable.
        CHUNK = 500
        for i in range(0, len(broken), CHUNK):
            batch = broken[i : i + CHUNK]
            placeholders = ",".join("?" * len(batch))
            cur.execute(
                f"UPDATE accidents SET lat = NULL, lon = NULL WHERE id IN ({placeholders})",
                batch,
            )
    conn.commit()

    remaining = cur.execute(
        "SELECT COUNT(*) FROM accidents WHERE lat IS NOT NULL AND lat != 0 AND lat != 0.000001"
    ).fetchone()[0]
    print(f"[fix-coords] {remaining:,} accidents now plot on the map (was {len(rows):,}).", file=sys.stderr)

    conn.close()


if __name__ == "__main__":
    main()
