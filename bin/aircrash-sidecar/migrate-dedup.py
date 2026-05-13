#!/usr/bin/env python3
"""Cross-source duplicate suppression for the accidents table.

Why: Three upstream scrapers (ASN, B3A, NTSB CAROL, Wikidata) often ingest
the same physical incident from different source URLs. Example:

  2026-04-27 | CESSNA 208 | carol.ntsb.gov   | Jubasu, OF, Sudan | 14 dead
  2026-04-27 | Cessna 208B| aviation-safety.net | ~20km SW Juba   | 14 dead

Deleting rows is unsafe (breaks stable /accidents/:id detail URLs). Instead
we mark the LOSER row with dup_of_id = WINNER row id. Go list/map/stats
queries add WHERE dup_of_id IS NULL; the detail endpoint is unchanged.

Dedup key (four fields must all match):
  1. normalized_date   — ISO YYYY-MM-DD; skip rows with unparseable date
  2. CAST(fatalities AS INTEGER) — leading-digit parse; "15+2"→15, "Unknown"→0
  3. manufacturer_token — first space-separated word of aircraft_canonical, UPPER
  4. model_numeric_token — first all-digit substring of aircraft_canonical;
       skip rows with no digits (pure-text types like "Glider" are too risky)

Winner scoring (highest wins; ties → lower id wins):
  +10  operator_canonical is non-NULL and non-empty
  +5   source_url contains aviation-safety.net (richer descriptions);
       else +2 if source_url contains carol.ntsb.gov (mutually exclusive)
  +1   lat is not NULL and not 0 (geocoded)

Fully reversible: `UPDATE accidents SET dup_of_id = NULL` undoes everything.
The script does a full rebuild every run (reset → recompute) so it stays
deterministic regardless of previous state; ~29K rows takes <1s.
"""
import re
import sqlite3
import sys
from collections import defaultdict
from urllib.parse import urlparse

_DIGIT_RE = re.compile(r"\d+")
_LEADING_DIGITS = re.compile(r'^\s*(\d+)')


def _parse_fatalities(raw) -> int:
    """Parse fatalities to int, matching SQLite CAST(x AS INTEGER) semantics.

    Leading digits are parsed, trailing non-digit text is ignored.
    "15+2" → 15 (same as SQLite CAST), "Unknown" → 0, None → 0.
    """
    if raw is None:
        return 0
    m = _LEADING_DIGITS.match(str(raw))
    return int(m.group(1)) if m else 0


def _manufacturer_token(aircraft_canonical: str) -> str:
    """First space-separated word of aircraft_canonical, uppercased."""
    parts = aircraft_canonical.strip().split()
    return parts[0].upper() if parts else ""


def _model_numeric_token(aircraft_canonical: str) -> str:
    """First all-digit substring of aircraft_canonical, e.g. '737' from 'BOEING 737 800'."""
    m = _DIGIT_RE.search(aircraft_canonical)
    return m.group(0) if m else ""


def _score(row: dict) -> int:
    """Score a candidate row for winner selection (higher = preferred)."""
    s = 0
    op = row.get("operator_canonical") or ""
    if op.strip():
        s += 10
    # Hostname-based check (not substring) so a URL like
    # http://attacker.com/?ref=aviation-safety.net doesn't false-match.
    # urlparse returns '' for unparseable input, which is also safe.
    url = row.get("source_url") or ""
    try:
        host = (urlparse(url).hostname or "").lower()
    except (ValueError, TypeError):
        host = ""
    if host == "aviation-safety.net" or host.endswith(".aviation-safety.net"):
        s += 5
    elif host == "carol.ntsb.gov" or host.endswith(".carol.ntsb.gov"):
        s += 2
    lat = row.get("lat")
    if lat is not None and lat != 0:
        s += 1
    return s


def run_dedup(conn: sqlite3.Connection) -> tuple[int, int]:
    """Compute and apply dedup marks.

    Returns (groups_merged, rows_hidden).
    """
    cur = conn.cursor()

    # Sanity-check: if the DB is large but very few rows have aircraft_canonical
    # + an ISO date, migrate-canonical.py probably hasn't run yet.  We don't
    # abort — the migration is still valid, just potentially under-effective.
    total = cur.execute("SELECT COUNT(*) FROM accidents").fetchone()[0]
    candidates_count = cur.execute(
        """
        SELECT COUNT(*) FROM accidents
        WHERE  aircraft_canonical IS NOT NULL
          AND  aircraft_canonical != ''
          AND  normalized_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
        """
    ).fetchone()[0]
    if total > 1000 and candidates_count < total * 0.5:
        print(
            f"[migrate-dedup] WARN: only {candidates_count} of {total} rows have"
            " aircraft_canonical+ISO date — did migrate-canonical.py run?",
            file=sys.stderr,
        )

    # Fetch candidate rows: must have a canonical aircraft with a digit, and a
    # parseable ISO date.
    rows = cur.execute(
        """
        SELECT id, normalized_date, fatalities, aircraft_canonical,
               operator_canonical, source_url, lat
        FROM   accidents
        WHERE  aircraft_canonical IS NOT NULL
          AND  aircraft_canonical != ''
          AND  aircraft_canonical GLOB '*[0-9]*'
          AND  normalized_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
        """
    ).fetchall()

    # Group by the 4-tuple dedup key.
    groups: dict[tuple, list[dict]] = defaultdict(list)

    for row in rows:
        rid, norm_date, fatalities, aircraft_canonical, operator_canonical, source_url, lat = row

        mfr = _manufacturer_token(aircraft_canonical)
        num = _model_numeric_token(aircraft_canonical)

        if not mfr or not num:
            continue

        # Match SQLite CAST(x AS INTEGER): leading digits parsed, rest ignored.
        fat_int = _parse_fatalities(fatalities)

        key = (norm_date, fat_int, mfr, num)
        groups[key].append({
            "id": rid,
            "operator_canonical": operator_canonical,
            "source_url": source_url,
            "lat": lat,
        })

    # For each group of ≥2, pick winner, collect loser ids.
    loser_updates: list[tuple[int, int]] = []  # (winner_id, loser_id)
    groups_merged = 0

    for key, members in groups.items():
        if len(members) < 2:
            continue

        groups_merged += 1

        # Sort: descending score, then ascending id (lower id wins ties).
        scored = sorted(members, key=lambda r: (-_score(r), r["id"]))
        winner = scored[0]
        for loser in scored[1:]:
            loser_updates.append((winner["id"], loser["id"]))

    # Apply atomically: reset + mark losers in a single transaction so a
    # mid-run failure can never leave the DB in a partially-deduped state.
    with conn:
        conn.execute("UPDATE accidents SET dup_of_id = NULL")
        conn.executemany(
            "UPDATE accidents SET dup_of_id = ? WHERE id = ?",
            loser_updates,
        )

    return groups_merged, len(loser_updates)


def main() -> None:
    args = sys.argv[1:]

    if "--self-test" in args:
        _self_test()
        return

    if not args:
        print(
            "usage: migrate-dedup.py <db-path> [--self-test]",
            file=sys.stderr,
        )
        sys.exit(1)

    db_path = args[0]
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    # Idempotently add dup_of_id column.
    try:
        cur.execute("ALTER TABLE accidents ADD COLUMN dup_of_id INTEGER")
        print("[migrate-dedup] added dup_of_id column", file=sys.stderr)
    except sqlite3.OperationalError:
        # Column already exists — that's fine.
        pass

    groups_merged, rows_hidden = run_dedup(conn)

    # Index so Go's WHERE dup_of_id IS NULL doesn't scan the full table.
    cur.execute(
        "CREATE INDEX IF NOT EXISTS idx_accidents_dup_of_id ON accidents(dup_of_id)"
    )
    conn.commit()
    conn.close()

    print(
        f"[migrate-dedup] dedup: {groups_merged} groups merged, {rows_hidden} rows hidden"
    )


def _self_test() -> None:
    """In-memory smoke test.  Run as: python3 migrate-dedup.py --self-test"""

    conn = sqlite3.connect(":memory:")
    conn.execute(
        """
        CREATE TABLE accidents (
            id                 INTEGER PRIMARY KEY,
            normalized_date    TEXT,
            fatalities         TEXT,
            aircraft_canonical TEXT,
            operator_canonical TEXT,
            source_url         TEXT,
            lat                REAL,
            dup_of_id          INTEGER
        )
        """
    )

    # Rows used across all sub-tests.
    #
    # Basic 2-way merge (ids 1–4):
    #   id=1  NTSB version of Sudan crash — no operator, NTSB url      → LOSER
    #   id=2  ASN version  of Sudan crash — has operator, ASN url       → WINNER
    #   id=3  Different date, same aircraft                             → untouched
    #   id=4  Solo row — no duplicate possible                          → untouched
    #
    # 3-way merge (ids 5–7) — tie-break on id:
    #   id=5  ASN, no operator, no geo  (score=5)
    #   id=6  ASN, no operator, no geo  (score=5) — tied with id=5; lower id wins
    #   id=7  ASN, no operator, no geo  (score=5) — tied loser
    #
    # Pure-text aircraft (id=8) — no digits in aircraft_canonical → must NOT dedup.
    #
    # Unparseable date (id=9) — "xx Oct 2024" not an ISO date → must NOT dedup.
    #
    # "15+2" fatalities (ids 10–11):
    #   id=10  fatalities="15+2"  → parsed as 15, matches id=11
    #   id=11  fatalities="15"    → parsed as 15
    conn.executemany(
        "INSERT INTO accidents VALUES (?, ?, ?, ?, ?, ?, ?, NULL)",
        [
            # --- basic 2-way merge ---
            (1, "2026-04-27", "14", "CESSNA 208",               None,                   "https://carol.ntsb.gov/event/123",        None),
            (2, "2026-04-27", "14", "CESSNA 208B GRAND CARAVAN","CITYLINK AFRICA AIRWAYS","https://aviation-safety.net/wikibase/123",None),
            (3, "2024-01-15", "5",  "CESSNA 208",               "SOME OPERATOR",         "https://aviation-safety.net/wikibase/999",None),
            (4, "2025-03-01", "2",  "BOEING 737 800",           "TEST AIRLINE",          "https://aviation-safety.net/wikibase/777",None),
            # --- 3-way merge, all tied on score → lower id wins ---
            (5, "2023-06-10", "3",  "ATR 72 600",               None, "https://aviation-safety.net/wikibase/5", None),
            (6, "2023-06-10", "3",  "ATR 72 600",               None, "https://aviation-safety.net/wikibase/6", None),
            (7, "2023-06-10", "3",  "ATR 72 600",               None, "https://aviation-safety.net/wikibase/7", None),
            # --- pure-text aircraft — no digits → must be skipped ---
            (8, "2023-06-10", "0",  "GLIDER",                   None, "https://aviation-safety.net/wikibase/8", None),
            # --- unparseable date → must be skipped ---
            (9, "xx Oct 2024","2",  "CESSNA 172",               None, "https://aviation-safety.net/wikibase/9", None),
            # --- "15+2" fatalities must parse as 15 and match "15" ---
            (10,"2022-03-05","15+2","BOEING 737 800",            None, "https://carol.ntsb.gov/event/10",        None),
            (11,"2022-03-05","15",  "BOEING 737 MAX 8",          "SOME AIRLINE","https://aviation-safety.net/wikibase/11",None),
        ],
    )
    conn.commit()

    groups_merged, rows_hidden = run_dedup(conn)

    def dup(i):
        return conn.execute("SELECT dup_of_id FROM accidents WHERE id = ?", (i,)).fetchone()[0]

    # --- basic 2-way merge ---
    assert groups_merged >= 1, f"expected ≥1 group merged, got {groups_merged}"
    assert dup(1) == 2,  f"row 1 should be loser (dup_of_id=2), got {dup(1)}"
    assert dup(2) is None, f"row 2 should be winner (NULL), got {dup(2)}"
    assert dup(3) is None, f"row 3 unrelated, got {dup(3)}"
    assert dup(4) is None, f"row 4 solo, got {dup(4)}"

    # --- 3-way merge: id=5 wins (lowest id), 6 and 7 are losers ---
    assert dup(5) is None, f"row 5 should be 3-way winner (NULL), got {dup(5)}"
    assert dup(6) == 5,  f"row 6 should be loser (dup_of_id=5), got {dup(6)}"
    assert dup(7) == 5,  f"row 7 should be loser (dup_of_id=5), got {dup(7)}"

    # --- pure-text aircraft → not grouped ---
    assert dup(8) is None, f"row 8 (GLIDER, no digits) must be skipped, got {dup(8)}"

    # --- unparseable date → not grouped ---
    assert dup(9) is None, f"row 9 (xx Oct 2024) must be skipped, got {dup(9)}"

    # --- "15+2" == "15" → deduped ---
    # id=11 has operator+ASN → winner; id=10 NTSB no operator → loser
    assert dup(10) == 11, f"row 10 (15+2) should be loser (dup_of_id=11), got {dup(10)}"
    assert dup(11) is None, f"row 11 should be winner (NULL), got {dup(11)}"

    # groups_merged accounts for all three merged groups (basic + 3-way + 15+2)
    assert groups_merged == 3, f"expected 3 groups merged total, got {groups_merged}"
    assert rows_hidden == 4,   f"expected 4 rows hidden total (1+2+1), got {rows_hidden}"

    conn.close()
    print("[migrate-dedup] self-test PASSED")


if __name__ == "__main__":
    main()
