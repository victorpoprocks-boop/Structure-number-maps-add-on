(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const DEBOUNCE_MS = 140;
  const HELP_KEY = "ilb-a2hs-dismissed";

  const state = {
    search: null,
    suggestions: [],
    activeIdx: -1,
    marker: null,
    debounce: 0,
    deferredInstall: null,
  };

  const pinIcon = L.divIcon({
    className: "bridge-pin",
    html: "<span></span>",
    iconSize: [28, 28],
    iconAnchor: [11, 26],
    popupAnchor: [0, -22],
  });

  const map = L.map("map", {
    zoomControl: true,
    tapHold: true,
  }).setView([40.0, -89.2], 7);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);

  function isStandalone() {
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      window.matchMedia("(display-mode: fullscreen)").matches ||
      window.navigator.standalone === true
    );
  }

  function deviceKind() {
    const ua = navigator.userAgent || "";
    const iOS =
      /iPad|iPhone|iPod/.test(ua) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (iOS) return "ios";
    if (/Android/i.test(ua)) return "android";
    return "other";
  }

  function setStatus(msg, kind) {
    const el = $("#status");
    el.className = "status" + (kind ? " " + kind : "");
    el.textContent = msg || "";
    el.style.display = msg ? "block" : "none";
  }

  function setOffline(offline) {
    const el = $("#offline-banner");
    el.hidden = !offline;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function mapsDirUrl(lat, lon) {
    if (state.search && state.search.mapsDirectionsUrl) {
      return state.search.mapsDirectionsUrl(lat, lon);
    }
    return (
      "https://www.google.com/maps/dir/?api=1&destination=" +
      lat +
      "," +
      lon +
      "&travelmode=driving"
    );
  }

  function mapsSearchUrl(lat, lon) {
    if (state.search && state.search.mapsSearchUrl) {
      return state.search.mapsSearchUrl(lat, lon);
    }
    return "https://www.google.com/maps/search/?api=1&query=" + lat + "," + lon;
  }

  function invalidateMapSoon() {
    requestAnimationFrame(() => {
      map.invalidateSize();
    });
  }

  function showOnMap(sn, bridge) {
    const latlng = [bridge.lat, bridge.lon];
    if (state.marker) map.removeLayer(state.marker);
    state.marker = L.marker(latlng, { icon: pinIcon }).addTo(map);
    const county = state.search.countyName(bridge.county);
    state.marker
      .bindPopup(
        '<div class="bridge-popup"><div class="title">' +
          escapeHtml(sn) +
          "</div><div>" +
          escapeHtml(bridge.carried || "—") +
          " over " +
          escapeHtml(bridge.crossed || "—") +
          "</div><div>" +
          escapeHtml(county) +
          " County</div></div>"
      )
      .openPopup();
    invalidateMapSoon();
    map.setView(latlng, Math.max(map.getZoom(), 15), { animate: true });
  }

  function renderResult(sn, bridge) {
    const host = $("#result");
    if (!bridge) {
      host.innerHTML = "";
      return;
    }
    const county = state.search.countyName(bridge.county);
    const dir = mapsDirUrl(bridge.lat, bridge.lon);
    const focus = mapsSearchUrl(bridge.lat, bridge.lon);
    host.innerHTML =
      '<article class="card">' +
      "<h2>" +
      escapeHtml(sn) +
      "</h2>" +
      '<div class="row"><div class="k">Carried</div><div class="v">' +
      escapeHtml(bridge.carried || "—") +
      "</div></div>" +
      '<div class="row"><div class="k">Crossed</div><div class="v">' +
      escapeHtml(bridge.crossed || "—") +
      "</div></div>" +
      '<div class="row"><div class="k">County</div><div class="v">' +
      escapeHtml(county) +
      (bridge.county ? " (" + escapeHtml(bridge.county) + ")" : "") +
      "</div></div>" +
      '<div class="row"><div class="k">Location</div><div class="v">' +
      escapeHtml(bridge.loc || "—") +
      "</div></div>" +
      '<div class="row"><div class="k">Coords</div><div class="v">' +
      bridge.lat +
      ", " +
      bridge.lon +
      "</div></div>" +
      '<div class="actions">' +
      '<a class="btn primary" data-nav href="' +
      dir +
      '" target="_blank" rel="noopener">Navigate</a>' +
      '<a class="btn secondary" href="' +
      focus +
      '" target="_blank" rel="noopener">Open in Maps</a>' +
      "</div></article>";
    showOnMap(sn, bridge);
  }

  function renderSuggest(items) {
    const box = $("#suggest");
    const input = $("#q");
    state.suggestions = items;
    state.activeIdx = items.length ? 0 : -1;
    if (!items.length) {
      box.classList.remove("open");
      box.innerHTML = "";
      input.setAttribute("aria-expanded", "false");
      return;
    }
    box.innerHTML = items
      .map((item, i) => {
        const b = item.bridge;
        const county = state.search.countyName(b.county);
        return (
          '<button type="button" role="option" class="' +
          (i === state.activeIdx ? "active" : "") +
          '" data-i="' +
          i +
          '"><div class="sn">' +
          escapeHtml(item.sn) +
          '</div><div class="meta">' +
          escapeHtml((b.carried || "—") + " over " + (b.crossed || "—") + " · " + county) +
          "</div></button>"
        );
      })
      .join("");
    box.classList.add("open");
    input.setAttribute("aria-expanded", "true");
    [...box.querySelectorAll("button")].forEach((btn) => {
      btn.addEventListener("click", () => {
        const item = state.suggestions[Number(btn.dataset.i)];
        select(item.sn, item.bridge);
      });
    });
  }

  function select(sn, bridge) {
    const input = $("#q");
    input.value = sn;
    $("#suggest").classList.remove("open");
    input.setAttribute("aria-expanded", "false");
    input.blur();
    setStatus(null);
    renderResult(sn, bridge);
    try {
      const url = new URL(location.href);
      url.searchParams.set("sn", sn);
      history.replaceState(null, "", url);
    } catch (_) {
      /* ignore */
    }
  }

  function digitsEqual(a, b) {
    const da = String(a).replace(/\D/g, "");
    const db = String(b).replace(/\D/g, "");
    return da === db || da.replace(/^0+/, "") === db.replace(/^0+/, "");
  }

  function onQuery(q) {
    if (!state.search) return;
    const suggestions = state.search.typeahead(q, 12);
    renderSuggest(suggestions);
    const exact = state.search.lookupExact(q);
    if (exact && digitsEqual(q, exact.sn)) {
      setStatus(null);
      renderResult(exact.sn, exact.bridge);
    } else if (q.trim() && !suggestions.length) {
      setStatus("No Illinois bridges match “" + q.trim() + "”.", "error");
      renderResult(null, null);
    } else if (!q.trim()) {
      setStatus("Enter an IL structure number (example: 016-0001).");
      renderResult(null, null);
    } else {
      setStatus(suggestions.length + " matches — select one or press Search.");
      renderResult(null, null);
    }
  }

  function scheduleQuery(q) {
    clearTimeout(state.debounce);
    state.debounce = setTimeout(() => onQuery(q), DEBOUNCE_MS);
  }

  async function loadBridges() {
    async function fromGzip(resp) {
      const buf = await resp.arrayBuffer();
      const u8 = new Uint8Array(buf);
      if (u8.length >= 2 && u8[0] === 0x1f && u8[1] === 0x8b) {
        if (!("DecompressionStream" in window)) {
          throw new Error("no DecompressionStream");
        }
        const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
        const text = await new Response(stream).text();
        return JSON.parse(text);
      }
      const text = new TextDecoder().decode(buf);
      return JSON.parse(text);
    }

    try {
      const gz = await fetch("data/bridges.json.gz", { cache: "default" });
      if (gz.ok) return await fromGzip(gz);
    } catch (err) {
      console.warn("gzip inventory failed, falling back", err);
    }
    const resp = await fetch("data/bridges.json");
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    return resp.json();
  }

  function bindInstallHelp() {
    const help = $("#install-help");
    const toggle = $("#install-toggle");
    const dismiss = $("#install-dismiss");
    const promptBtn = $("#install-prompt-btn");

    if (isStandalone()) {
      document.body.classList.add("standalone");
      help.hidden = true;
      return;
    }

    const kind = deviceKind();
    if (kind === "ios") {
      toggle.textContent = "Add";
    }

    const dismissed = localStorage.getItem(HELP_KEY) === "1";
    help.hidden = dismissed;
    toggle.setAttribute("aria-expanded", dismissed ? "false" : "true");

    toggle.addEventListener("click", () => {
      const next = help.hidden;
      help.hidden = !next;
      toggle.setAttribute("aria-expanded", next ? "true" : "false");
    });
    dismiss.addEventListener("click", () => {
      help.hidden = true;
      toggle.setAttribute("aria-expanded", "false");
      try {
        localStorage.setItem(HELP_KEY, "1");
      } catch (_) {
        /* ignore */
      }
    });

    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      state.deferredInstall = e;
      promptBtn.hidden = false;
      help.hidden = false;
      toggle.setAttribute("aria-expanded", "true");
    });
    promptBtn.addEventListener("click", async () => {
      if (!state.deferredInstall) return;
      state.deferredInstall.prompt();
      try {
        await state.deferredInstall.userChoice;
      } catch (_) {
        /* ignore */
      }
      state.deferredInstall = null;
      promptBtn.hidden = true;
    });
    window.addEventListener("appinstalled", () => {
      help.hidden = true;
      document.body.classList.add("standalone");
    });
  }

  function registerWorker() {
    if (!("serviceWorker" in navigator)) return;
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch((err) => {
        console.warn("SW register failed", err);
      });
    });
  }

  function bindMapResize() {
    const onResize = () => invalidateMapSoon();
    window.addEventListener("resize", onResize);
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", onResize);
    }
    setTimeout(onResize, 250);
  }

  async function init() {
    bindInstallHelp();
    registerWorker();
    bindMapResize();
    setOffline(!navigator.onLine);
    window.addEventListener("offline", () => setOffline(true));
    window.addEventListener("online", () => setOffline(false));

    const input = $("#q");
    input.addEventListener("input", () => scheduleQuery(input.value));
    input.addEventListener("keydown", (e) => {
      const box = $("#suggest");
      if (e.key === "ArrowDown" && state.suggestions.length) {
        e.preventDefault();
        state.activeIdx = Math.min(state.suggestions.length - 1, state.activeIdx + 1);
        [...box.children].forEach((c, i) => c.classList.toggle("active", i === state.activeIdx));
        if (box.children[state.activeIdx]) {
          box.children[state.activeIdx].scrollIntoView({ block: "nearest" });
        }
      } else if (e.key === "ArrowUp" && state.suggestions.length) {
        e.preventDefault();
        state.activeIdx = Math.max(0, state.activeIdx - 1);
        [...box.children].forEach((c, i) => c.classList.toggle("active", i === state.activeIdx));
        if (box.children[state.activeIdx]) {
          box.children[state.activeIdx].scrollIntoView({ block: "nearest" });
        }
      } else if (e.key === "Enter") {
        e.preventDefault();
        clearTimeout(state.debounce);
        if (state.activeIdx >= 0 && state.suggestions[state.activeIdx]) {
          const item = state.suggestions[state.activeIdx];
          select(item.sn, item.bridge);
        } else if (state.search) {
          const hit = state.search.lookupExact(input.value);
          if (hit) select(hit.sn, hit.bridge);
          else setStatus("Structure number not found in Illinois NBI inventory.", "error");
        }
      } else if (e.key === "Escape") {
        box.classList.remove("open");
        input.setAttribute("aria-expanded", "false");
      }
    });
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".search-wrap")) {
        $("#suggest").classList.remove("open");
        input.setAttribute("aria-expanded", "false");
      }
    });

    try {
      setStatus("Downloading Illinois bridge inventory…");
      const data = await loadBridges();
      setStatus("Building search index…");
      await new Promise((r) => setTimeout(r, 0));
      state.search = window.ILBridgeSearch.createSearchIndex(data);
      $("#footer").innerHTML =
        "<strong>" +
        state.search.count.toLocaleString() +
        "</strong> Illinois bridges · FHWA NBI " +
        (state.search.meta.sourceYear || "") +
        ' · <a href="' +
        (state.search.meta.sourceUrl || "#") +
        '" target="_blank" rel="noopener">source</a><br/>Map tiles © OpenStreetMap contributors. Cached inventory works offline after the first visit.';
      setStatus("Ready — search by structure number.", "ok");

      if (isStandalone() || window.matchMedia("(min-width: 860px)").matches) {
        input.focus();
      }

      const params = new URLSearchParams(location.search);
      const snParam = params.get("sn");
      if (snParam) {
        input.value = snParam;
        const hit = state.search.lookupExact(snParam);
        if (hit) select(hit.sn, hit.bridge);
        else onQuery(snParam);
      }
    } catch (err) {
      console.error(err);
      setStatus(
        "Failed to load data/bridges.json. Serve this folder over http:// or https:// (phones cannot use file://). Example: python3 -m http.server 8765",
        "error"
      );
    }
  }

  init();
})();
