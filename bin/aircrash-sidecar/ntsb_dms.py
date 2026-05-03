#!/usr/bin/env python3
"""Correct DMS-string → decimal-degrees decoder for NTSB CAROL data.

Why this module exists: the original NTSB CAROL bulk import (commit
44697ce) decoded longitude with the same DDMMSS pattern as latitude, so
"0843853W" (which is DDDMMSS = 084°38'53"W = 84.6481°W) was parsed as
"08°43'85" → 8.7°W and dropped the row in the wrong continent. We
discovered this when ~13.8K rows plotted in the wrong country (PR #63).

NTSB CAROL coordinate format (per the avall.zip data dictionary, NTSB
Aviation Accident Database, "Aircraft" table):
  - latitude  : DDMMSS[NS]  — 6 digits + direction. Two for degrees.
  - longitude : DDDMMSS[EW] — **seven** digits + direction. Three for
                              degrees because longitudes range to 180°.

Both fields are zero-padded; "404059N" and "0741233W" mean the same
thing as "40°40'59\"N" and "74°12'33\"W". Some legacy rows write fewer
digits when the value is small; the decoder handles 5/6/7-char input
gracefully by inferring length-based degrees width.

Tested below — run `python3 ntsb_dms.py` to execute the self-test. CI
should call this if NTSB ingestion ever re-runs.
"""
from __future__ import annotations
import re

_LAT_RE = re.compile(r"^\s*(\d{4,6})\s*([NS])\s*$", re.IGNORECASE)
_LON_RE = re.compile(r"^\s*(\d{5,7})\s*([EW])\s*$", re.IGNORECASE)


def decode_lat(s: str) -> float | None:
    """NTSB latitude string → decimal degrees, or None on parse failure.

    Accepts DDMMSS[NS] (6 digits) and shorter pads. Returns negative for
    southern hemisphere.
    """
    if not isinstance(s, str):
        return None
    m = _LAT_RE.match(s)
    if not m:
        return None
    digits, direction = m.group(1).zfill(6), m.group(2).upper()
    deg = int(digits[0:2])
    minutes = int(digits[2:4])
    seconds = int(digits[4:6])
    if minutes >= 60 or seconds >= 60 or deg > 90:
        return None
    val = deg + minutes / 60 + seconds / 3600
    return -val if direction == "S" else val


def decode_lon(s: str) -> float | None:
    """NTSB longitude string → decimal degrees, or None on parse failure.

    Accepts DDDMMSS[EW] (7 digits) and shorter pads. Returns negative
    for western hemisphere. **Crucial**: degrees field is THREE digits
    wide, not two — confusing this with the latitude shape was the
    original bug that misplaced ~13K accident markers worldwide.
    """
    if not isinstance(s, str):
        return None
    m = _LON_RE.match(s)
    if not m:
        return None
    digits, direction = m.group(1).zfill(7), m.group(2).upper()
    deg = int(digits[0:3])
    minutes = int(digits[3:5])
    seconds = int(digits[5:7])
    if minutes >= 60 or seconds >= 60 or deg > 180:
        return None
    val = deg + minutes / 60 + seconds / 3600
    return -val if direction == "W" else val


# ─── self-test ───────────────────────────────────────────────────────
def _test() -> None:
    cases = [
        # (input,                expected_lat_or_lon, kind)
        # — Atlanta, GA roughly 33°45'N 84°23'W —
        ("334458N",  decode_lat, 33.7494),
        ("0842348W", decode_lon, -84.3967),
        # — JFK airport ~40°38'23"N 73°46'44"W —
        ("403823N",  decode_lat, 40.6397),
        ("0734644W", decode_lon, -73.7789),
        # — Sydney, Australia ~33°56'S 151°10'E —
        ("335633S",  decode_lat, -33.9425),
        ("1511014E", decode_lon, 151.1706),
        # — Equator / prime meridian edge cases —
        ("000000N",  decode_lat, 0.0),
        ("0000000E", decode_lon, 0.0),
        # — Short / unpadded input —
        ("33458N",   decode_lat, 3.5828),    # 03°34'58"N
        ("84238W",   decode_lon, -8.7106),   # 008°42'38"W (negative — west)
        # — Garbage —
        ("abcde",    decode_lat, None),
        ("",         decode_lon, None),
        ("999999N",  decode_lat, None),      # minutes/seconds out of range
        # — The historic bug: this would have given ~8.71°W; correct is ~84.65°W —
        ("0843853W", decode_lon, -84.6481),
    ]
    failed = 0
    for s, fn, want in cases:
        got = fn(s)
        ok = got is None and want is None
        if got is not None and want is not None:
            ok = abs(got - want) < 0.01
        flag = "OK " if ok else "FAIL"
        print(f"  [{flag}] {fn.__name__}({s!r:14}) = {got!r:>10}   want {want!r}")
        if not ok:
            failed += 1
    if failed:
        raise SystemExit(f"\n{failed} failures")
    print(f"\nAll {len(cases)} cases pass.")


if __name__ == "__main__":
    _test()
