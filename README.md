# Illinois Bridge Structure Number Maps

Search Illinois bridge structure numbers (IDOT `CCC-NNNN`, full IDOT inventory) and navigate to them in Google Maps.

## Live site (phone / PWA)

After GitHub Pages is enabled: https://victorpoprocks-boop.github.io/Structure-number-maps-add-on/

On your phone: open that URL → Add to Home Screen. **Navigate** hands off to the Google Maps app.

## Chrome extension

Load unpacked from `extension/` if present in a fuller release zip, or use the standalone site under `docs/`.

## Data

- **Primary:** IDOT GIST2 statewide structures (`STR2025` in [all2025.zip](https://apps1.dot.illinois.gov/gist2/gisdata/all2025.zip))
- **Supplement:** FHWA NBI Illinois ASCII (NBI-only SNs merged; IDOT wins on overlap)
- County codes are **IDOT INV_CO** (White = `097`, Cook = `016`)
- Rebuild: `python3 scripts/build-data-idot.py` (needs `pyshp`)

See the project README in the fuller addon package for pipeline details.

## Named lists

Tap **Create list** for a popup (Title + Structure number, **+** / **−**, **Save list** / **Delete list**). Saved names show on the main Lists screen; open a list and tap an SN for the usual result card + **Navigate** (twin bias unchanged). **Edit** reopens the popup. Existing Daily / `ilb-daily-lists-v2` data migrates automatically.

## Twin interstate Navigate bias

Adjacent barrel SNs (e.g. `075-0107` WB / `075-0108` EB) are detected as twins. The result card links the twin and the map shows both pins. **Navigate** offsets the destination ~60 m along the labeled travel direction so Google Maps is more likely to snap to the correct carriageway.

