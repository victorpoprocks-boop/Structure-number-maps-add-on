#!/usr/bin/env python3
"""
Build compact bridges.json from IDOT GIST2 statewide structure shapefile (primary),
optionally supplementing with FHWA NBI Illinois ASCII for any NBI-only records.

Primary source:
  https://apps1.dot.illinois.gov/gist2/gisdata/all2025.zip  → STR2025.*
  Fields: SN, INV_CO, CARRIED, CROSSED, LOCATION, LATITUDE, LONGITUDE, COUNTY_NAM
  CRS: WGS84 (GCS_WGS_1984) in the published zip; LATITUDE/LONGITUDE match shape X/Y.

Optional supplement:
  https://www.fhwa.dot.gov/bridge/nbi/2025/delimited/IL25.txt
"""

from __future__ import annotations

import argparse
import csv
import gzip
import json
import re
import sys
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path

try:
    import shapefile  # pyshp
except ImportError as e:  # pragma: no cover
    raise SystemExit(
        "Missing dependency: pyshp. Install with: pip install pyshp\n" + str(e)
    ) from e

IDOT_ZIP_URL = "https://apps1.dot.illinois.gov/gist2/gisdata/all2025.zip"
NBI_URL = "https://www.fhwa.dot.gov/bridge/nbi/2025/delimited/IL25.txt"
DEFAULT_YEAR = "2025"

# IDOT INV_CO (001–102, alphabetical) → display name
IDOT_COUNTIES = {
    "001": "Adams", "002": "Alexander", "003": "Bond", "004": "Boone",
    "005": "Brown", "006": "Bureau", "007": "Calhoun", "008": "Carroll",
    "009": "Cass", "010": "Champaign", "011": "Christian", "012": "Clark",
    "013": "Clay", "014": "Clinton", "015": "Coles", "016": "Cook",
    "017": "Crawford", "018": "Cumberland", "019": "DeKalb", "020": "DeWitt",
    "021": "Douglas", "022": "DuPage", "023": "Edgar", "024": "Edwards",
    "025": "Effingham", "026": "Fayette", "027": "Ford", "028": "Franklin",
    "029": "Fulton", "030": "Gallatin", "031": "Greene", "032": "Grundy",
    "033": "Hamilton", "034": "Hancock", "035": "Hardin", "036": "Henderson",
    "037": "Henry", "038": "Iroquois", "039": "Jackson", "040": "Jasper",
    "041": "Jefferson", "042": "Jersey", "043": "Jo Daviess", "044": "Johnson",
    "045": "Kane", "046": "Kankakee", "047": "Kendall", "048": "Knox",
    "049": "Lake", "050": "LaSalle", "051": "Lawrence", "052": "Lee",
    "053": "Livingston", "054": "Logan", "055": "McDonough", "056": "McHenry",
    "057": "McLean", "058": "Macon", "059": "Macoupin", "060": "Madison",
    "061": "Marion", "062": "Marshall", "063": "Mason", "064": "Massac",
    "065": "Menard", "066": "Mercer", "067": "Monroe", "068": "Montgomery",
    "069": "Morgan", "070": "Moultrie", "071": "Ogle", "072": "Peoria",
    "073": "Perry", "074": "Piatt", "075": "Pike", "076": "Pope",
    "077": "Pulaski", "078": "Putnam", "079": "Randolph", "080": "Richland",
    "081": "Rock Island", "082": "St. Clair", "083": "Saline", "084": "Sangamon",
    "085": "Schuyler", "086": "Scott", "087": "Shelby", "088": "Stark",
    "089": "Stephenson", "090": "Tazewell", "091": "Union", "092": "Vermilion",
    "093": "Wabash", "094": "Warren", "095": "Washington", "096": "Wayne",
    "097": "White", "098": "Whiteside", "099": "Will", "100": "Williamson",
    "101": "Winnebago", "102": "Woodford",
}

# FHWA county FIPS (Item 003) → IDOT INV_CO
FIPS_TO_IDOT = {
    "001": "001", "003": "002", "005": "003", "007": "004", "009": "005",
    "011": "006", "013": "007", "015": "008", "017": "009", "019": "010",
    "021": "011", "023": "012", "025": "013", "027": "014", "029": "015",
    "031": "016", "033": "017", "035": "018", "037": "019", "039": "020",
    "041": "021", "043": "022", "045": "023", "047": "024", "049": "025",
    "051": "026", "053": "027", "055": "028", "057": "029", "059": "030",
    "061": "031", "063": "032", "065": "033", "067": "034", "069": "035",
    "071": "036", "073": "037", "075": "038", "077": "039", "079": "040",
    "081": "041", "083": "042", "085": "043", "087": "044", "089": "045",
    "091": "046", "093": "047", "095": "048", "097": "049", "099": "050",
    "101": "051", "103": "052", "105": "053", "107": "054", "109": "055",
    "111": "056", "113": "057", "115": "058", "117": "059", "119": "060",
    "121": "061", "123": "062", "125": "063", "127": "064", "129": "065",
    "131": "066", "133": "067", "135": "068", "137": "069", "139": "070",
    "141": "071", "143": "072", "145": "073", "147": "074", "149": "075",
    "151": "076", "153": "077", "155": "078", "157": "079", "159": "080",
    "161": "081", "163": "082", "165": "083", "167": "084", "169": "085",
    "171": "086", "173": "087", "175": "088", "177": "089", "179": "090",
    "181": "091", "183": "092", "185": "093", "187": "094", "189": "095",
    "191": "096", "193": "097", "195": "098", "197": "099", "199": "100",
    "201": "101", "203": "102",
}


def clean_text(value: object) -> str:
    if value is None:
        return ""
    return str(value).strip().strip("'").strip().replace('"', "")


def title_county(name: str) -> str:
    name = clean_text(name)
    if not name:
        return ""
    # Prefer canonical IDOT map spelling when we can match
    upper = name.upper().replace(".", "")
    for code, pretty in IDOT_COUNTIES.items():
        if pretty.upper().replace(".", "") == upper:
            return pretty
    return name.title()


def display_structure_number(raw: str) -> str:
    """Normalize to familiar IDOT CCC-NNNN (or pass through if already dashed)."""
    s = clean_text(raw)
    if not s:
        return s
    if "-" in s:
        return s
    if re.fullmatch(r"\d{7}", s):
        return f"{s[:3]}-{s[3:]}"
    if re.fullmatch(r"\d{15}", s):
        rest4 = s[3:7]
        rest_extra = s[7:].rstrip("0")
        rest = rest4 + rest_extra if rest_extra else rest4
        return f"{s[:3]}-{rest}"
    return s


def normalize_key(sn: str) -> str:
    return re.sub(r"\D", "", sn)


def nbi_dms_to_decimal(lat_s: str, lon_s: str) -> tuple[float | None, float | None]:
    lat_s = (lat_s or "").strip()
    lon_s = (lon_s or "").strip()
    if not lat_s or not lon_s or set(lat_s) <= {"0"} or set(lon_s) <= {"0"}:
        return None, None
    try:
        lat_s = lat_s.zfill(8)
        lon_s = lon_s.zfill(9)
        lat = int(lat_s[0:2]) + int(lat_s[2:4]) / 60 + (
            int(lat_s[4:6]) + int(lat_s[6:8]) / 100
        ) / 3600
        lon = int(lon_s[0:3]) + int(lon_s[3:5]) / 60 + (
            int(lon_s[5:7]) + int(lon_s[7:9]) / 100
        ) / 3600
        lon = -lon
        if not (36.0 <= lat <= 44.0 and -93.5 <= lon <= -85.5):
            return None, None
        return round(lat, 6), round(lon, 6)
    except (ValueError, IndexError):
        return None, None


def download(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"Downloading {url} ...")
    req = urllib.request.Request(url, headers={"User-Agent": "il-bridge-maps-addon/1.1"})
    with urllib.request.urlopen(req, timeout=600) as resp, open(dest, "wb") as out:
        while True:
            chunk = resp.read(1024 * 256)
            if not chunk:
                break
            out.write(chunk)
    print(f"Saved {dest} ({dest.stat().st_size:,} bytes)")


def ensure_str_shapefile(zip_path: Path, extract_dir: Path) -> Path:
    """Extract STR2025.* from the statewide zip; return path stem without extension."""
    extract_dir.mkdir(parents=True, exist_ok=True)
    shp = extract_dir / "STR2025.shp"
    if shp.exists() and (extract_dir / "STR2025.dbf").exists():
        print(f"Using existing shapefile {shp}")
        return extract_dir / "STR2025"

    print(f"Extracting STR2025.* from {zip_path} ...")
    with zipfile.ZipFile(zip_path) as zf:
        members = [n for n in zf.namelist() if Path(n).name.upper().startswith("STR2025")]
        if not members:
            raise SystemExit("No STR2025.* members found in zip")
        for name in members:
            target = extract_dir / Path(name).name
            with zf.open(name) as src, open(target, "wb") as dst:
                dst.write(src.read())
            print(f"  extracted {target.name}")
    if not shp.exists():
        raise SystemExit(f"Expected {shp} after extract")
    return extract_dir / "STR2025"


def _coords_from_record(d: dict, shape) -> tuple[float | None, float | None]:
    lat = d.get("LATITUDE")
    lon = d.get("LONGITUDE")
    try:
        lat_f = float(lat) if lat not in (None, "") else None
        lon_f = float(lon) if lon not in (None, "") else None
    except (TypeError, ValueError):
        lat_f = lon_f = None

    if lat_f in (None, 0.0) or lon_f in (None, 0.0):
        pts = getattr(shape, "points", None) or []
        if pts:
            lon_f, lat_f = float(pts[0][0]), float(pts[0][1])

    if lat_f is None or lon_f is None:
        return None, None

    # Published STR2025 is WGS84. If values look like IL State Plane feet (~EPSG:3436),
    # reproject — defensive only; normal path is already lon/lat degrees.
    if abs(lon_f) > 180 or abs(lat_f) > 90:
        try:
            from pyproj import Transformer

            transformer = Transformer.from_crs(3436, 4326, always_xy=True)
            lon_f, lat_f = transformer.transform(lon_f, lat_f)
        except Exception as exc:  # pragma: no cover
            print(f"WARN: could not reproject coords ({lon_f}, {lat_f}): {exc}")
            return None, None

    if not (36.0 <= lat_f <= 44.0 and -93.5 <= lon_f <= -85.5):
        return None, None
    return round(lat_f, 6), round(lon_f, 6)


def load_idot_structures(shp_stem: Path) -> tuple[dict[str, dict], dict]:
    sf = shapefile.Reader(str(shp_stem))
    bridges: dict[str, dict] = {}
    skipped_coords = 0
    skipped_blank = 0
    county_from_shp: dict[str, str] = {}

    for sr in sf.iterShapeRecords():
        d = sr.record.as_dict()
        sn = display_structure_number(d.get("SN") or "")
        if not sn:
            skipped_blank += 1
            continue
        lat, lon = _coords_from_record(d, sr.shape)
        if lat is None or lon is None:
            skipped_coords += 1
            continue

        inv = clean_text(d.get("INV_CO")).zfill(3) if clean_text(d.get("INV_CO")) else ""
        cname = title_county(d.get("COUNTY_NAM") or "")
        if inv and cname and inv not in county_from_shp:
            county_from_shp[inv] = cname
        if not inv and sn[0:3].isdigit():
            inv = sn[0:3]

        raw = clean_text(d.get("SN_KEY")) or clean_text(d.get("SN")) or sn
        bridges[sn] = {
            "lat": lat,
            "lon": lon,
            "carried": clean_text(d.get("CARRIED")),
            "crossed": clean_text(d.get("CROSSED")),
            "county": inv,
            "loc": clean_text(d.get("LOCATION")),
            "raw": raw,
            "src": "idot",
        }

    stats = {
        "idotCount": len(bridges),
        "skippedNoCoords": skipped_coords,
        "skippedBlankSn": skipped_blank,
        "countyNamesFromShp": county_from_shp,
    }
    print(
        f"IDOT STR: {len(bridges):,} structures "
        f"(skipped coords={skipped_coords}, blank SN={skipped_blank})"
    )
    return bridges, stats


def load_nbi_supplement(raw_path: Path) -> dict[str, dict]:
    bridges: dict[str, dict] = {}
    if not raw_path.exists():
        print(f"NBI file not found ({raw_path}); skipping supplement")
        return bridges

    with open(raw_path, newline="", encoding="utf-8", errors="replace") as f:
        reader = csv.DictReader(f, quotechar="'")
        for row in reader:
            raw_sn = row.get("STRUCTURE_NUMBER_008", "")
            sn = display_structure_number(raw_sn)
            lat, lon = nbi_dms_to_decimal(row.get("LAT_016", ""), row.get("LONG_017", ""))
            if lat is None or lon is None or not sn:
                continue
            fips = (row.get("COUNTY_CODE_003") or "").strip().zfill(3)
            inv = FIPS_TO_IDOT.get(fips, fips)
            bridges[sn] = {
                "lat": lat,
                "lon": lon,
                "carried": clean_text(row.get("FACILITY_CARRIED_007")),
                "crossed": clean_text(row.get("FEATURES_DESC_006A")),
                "county": inv,
                "loc": clean_text(row.get("LOCATION_009")),
                "raw": raw_sn.strip(),
                "src": "nbi",
            }
    print(f"NBI loaded: {len(bridges):,} structures")
    return bridges


def merge_inventories(
    idot: dict[str, dict], nbi: dict[str, dict]
) -> tuple[dict[str, dict], dict]:
    """IDOT wins for coverage and field values; NBI fills gaps / adds NBI-only SNs."""
    bridges = dict(idot)
    nbi_only = 0
    nbi_filled = 0

    for sn, nb in nbi.items():
        if sn not in bridges:
            bridges[sn] = nb
            nbi_only += 1
            continue
        # Soft-fill empty IDOT text fields from NBI (coords / county stay IDOT)
        cur = bridges[sn]
        changed = False
        for key in ("carried", "crossed", "loc"):
            if not cur.get(key) and nb.get(key):
                cur[key] = nb[key]
                changed = True
        if not cur.get("raw") and nb.get("raw"):
            cur["raw"] = nb["raw"]
            changed = True
        if changed:
            nbi_filled += 1

    return bridges, {"nbiOnlyAdded": nbi_only, "nbiFieldsFilled": nbi_filled}


def build_index(bridges: dict[str, dict]) -> dict[str, str]:
    index: dict[str, str] = {}
    for sn in bridges:
        nk = normalize_key(sn)
        if nk:
            index[nk] = sn
        nk2 = nk.lstrip("0")
        if nk2 and nk2 not in index:
            index[nk2] = sn
    return index


def write_outputs(payload: dict, out_path: Path, root: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    raw = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    out_path.write_bytes(raw)
    print(f"Wrote {out_path} — {payload['meta']['bridgeCount']:,} bridges, {len(raw):,} bytes")

    targets = [
        root / "extension" / "data" / "bridges.json",
        root / "web" / "data" / "bridges.json",
        root / "docs" / "data" / "bridges.json",
    ]
    for dest in targets:
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(raw)
        print(f"Copied → {dest}")

    for gz_dir in (root / "web" / "data", root / "docs" / "data"):
        gz_dir.mkdir(parents=True, exist_ok=True)
        gz_path = gz_dir / "bridges.json.gz"
        with gzip.open(gz_path, "wb", compresslevel=9) as g:
            g.write(raw)
        print(f"Wrote {gz_path} — {gz_path.stat().st_size:,} bytes")


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    default_gis = Path("/workspace/idot-gis")
    parser = argparse.ArgumentParser(
        description="Build IL bridges.json from IDOT GIST2 structures (+ optional NBI)"
    )
    parser.add_argument("--year", default=DEFAULT_YEAR)
    parser.add_argument("--idot-zip-url", default=IDOT_ZIP_URL)
    parser.add_argument("--idot-zip", type=Path, default=default_gis / "all2025.zip")
    parser.add_argument("--idot-dir", type=Path, default=default_gis)
    parser.add_argument("--nbi-url", default=NBI_URL)
    parser.add_argument("--nbi-raw", type=Path, default=root / "raw" / "IL25.txt")
    parser.add_argument("--out", type=Path, default=root / "data" / "bridges.json")
    parser.add_argument("--skip-download", action="store_true")
    parser.add_argument("--skip-nbi", action="store_true", help="IDOT only, no NBI merge")
    parser.add_argument(
        "--download-nbi",
        action="store_true",
        help="Force download/refresh NBI even when --skip-download is set",
    )
    args = parser.parse_args()

    if not args.skip_download or not args.idot_zip.exists():
        download(args.idot_zip_url, args.idot_zip)
    else:
        print(f"Using existing {args.idot_zip}")

    shp_stem = ensure_str_shapefile(args.idot_zip, args.idot_dir)
    idot_bridges, idot_stats = load_idot_structures(shp_stem)

    nbi_bridges: dict[str, dict] = {}
    merge_stats = {"nbiOnlyAdded": 0, "nbiFieldsFilled": 0}
    if not args.skip_nbi:
        if args.download_nbi or (not args.skip_download and not args.nbi_raw.exists()):
            download(args.nbi_url, args.nbi_raw)
        nbi_bridges = load_nbi_supplement(args.nbi_raw)
        bridges, merge_stats = merge_inventories(idot_bridges, nbi_bridges)
    else:
        bridges = idot_bridges

    counties = dict(IDOT_COUNTIES)
    for code, name in idot_stats.get("countyNamesFromShp", {}).items():
        counties.setdefault(code, name)

    index = build_index(bridges)
    payload = {
        "meta": {
            "state": "IL",
            "source": (
                "IDOT GIST2 statewide structure inventory (STR2025) primary; "
                "FHWA NBI Illinois ASCII optional supplement"
            ),
            "sourceUrl": args.idot_zip_url,
            "nbiSourceUrl": args.nbi_url,
            "sourceYear": args.year,
            "formatDoc": "https://apps1.dot.illinois.gov/gist2/",
            "builtAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "bridgeCount": len(bridges),
            "idotCount": idot_stats["idotCount"],
            "nbiSupplementCount": len(nbi_bridges),
            "nbiOnlyAdded": merge_stats["nbiOnlyAdded"],
            "nbiFieldsFilled": merge_stats["nbiFieldsFilled"],
            "skippedNoCoords": idot_stats["skippedNoCoords"],
            "notes": (
                "Primary inventory is IDOT STR shapefile (all IDOT-numbered structures). "
                "Coordinates are WGS84 from LATITUDE/LONGITUDE (matching shape geometry). "
                "County codes are IDOT INV_CO (001–102), not FIPS. "
                "NBI-only records (e.g. some federal SNs) are merged when present; IDOT wins on overlap."
            ),
        },
        "counties": counties,
        "bridges": bridges,
        "index": index,
    }

    write_outputs(payload, args.out, root)

    # Quick verification helper for the reported missing SN
    probe = "097-0107"
    if probe in bridges:
        print(f"VERIFY {probe}: {json.dumps(bridges[probe], ensure_ascii=False)}")
    else:
        white = sorted(k for k in bridges if k.startswith("097-"))
        print(
            f"VERIFY {probe}: NOT PRESENT in rebuilt inventory "
            f"(White County / INV_CO 097 has {len(white)} structures; "
            f"also absent from IDOT STR2025 shapefile)."
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
