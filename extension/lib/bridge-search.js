/**
 * Illinois bridge structure-number search helpers.
 * Works in Chrome extension and standalone page (no module bundler).
 *
 * Twin interstate / divided-highway pairs: adjacent structure numbers that sit
 * close together with opposite direction labels (EB/WB or NB/SB). Navigate URLs
 * bias the destination ~60 m along the labeled barrel's travel heading so Google
 * Maps is more likely to snap to the correct carriageway.
 */
(function (global) {
  "use strict";

  var TWIN_MAX_M = 100;
  var NAV_BIAS_M = 60;
  var EARTH_R = 6371000;

  var DIR_RE =
    /\b(EASTBOUND|WESTBOUND|NORTHBOUND|SOUTHBOUND|E\/B|W\/B|N\/B|S\/B|EB|WB|NB|SB)\b/i;
  var INTERSTATE_RE = /\b(I[-\s]?\d+|FAI|INTERSTATE)\b/i;
  var DIVIDED_RE =
    /\b(I[-\s]?\d+|FAI|INTERSTATE|US\s?\d+|ILL?\s?\d+|FAP|FAU)\b/i;

  var DIR_CANON = {
    EASTBOUND: "EB",
    "E/B": "EB",
    WESTBOUND: "WB",
    "W/B": "WB",
    NORTHBOUND: "NB",
    "N/B": "NB",
    SOUTHBOUND: "SB",
    "S/B": "SB",
    EB: "EB",
    WB: "WB",
    NB: "NB",
    SB: "SB",
  };

  /** Compass bearing (deg clockwise from north) for a labeled direction. */
  var DIR_BEARING = { EB: 90, WB: 270, NB: 0, SB: 180 };

  var OPPOSITE = { EB: "WB", WB: "EB", NB: "SB", SB: "NB" };

  function digitsOnly(s) {
    return String(s || "").replace(/\D/g, "");
  }

  function stripLeadingZeros(s) {
    var d = digitsOnly(s);
    return d.replace(/^0+/, "") || "0";
  }

  function parseDirection(carried) {
    var m = DIR_RE.exec(String(carried || ""));
    if (!m) return null;
    var raw = m[1].toUpperCase();
    return DIR_CANON[raw] || null;
  }

  function directionLabel(dir) {
    return (
      { EB: "Eastbound", WB: "Westbound", NB: "Northbound", SB: "Southbound" }[
        dir
      ] || dir || ""
    );
  }

  function haversineM(lat1, lon1, lat2, lon2) {
    var a1 = (lat1 * Math.PI) / 180;
    var a2 = (lat2 * Math.PI) / 180;
    var dLat = ((lat2 - lat1) * Math.PI) / 180;
    var dLon = ((lon2 - lon1) * Math.PI) / 180;
    var h =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a1) * Math.cos(a2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function bearingDeg(lat1, lon1, lat2, lon2) {
    var φ1 = (lat1 * Math.PI) / 180;
    var φ2 = (lat2 * Math.PI) / 180;
    var Δλ = ((lon2 - lon1) * Math.PI) / 180;
    var y = Math.sin(Δλ) * Math.cos(φ2);
    var x =
      Math.cos(φ1) * Math.sin(φ2) -
      Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  }

  function offsetPoint(lat, lon, bearing, distM) {
    var δ = distM / EARTH_R;
    var θ = (bearing * Math.PI) / 180;
    var φ1 = (lat * Math.PI) / 180;
    var λ1 = (lon * Math.PI) / 180;
    var sinφ1 = Math.sin(φ1);
    var cosφ1 = Math.cos(φ1);
    var sinδ = Math.sin(δ);
    var cosδ = Math.cos(δ);
    var sinφ2 = sinφ1 * cosδ + cosφ1 * sinδ * Math.cos(θ);
    var φ2 = Math.asin(sinφ2);
    var y = Math.sin(θ) * sinδ * cosφ1;
    var x = cosδ - sinφ1 * sinφ2;
    var λ2 = λ1 + Math.atan2(y, x);
    return {
      lat: Math.round(((φ2 * 180) / Math.PI) * 1e6) / 1e6,
      lon:
        Math.round(((((λ2 * 180) / Math.PI + 540) % 360) - 180) * 1e6) / 1e6,
    };
  }

  function angleDiff(a, b) {
    var d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
  }

  function snParts(sn) {
    var m = /^(\d{3})-(\d+)$/.exec(sn);
    if (!m) return null;
    return { prefix: m[1], num: parseInt(m[2], 10) };
  }

  function crossedSimilar(a, b) {
    var ca = String(a || "")
      .toUpperCase()
      .replace(/\s+/g, " ")
      .trim();
    var cb = String(b || "")
      .toUpperCase()
      .replace(/\s+/g, " ")
      .trim();
    if (!ca || !cb) return false;
    if (ca === cb) return true;
    // Soft match: one contains the other (short feature names)
    if (ca.length >= 4 && cb.length >= 4 && (ca.indexOf(cb) >= 0 || cb.indexOf(ca) >= 0)) {
      return true;
    }
    return false;
  }

  function looksInterstate(carried) {
    return INTERSTATE_RE.test(String(carried || ""));
  }

  function looksDivided(carried) {
    return DIVIDED_RE.test(String(carried || "")) || !!parseDirection(carried);
  }

  function oppositeDirs(d1, d2) {
    return !!(d1 && d2 && OPPOSITE[d1] === d2);
  }

  /**
   * Infer travel heading (deg) for Navigate bias.
   * Prefer EB/WB/NB/SB compass conventions. When a twin pair looks
   * cross-median (twin vector roughly perpendicular to travel), refine
   * heading to ±90° of the twin vector so it follows local road angle.
   * Inventory points are often staggered along-road rather than across
   * the median (~50% of the time); in those cases trust the label.
   */
  function inferTravelBearing(bridge, twinBridge, dir) {
    if (!dir || DIR_BEARING[dir] == null) return null;
    var compass = DIR_BEARING[dir];
    if (!twinBridge || !bridge) return compass;

    var twinBrg = bearingDeg(bridge.lat, bridge.lon, twinBridge.lat, twinBridge.lon);
    // 0 = twin vector perfectly perpendicular to labeled travel
    var perpScore = Math.abs(angleDiff(twinBrg, compass) - 90);
    if (perpScore <= 35) {
      var c1 = (twinBrg + 90) % 360;
      var c2 = (twinBrg + 270) % 360;
      return angleDiff(c1, compass) <= angleDiff(c2, compass) ? c1 : c2;
    }
    return compass;
  }

  function buildTwinIndex(bridges) {
    var byKey = Object.create(null);
    var sns = Object.keys(bridges);
    for (var i = 0; i < sns.length; i++) {
      var sn = sns[i];
      var parts = snParts(sn);
      if (!parts) continue;
      byKey[parts.prefix + ":" + parts.num] = sn;
    }

    /** @type {Object.<string, string>} */
    var twinOf = Object.create(null);
    var pairCount = 0;

    for (var j = 0; j < sns.length; j++) {
      var snA = sns[j];
      if (twinOf[snA]) continue;
      var pa = snParts(snA);
      if (!pa) continue;
      var snB = byKey[pa.prefix + ":" + (pa.num + 1)];
      if (!snB || twinOf[snB]) continue;

      var a = bridges[snA];
      var b = bridges[snB];
      if (
        a == null ||
        b == null ||
        typeof a.lat !== "number" ||
        typeof a.lon !== "number" ||
        typeof b.lat !== "number" ||
        typeof b.lon !== "number"
      ) {
        continue;
      }

      var dist = haversineM(a.lat, a.lon, b.lat, b.lon);
      if (dist > TWIN_MAX_M || dist < 0.5) continue;

      var dirA = parseDirection(a.carried);
      var dirB = parseDirection(b.carried);
      var sameCross = crossedSimilar(a.crossed, b.crossed);
      var ok = false;

      if (oppositeDirs(dirA, dirB)) {
        // Opposite barrels — prefer same crossed, but allow if very close.
        ok = sameCross || dist <= 50 || (looksDivided(a.carried) && looksDivided(b.carried));
      } else if (dirA && dirB) {
        // Both labeled but not opposite — skip (e.g. both NB ramps).
        ok = false;
      } else if ((dirA || dirB) && sameCross && dist <= 80) {
        ok = looksDivided(a.carried) || looksDivided(b.carried);
      } else if (!dirA && !dirB && sameCross && dist <= 80) {
        ok = looksInterstate(a.carried) && looksInterstate(b.carried);
      }

      if (!ok) continue;

      twinOf[snA] = snB;
      twinOf[snB] = snA;
      pairCount += 1;
    }

    return { twinOf: twinOf, pairCount: pairCount };
  }

  function createSearchIndex(data) {
    var bridges = data.bridges || {};
    var counties = data.counties || {};
    var keys = Object.keys(bridges);

    var rows = keys.map(function (sn) {
      var b = bridges[sn];
      var dig = digitsOnly(sn);
      return {
        sn: sn,
        dig: dig,
        digLoose: dig.replace(/^0+/, "") || "0",
        carried: (b.carried || "").toLowerCase(),
        crossed: (b.crossed || "").toLowerCase(),
        countyName: (counties[b.county] || "").toLowerCase(),
        bridge: b,
      };
    });

    rows.sort(function (a, b) {
      return a.sn.localeCompare(b.sn, "en", { numeric: true });
    });

    var twins = buildTwinIndex(bridges);

    function lookupExact(query) {
      var q = String(query || "").trim();
      if (!q) return null;
      if (bridges[q]) return { sn: q, bridge: bridges[q] };

      var dig = digitsOnly(q);
      if (dig.length >= 4) {
        var dashed = dig.slice(0, 3) + "-" + dig.slice(3);
        if (bridges[dashed]) return { sn: dashed, bridge: bridges[dashed] };
        if (dig.length < 7) {
          var padded = dig.slice(0, 3) + "-" + dig.slice(3).padStart(4, "0");
          if (bridges[padded]) return { sn: padded, bridge: bridges[padded] };
        }
      }

      if (data.index) {
        if (data.index[dig]) {
          var sn = data.index[dig];
          return { sn: sn, bridge: bridges[sn] };
        }
        var loose = dig.replace(/^0+/, "");
        if (loose && data.index[loose]) {
          var sn2 = data.index[loose];
          return { sn: sn2, bridge: bridges[sn2] };
        }
      }

      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        if (row.dig === dig || row.digLoose === (dig.replace(/^0+/, "") || "0")) {
          return { sn: row.sn, bridge: row.bridge };
        }
      }
      return null;
    }

    function typeahead(query, limit) {
      var lim = limit || 12;
      var q = String(query || "").trim();
      if (!q) return [];
      var dig = digitsOnly(q);
      var digLoose = dig.replace(/^0+/, "") || "";
      var qLower = q.toLowerCase();
      var out = [];

      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var score = 0;
        if (row.sn.toLowerCase().startsWith(qLower)) score = 100;
        else if (dig && row.dig.startsWith(dig)) score = 90;
        else if (digLoose && row.digLoose.startsWith(digLoose)) score = 80;
        else if (dig && dig.length >= 4 && row.dig.indexOf(dig) >= 0) score = 50;
        else if (
          qLower.length >= 3 &&
          (row.carried.indexOf(qLower) >= 0 ||
            row.crossed.indexOf(qLower) >= 0 ||
            row.countyName.indexOf(qLower) === 0)
        ) {
          score = 30;
        }
        if (score > 0) {
          out.push({ sn: row.sn, bridge: row.bridge, score: score });
          if (out.length >= lim * 4) break;
        }
      }
      out.sort(function (a, b) {
        return b.score - a.score || a.sn.localeCompare(b.sn, "en", { numeric: true });
      });
      return out.slice(0, lim);
    }

    function countyName(code) {
      return counties[code] || code || "—";
    }

    function findTwin(sn) {
      var twinSn = twins.twinOf[sn];
      if (!twinSn || !bridges[twinSn]) return null;
      return { sn: twinSn, bridge: bridges[twinSn] };
    }

    /**
     * Destination for Google Maps Navigate.
     * When a twin + direction are known, offset ~60 m along the inferred
     * travel heading so Maps prefers the correct barrel. Otherwise raw coords.
     */
    function navigateDestination(sn, bridge) {
      var b = bridge || bridges[sn];
      if (!b || typeof b.lat !== "number" || typeof b.lon !== "number") {
        return null;
      }
      var dir = parseDirection(b.carried);
      var twin = findTwin(sn);
      var bearing = inferTravelBearing(b, twin && twin.bridge, dir);
      if (bearing == null) {
        return {
          lat: b.lat,
          lon: b.lon,
          biased: false,
          dir: dir,
          bearing: null,
          twinSn: twin ? twin.sn : null,
        };
      }
      var pt = offsetPoint(b.lat, b.lon, bearing, NAV_BIAS_M);
      return {
        lat: pt.lat,
        lon: pt.lon,
        biased: true,
        dir: dir,
        bearing: Math.round(bearing * 10) / 10,
        twinSn: twin ? twin.sn : null,
        rawLat: b.lat,
        rawLon: b.lon,
      };
    }

    function mapsDirectionsUrl(lat, lon) {
      return (
        "https://www.google.com/maps/dir/?api=1&destination=" +
        lat +
        "," +
        lon +
        "&travelmode=driving"
      );
    }

    function mapsDirectionsForBridge(sn, bridge) {
      var dest = navigateDestination(sn, bridge);
      if (!dest) return null;
      return mapsDirectionsUrl(dest.lat, dest.lon);
    }

    function mapsPlaceUrl(lat, lon, zoom) {
      var z = zoom || 17;
      return "https://www.google.com/maps/@" + lat + "," + lon + "," + z + "z";
    }

    function mapsSearchUrl(lat, lon) {
      return "https://www.google.com/maps/search/?api=1&query=" + lat + "," + lon;
    }

    return {
      meta: data.meta || {},
      count: keys.length,
      twinPairCount: twins.pairCount,
      lookupExact: lookupExact,
      typeahead: typeahead,
      countyName: countyName,
      findTwin: findTwin,
      parseDirection: parseDirection,
      directionLabel: directionLabel,
      navigateDestination: navigateDestination,
      mapsDirectionsUrl: mapsDirectionsUrl,
      mapsDirectionsForBridge: mapsDirectionsForBridge,
      mapsPlaceUrl: mapsPlaceUrl,
      mapsSearchUrl: mapsSearchUrl,
      bridges: bridges,
    };
  }

  global.ILBridgeSearch = {
    createSearchIndex: createSearchIndex,
    digitsOnly: digitsOnly,
    stripLeadingZeros: stripLeadingZeros,
    parseDirection: parseDirection,
    directionLabel: directionLabel,
    TWIN_MAX_M: TWIN_MAX_M,
    NAV_BIAS_M: NAV_BIAS_M,
  };
})(typeof window !== "undefined" ? window : globalThis);
