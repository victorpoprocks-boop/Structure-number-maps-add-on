/**
 * Illinois bridge structure-number search helpers.
 * Works in Chrome extension and standalone page (no module bundler).
 */
(function (global) {
  "use strict";

  function digitsOnly(s) {
    return String(s || "").replace(/\D/g, "");
  }

  function stripLeadingZeros(s) {
    const d = digitsOnly(s);
    return d.replace(/^0+/, "") || "0";
  }

  function createSearchIndex(data) {
    const bridges = data.bridges || {};
    const counties = data.counties || {};
    const keys = Object.keys(bridges);

    const rows = keys.map((sn) => {
      const b = bridges[sn];
      const dig = digitsOnly(sn);
      return {
        sn,
        dig,
        digLoose: dig.replace(/^0+/, "") || "0",
        carried: (b.carried || "").toLowerCase(),
        crossed: (b.crossed || "").toLowerCase(),
        countyName: (counties[b.county] || "").toLowerCase(),
        bridge: b,
      };
    });

    rows.sort((a, b) => a.sn.localeCompare(b.sn, "en", { numeric: true }));

    function lookupExact(query) {
      const q = String(query || "").trim();
      if (!q) return null;
      if (bridges[q]) return { sn: q, bridge: bridges[q] };

      const dig = digitsOnly(q);
      if (dig.length >= 4) {
        const dashed = dig.slice(0, 3) + "-" + dig.slice(3);
        if (bridges[dashed]) return { sn: dashed, bridge: bridges[dashed] };
        // Pad structure part to 4 digits: 016-1 → 016-0001
        if (dig.length < 7) {
          const padded = dig.slice(0, 3) + "-" + dig.slice(3).padStart(4, "0");
          if (bridges[padded]) return { sn: padded, bridge: bridges[padded] };
        }
      }

      if (data.index) {
        if (data.index[dig]) {
          const sn = data.index[dig];
          return { sn, bridge: bridges[sn] };
        }
        const loose = dig.replace(/^0+/, "");
        if (loose && data.index[loose]) {
          const sn = data.index[loose];
          return { sn, bridge: bridges[sn] };
        }
      }

      for (const row of rows) {
        if (row.dig === dig || row.digLoose === (dig.replace(/^0+/, "") || "0")) {
          return { sn: row.sn, bridge: row.bridge };
        }
      }
      return null;
    }

    function typeahead(query, limit) {
      const lim = limit || 12;
      const q = String(query || "").trim();
      if (!q) return [];
      const dig = digitsOnly(q);
      const digLoose = dig.replace(/^0+/, "") || "";
      const qLower = q.toLowerCase();
      const out = [];

      for (const row of rows) {
        let score = 0;
        if (row.sn.toLowerCase().startsWith(qLower)) score = 100;
        else if (dig && row.dig.startsWith(dig)) score = 90;
        else if (digLoose && row.digLoose.startsWith(digLoose)) score = 80;
        else if (dig && dig.length >= 4 && row.dig.includes(dig)) score = 50;
        else if (
          qLower.length >= 3 &&
          (row.carried.includes(qLower) ||
            row.crossed.includes(qLower) ||
            row.countyName.startsWith(qLower))
        ) {
          score = 30;
        }
        if (score > 0) {
          out.push({ sn: row.sn, bridge: row.bridge, score });
          if (out.length >= lim * 4) break;
        }
      }
      out.sort(
        (a, b) => b.score - a.score || a.sn.localeCompare(b.sn, "en", { numeric: true })
      );
      return out.slice(0, lim);
    }

    function countyName(code) {
      return counties[code] || code || "—";
    }

    function mapsDirectionsUrl(lat, lon) {
      return "https://www.google.com/maps/dir/?api=1&destination=" + lat + "," + lon + "&travelmode=driving";
    }

    function mapsPlaceUrl(lat, lon, zoom) {
      const z = zoom || 17;
      return "https://www.google.com/maps/@" + lat + "," + lon + "," + z + "z";
    }

    function mapsSearchUrl(lat, lon) {
      return "https://www.google.com/maps/search/?api=1&query=" + lat + "," + lon;
    }

    return {
      meta: data.meta || {},
      count: keys.length,
      lookupExact,
      typeahead,
      countyName,
      mapsDirectionsUrl,
      mapsPlaceUrl,
      mapsSearchUrl,
      bridges,
    };
  }

  global.ILBridgeSearch = { createSearchIndex, digitsOnly, stripLeadingZeros };
})(typeof window !== "undefined" ? window : globalThis);
