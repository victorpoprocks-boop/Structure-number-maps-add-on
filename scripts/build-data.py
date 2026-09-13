#!/usr/bin/env python3
"""
Build Illinois bridges.json.

Default (recommended): IDOT GIST2 statewide structures via build-data-idot.py
Legacy NBI-only rebuild remains available with --nbi-only.
"""

from __future__ import annotations

import argparse
import runpy
import sys
from pathlib import Path

# Re-export NBI helpers for any callers that import this module.
from pathlib import Path as _Path

_HERE = _Path(__file__).resolve().parent


def main() -> int:
    # Intercept --nbi-only before delegating; otherwise forward all args to IDOT builder.
    if "--nbi-only" in sys.argv:
        sys.argv = [a for a in sys.argv if a != "--nbi-only"]
        # Run the historical NBI-only implementation inlined below via legacy path.
        return run_nbi_only()

    idot = _HERE / "build-data-idot.py"
    # Replace argv[0] so argparse help text shows the IDOT script name cleanly.
    sys.argv[0] = str(idot)
    runpy.run_path(str(idot), run_name="__main__")
    return 0


def run_nbi_only() -> int:
    """Legacy FHWA NBI-only builder (kept for comparison / fallback)."""
    import csv
    import gzip
    import json
    import re
    import urllib.request
    from datetime import datetime, timezone

    DEFAULT_URL = "https://www.fhwa.dot.gov/bridge/nbi/2025/delimited/IL25.txt"
    DEFAULT_YEAR = "2025"

    IL_FIPS_COUNTIES = {
        "001": "Adams", "003": "Alexander", "005": "Bond", "007": "Boone",
        "009": "Brown", "011": "Bureau", "013": "Calhoun", "015": "Carroll",
        "017": "Cass", "019": "Champaign", "021": "Christian", "023": "Clark",
        "025": "Clay", "027": "Clinton", "029": "Coles", "031": "Cook",
        "033": "Crawford", "035": "Cumberland", "037": "DeKalb", "039": "DeWitt",
        "041": "Douglas", "043": "DuPage", "045": "Edgar", "047": "Edwards",
        "049": "Effingham", "051": "Fayette", "053": "Ford", "055": "Franklin",
        "057": "Fulton", "059": "Gallatin", "061": "Greene", "063": "Grundy",
        "065": "Hamilton", "067": "Hancock", "069": "Hardin", "071": "Henderson",
        "073": "Henry", "075": "Iroquois", "077": "Jackson", "079": "Jasper",
        "081": "Jefferson", "083": "Jersey", "085": "Jo Daviess", "087": "Johnson",
        "089": "Kane", "091": "Kankakee", "093": "Kendall", "095": "Knox",
        "097": "Lake", "099": "LaSalle", "101": "Lawrence", "103": "Lee",
        "105": "Livingston", "107": "Logan", "109": "McDonough", "111": "McHenry",
        "113": "McLean", "115": "Macon", "117": "Macoupin", "119": "Madison",
        "121": "Marion", "123": "Marshall", "125": "Mason", "127": "Massac",
        "129": "Menard", "131": "Mercer", "133": "Monroe", "135": "Montgomery",
        "137": "Morgan", "139": "Moultrie", "141": "Ogle", "143": "Peoria",
        "145": "Perry", "147": "Piatt", "149": "Pike", "151": "Pope",
        "153": "Pulaski", "155": "Putnam", "157": "Randolph", "159": "Richland",
        "161": "Rock Island", "163": "St. Clair", "165": "Saline", "167": "Sangamon",
        "169": "Schuyler", "171": "Scott", "173": "Shelby", "175": "Stark",
        "177": "Stephenson", "179": "Tazewell", "181": "Union", "183": "Vermilion",
        "185": "Wabash", "187": "Warren", "189": "Washington", "191": "Wayne",
        "193": "White", "195": "Whiteside", "197": "Will", "199": "Williamson",
        "201": "Winnebago", "203": "Woodford",
    }

    def nbi_dms_to_decimal(lat_s, lon_s):
        lat_s = (lat_s or "").strip()
        lon_s = (lon_s or "").strip()
        if not lat_s or not lon_s or set(lat_s) <= {"0"} or set(lon_s) <= {"0"}:
            return None, None
        try:
            lat_s = lat_s.zfill(8)
            lon_s = lon_s.zfill(9)
            lat = int(lat_s[0:2]) + int(lat_s[2:4]) / 60 + (int(lat_s[4:6]) + int(lat_s[6:8]) / 100) / 3600
            lon = int(lon_s[0:3]) + int(lon_s[3:5]) / 60 + (int(lon_s[5:7]) + int(lon_s[7:9]) / 100) / 3600
            lon = -lon
            if not (36.0 <= lat <= 44.0 and -93.5 <= lon <= -85.5):
                return None, None
            return round(lat, 6), round(lon, 6)
        except (ValueError, IndexError):
            return None, None

    def clean_text(value):
        if not value:
            return ""
        return value.strip().strip("'").strip().replace('"', "")

    def display_structure_number(raw):
        s = raw.strip()
        if not s:
            return s
        if "-" in s:
            return s
        if re.fullmatch(r"\d{15}", s):
            rest4 = s[3:7]
            rest_extra = s[7:].rstrip("0")
            rest = rest4 + rest_extra if rest_extra else rest4
            return f"{s[:3]}-{rest}"
        return s

    def normalize_key(sn):
        return re.sub(r"\D", "", sn)

    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description="Build IL bridges.json from FHWA NBI only")
    parser.add_argument("--url", default=DEFAULT_URL)
    parser.add_argument("--year", default=DEFAULT_YEAR)
    parser.add_argument("--raw", type=Path, default=root / "raw" / "IL25.txt")
    parser.add_argument("--out", type=Path, default=root / "data" / "bridges.json")
    parser.add_argument("--skip-download", action="store_true")
    args = parser.parse_args()

    if not args.skip_download or not args.raw.exists():
        print(f"Downloading {args.url} ...")
        req = urllib.request.Request(args.url, headers={"User-Agent": "il-bridge-maps-addon/1.1"})
        with urllib.request.urlopen(req, timeout=180) as resp, open(args.raw, "wb") as out:
            while True:
                chunk = resp.read(1024 * 256)
                if not chunk:
                    break
                out.write(chunk)
        print(f"Saved {args.raw}")
    else:
        print(f"Using existing {args.raw}")

    bridges = {}
    skipped_coords = 0
    skipped_dup = 0
    with open(args.raw, newline="", encoding="utf-8", errors="replace") as f:
        reader = csv.DictReader(f, quotechar="'")
        for row in reader:
            raw_sn = row.get("STRUCTURE_NUMBER_008", "")
            sn = display_structure_number(raw_sn)
            lat, lon = nbi_dms_to_decimal(row.get("LAT_016", ""), row.get("LONG_017", ""))
            if lat is None or lon is None:
                skipped_coords += 1
                continue
            if sn in bridges:
                skipped_dup += 1
                continue
            county_fips = (row.get("COUNTY_CODE_003") or "").strip().zfill(3)
            bridges[sn] = {
                "lat": lat,
                "lon": lon,
                "carried": clean_text(row.get("FACILITY_CARRIED_007")),
                "crossed": clean_text(row.get("FEATURES_DESC_006A")),
                "county": county_fips,
                "loc": clean_text(row.get("LOCATION_009")),
                "raw": raw_sn.strip(),
            }

    index = {}
    for sn in bridges:
        nk = normalize_key(sn)
        if nk:
            index[nk] = sn
        nk2 = nk.lstrip("0")
        if nk2 and nk2 not in index:
            index[nk2] = sn

    payload = {
        "meta": {
            "state": "IL",
            "source": "FHWA National Bridge Inventory (NBI) ASCII delimited — Illinois (legacy nbi-only)",
            "sourceUrl": args.url,
            "sourceYear": args.year,
            "formatDoc": "https://www.fhwa.dot.gov/bridge/nbi/format.cfm",
            "builtAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "bridgeCount": len(bridges),
            "skippedNoCoords": skipped_coords,
            "skippedDuplicates": skipped_dup,
            "notes": "Legacy NBI-only build. Prefer scripts/build-data-idot.py for full IDOT coverage.",
        },
        "counties": IL_FIPS_COUNTIES,
        "bridges": bridges,
        "index": index,
    }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    data = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    args.out.write_bytes(data)
    print(f"Wrote {args.out} — {len(bridges):,} bridges")

    for dest in (
        root / "extension" / "data" / "bridges.json",
        root / "web" / "data" / "bridges.json",
        root / "docs" / "data" / "bridges.json",
    ):
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
        print(f"Copied → {dest}")

    for gz_dir in (root / "web" / "data", root / "docs" / "data"):
        gz_path = gz_dir / "bridges.json.gz"
        with gzip.open(gz_path, "wb", compresslevel=9) as g:
            g.write(data)
        print(f"Wrote {gz_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
