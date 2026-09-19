(() => {
  "use strict";

  const APP_BUILD = "v17";
  const APP_BUILD_KEY = "ilb-app-build";

  const $ = (sel) => document.querySelector(sel);
  const DEBOUNCE_MS = 140;
  const HELP_KEY = "ilb-a2hs-dismissed";
  const DAILY_KEY_LEGACY = "ilb-daily-list";
  const DAILY_STORE_KEY = "ilb-daily-lists-v2";
  const DAILY_OPEN_KEY = "ilb-daily-list-open";

  const state = {
    search: null,
    suggestions: [],
    activeIdx: -1,
    markers: null,
    debounce: 0,
    deferredInstall: null,
    dailyLists: [],
    viewingListId: null,
    selectedSn: null,
    draft: null,
  };

  const pinIcon = L.divIcon({
    className: "bridge-pin",
    html: "<span></span>",
    iconSize: [28, 28],
    iconAnchor: [11, 26],
    popupAnchor: [0, -22],
  });

  const twinPinIcon = L.divIcon({
    className: "bridge-pin twin",
    html: "<span></span>",
    iconSize: [24, 24],
    iconAnchor: [10, 22],
    popupAnchor: [0, -18],
  });

  const map = L.map("map", {
    zoomControl: true,
    tapHold: true,
  }).setView([40.0, -89.2], 7);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);

  // RainViewer animated radar (public tiles) — optional overlay with play/pause.
  const radarState = {
    host: "https://tilecache.rainviewer.com",
    frames: [],
    idx: 0,
    layer: null,
    timer: null,
    playing: false,
    opacity: 0.65,
  };

  function radarTileUrl(framePath) {
    // color scheme 2, smooth 1, snow 1 — RainViewer path format
    return (
      radarState.host +
      framePath +
      "/256/{z}/{x}/{y}/2/1_1.png"
    );
  }

  function setRadarFrame(i) {
    if (!radarState.frames.length) return;
    radarState.idx = ((i % radarState.frames.length) + radarState.frames.length) % radarState.frames.length;
    const frame = radarState.frames[radarState.idx];
    const url = radarTileUrl(frame.path);
    if (radarState.layer) {
      map.removeLayer(radarState.layer);
      radarState.layer = null;
    }
    radarState.layer = L.tileLayer(url, {
      opacity: radarState.opacity,
      zIndex: 300,
      attribution: '<a href="https://www.rainviewer.com/" target="_blank" rel="noopener">RainViewer</a>',
    }).addTo(map);
    const label = $("#radar-time");
    if (label) {
      const d = new Date(frame.time * 1000);
      label.textContent = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    }
  }

  function stopRadar() {
    radarState.playing = false;
    if (radarState.timer) {
      clearInterval(radarState.timer);
      radarState.timer = null;
    }
    const btn = $("#radar-play");
    if (btn) {
      btn.textContent = "▶";
      btn.setAttribute("aria-label", "Play radar");
      btn.title = "Play radar";
    }
  }

  function playRadar() {
    if (radarState.frames.length < 2) return;
    radarState.playing = true;
    const btn = $("#radar-play");
    if (btn) {
      btn.textContent = "❚❚";
      btn.setAttribute("aria-label", "Pause radar");
      btn.title = "Pause radar";
    }
    if (radarState.timer) clearInterval(radarState.timer);
    radarState.timer = setInterval(() => {
      setRadarFrame(radarState.idx + 1);
    }, 500);
  }

  async function loadRadarFrames() {
    const status = $("#radar-status");
    try {
      const res = await fetch("https://api.rainviewer.com/public/weather-maps.json", {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("radar " + res.status);
      const data = await res.json();
      radarState.host = data.host || radarState.host;
      const past = (data.radar && data.radar.past) || [];
      const nowcast = (data.radar && data.radar.nowcast) || [];
      radarState.frames = past.concat(nowcast);
      if (!radarState.frames.length) throw new Error("no frames");
      setRadarFrame(radarState.frames.length - 1);
      if (status) status.textContent = "Radar ready";
    } catch (err) {
      console.warn("radar load failed", err);
      if (status) status.textContent = "Radar unavailable";
    }
  }

  function bindRadarControls() {
    const play = $("#radar-play");
    const toggle = $("#radar-toggle");
    if (toggle) {
      toggle.addEventListener("click", () => {
        const on = toggle.getAttribute("aria-pressed") !== "true";
        toggle.setAttribute("aria-pressed", on ? "true" : "false");
        toggle.classList.toggle("active", on);
        const controls = $("#radar-controls");
        if (controls) controls.hidden = !on;
        if (on) {
          if (!radarState.frames.length) loadRadarFrames();
          else setRadarFrame(radarState.idx);
        } else {
          stopRadar();
          if (radarState.layer) {
            map.removeLayer(radarState.layer);
            radarState.layer = null;
          }
        }
      });
    }
    if (play) {
      play.addEventListener("click", () => {
        if (!radarState.frames.length) return;
        if (radarState.playing) stopRadar();
        else playRadar();
      });
    }
  }

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

  function clearMarkers() {
    if (state.markers) {
      map.removeLayer(state.markers);
      state.markers = null;
    }
  }

  function popupHtml(sn, bridge, tag) {
    const county = state.search.countyName(bridge.county);
    const dir = state.search.parseDirection(bridge.carried);
    const dirBit = dir
      ? '<div class="dir">' + escapeHtml(state.search.directionLabel(dir)) + "</div>"
      : "";
    return (
      '<div class="bridge-popup">' +
      (tag ? '<div class="tag">' + escapeHtml(tag) + "</div>" : "") +
      '<div class="title">' +
      escapeHtml(sn) +
      "</div>" +
      dirBit +
      "<div>" +
      escapeHtml(bridge.carried || "—") +
      " over " +
      escapeHtml(bridge.crossed || "—") +
      "</div><div>" +
      escapeHtml(county) +
      " County</div></div>"
    );
  }

  function showOnMap(sn, bridge, twin) {
    clearMarkers();
    state.markers = L.layerGroup().addTo(map);

    const latlng = [bridge.lat, bridge.lon];
    const main = L.marker(latlng, { icon: pinIcon, zIndexOffset: 600 }).addTo(
      state.markers
    );
    main.bindPopup(popupHtml(sn, bridge, twin ? "Selected" : null));

    const points = [latlng];
    if (twin && twin.bridge) {
      const tll = [twin.bridge.lat, twin.bridge.lon];
      points.push(tll);
      const twinMarker = L.marker(tll, {
        icon: twinPinIcon,
        zIndexOffset: 400,
      }).addTo(state.markers);
      twinMarker.bindPopup(popupHtml(twin.sn, twin.bridge, "Twin"));
      // Short connector so both barrels read as a pair
      L.polyline([latlng, tll], {
        color: "#0b3d91",
        weight: 2,
        opacity: 0.35,
        dashArray: "4 6",
      }).addTo(state.markers);
    }

    main.openPopup();
    invalidateMapSoon();
    if (points.length > 1) {
      map.fitBounds(L.latLngBounds(points).pad(0.55), {
        animate: true,
        maxZoom: 17,
      });
    } else {
      map.setView(latlng, Math.max(map.getZoom(), 15), { animate: true });
    }
  }


  function newListId() {
    return (
      "l" +
      Date.now().toString(36) +
      Math.random().toString(36).slice(2, 8)
    );
  }

  function loadLegacyDailyList() {
    try {
      const raw = localStorage.getItem(DAILY_KEY_LEGACY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((x) => (typeof x === "string" ? x : x && x.sn))
        .filter((s) => typeof s === "string" && s.trim())
        .map((s) => s.trim());
    } catch (_) {
      return [];
    }
  }

  function normalizeStore(store) {
    const lists = [];
    const seen = new Set();
    const rawLists = Array.isArray(store && store.lists) ? store.lists : [];
    for (const item of rawLists) {
      if (!item || typeof item !== "object") continue;
      let id = typeof item.id === "string" && item.id ? item.id : newListId();
      while (seen.has(id)) id = newListId();
      seen.add(id);
      const name =
        typeof item.name === "string" && item.name.trim()
          ? item.name.trim().slice(0, 48)
          : "List";
      const sns = Array.isArray(item.sns)
        ? item.sns
            .map((x) => (typeof x === "string" ? x : x && x.sn))
            .filter((s) => typeof s === "string" && s.trim())
            .map((s) => s.trim())
        : [];
      lists.push({ id, name, sns });
    }
    let viewingId =
      typeof store.viewingId === "string"
        ? store.viewingId
        : typeof store.activeId === "string"
          ? store.activeId
          : null;
    if (viewingId && !lists.some((l) => l.id === viewingId)) viewingId = null;
    return { lists, viewingId };
  }

  function loadDailyStore() {
    try {
      const raw = localStorage.getItem(DAILY_STORE_KEY);
      if (raw) {
        return normalizeStore(JSON.parse(raw));
      }
    } catch (_) {
      /* fall through to migration */
    }
    const legacy = loadLegacyDailyList();
    if (!legacy.length) {
      return { lists: [], viewingId: null };
    }
    const daily = { id: newListId(), name: "Daily", sns: legacy };
    const store = { lists: [daily], viewingId: null, activeId: daily.id };
    try {
      localStorage.setItem(DAILY_STORE_KEY, JSON.stringify(store));
      localStorage.removeItem(DAILY_KEY_LEGACY);
    } catch (_) {
      /* ignore */
    }
    return { lists: [daily], viewingId: null };
  }

  function saveDailyStore() {
    try {
      const payload = {
        lists: state.dailyLists.map((l) => ({
          id: l.id,
          name: l.name,
          sns: l.sns.slice(),
        })),
        viewingId: state.viewingListId,
        activeId: state.viewingListId,
      };
      localStorage.setItem(DAILY_STORE_KEY, JSON.stringify(payload));
    } catch (_) {
      /* ignore quota / private mode */
    }
  }

  function findList(id) {
    return state.dailyLists.find((l) => l.id === id) || null;
  }

  function viewingList() {
    return state.viewingListId ? findList(state.viewingListId) : null;
  }

  function shortLabel(bridge) {
    if (!bridge) return "";
    const carried = bridge.carried || "—";
    const crossed = bridge.crossed || "—";
    return carried + " over " + crossed;
  }

  function setModalNote(msg) {
    const el = $("#list-modal-note");
    if (!el) return;
    if (!msg) {
      el.hidden = true;
      el.textContent = "";
      return;
    }
    el.hidden = false;
    el.textContent = msg;
  }

  let modalIgnoreUntil = 0;
  function armModalIgnore(ms) {
    modalIgnoreUntil = Date.now() + (ms || 450);
  }
  function modalClickIsNoise() {
    return Date.now() < modalIgnoreUntil;
  }

  function lockBodyScroll(lock) {
    document.body.style.overflow = lock ? "hidden" : "";
  }

  function renderDraftList() {
    const draftEl = $("#list-modal-draft");
    const empty = $("#list-modal-draft-empty");
    if (!draftEl || !empty || !state.draft) return;
    const sns = state.draft.sns;
    empty.hidden = sns.length > 0;
    draftEl.innerHTML = sns
      .map(
        (sn) =>
          '<li class="list-modal-draft-item" data-sn="' +
          escapeHtml(sn) +
          '"><span>' +
          escapeHtml(sn) +
          '</span><button type="button" data-draft-remove title="Remove" aria-label="Remove ' +
          escapeHtml(sn) +
          '">✕</button></li>'
      )
      .join("");
    draftEl.querySelectorAll("[data-draft-remove]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const sn = btn.closest("[data-sn]").getAttribute("data-sn");
        state.draft.sns = state.draft.sns.filter((x) => x !== sn);
        setModalNote("Removed " + sn + ".");
        const snInput = $("#list-modal-sn");
        if (snInput && (snInput.value || "").trim()) {
          const raw = snInput.value.trim();
          let match = raw === sn;
          if (!match && state.search) {
            const hit = state.search.lookupExact(raw);
            if (hit && hit.sn === sn) match = true;
          }
          if (match) snInput.value = "";
        }
        renderDraftList();
        focusSnEntry();
      });
    });
  }

  function openListModal(listOrNull) {
    const modal = $("#list-modal");
    const heading = $("#list-modal-heading");
    const titleInput = $("#list-modal-title");
    const snInput = $("#list-modal-sn");
    if (!modal || !titleInput) return;

    if (listOrNull) {
      state.draft = {
        id: listOrNull.id,
        name: listOrNull.name,
        sns: listOrNull.sns.slice(),
      };
      heading.textContent = "Edit list";
      titleInput.value = listOrNull.name;
    } else {
      state.draft = { id: null, name: "", sns: [] };
      heading.textContent = "Create list";
      titleInput.value = "";
    }
    snInput.value = "";
    setModalNote(null);
    renderDraftList();
    armModalIgnore(500);
    modal.hidden = false;
    lockBodyScroll(true);
    setTimeout(() => titleInput.focus(), 50);
  }

  function closeListModal() {
    const modal = $("#list-modal");
    if (!modal) return;
    modal.hidden = true;
    state.draft = null;
    setModalNote(null);
    lockBodyScroll(false);
  }

  function focusSnEntry(select) {
    const snInput = $("#list-modal-sn");
    if (!snInput) return;
    // Keep keyboard up on mobile after +/− (button click would steal focus).
    const run = () => {
      snInput.focus({ preventScroll: true });
      if (select) snInput.select();
    };
    run();
    setTimeout(run, 0);
  }

  function normalizeDraftSn(raw) {
    const s = String(raw || "").trim().toUpperCase();
    if (!s) return "";
    // Prefer inventory canonical form when known.
    if (state.search) {
      const hit = state.search.lookupExact(s);
      if (hit && hit.sn) return hit.sn;
    }
    // Digits-only → CCC-NNNN when possible (0160001 → 016-0001).
    const dig = s.replace(/\D/g, "");
    if (/^\d{7,}$/.test(dig)) {
      return dig.slice(0, 3) + "-" + dig.slice(3, 7);
    }
    return s;
  }

  function draftAddSn() {
    if (!state.draft) return;
    const snInput = $("#list-modal-sn");
    const raw = (snInput.value || "").trim();
    if (!raw) {
      setModalNote("Enter a structure number, then tap +.");
      focusSnEntry();
      return;
    }
    const sn = normalizeDraftSn(raw);
    const known = !!(state.search && state.search.lookupExact(raw));
    if (state.draft.sns.includes(sn)) {
      setModalNote(sn + " is already on this list.");
      snInput.value = "";
      focusSnEntry();
      return;
    }
    state.draft.sns.push(sn);
    snInput.value = "";
    setModalNote(
      known
        ? "Added " + sn + "."
        : "Added " + sn + " (not in inventory — Navigate may be limited)."
    );
    renderDraftList();
    focusSnEntry();
  }

  function draftRemoveSn() {
    if (!state.draft) return;
    const snInput = $("#list-modal-sn");
    const raw = (snInput.value || "").trim();
    if (!raw) {
      // Empty entry: remove the last SN in the draft list (quick undo).
      if (!state.draft.sns.length) {
        setModalNote("Enter a structure number to remove, or tap ✕ on a draft item.");
        focusSnEntry();
        return;
      }
      const last = state.draft.sns.pop();
      setModalNote("Removed " + last + ".");
      renderDraftList();
      focusSnEntry();
      return;
    }
    let target = raw;
    if (state.search) {
      const hit = state.search.lookupExact(raw);
      if (hit) target = hit.sn;
    }
    const before = state.draft.sns.length;
    state.draft.sns = state.draft.sns.filter(
      (sn) => sn !== target && sn.toLowerCase() !== raw.toLowerCase()
    );
    if (state.draft.sns.length === before) {
      setModalNote("“" + raw + "” isn’t on this draft list.");
      focusSnEntry(true);
      return;
    }
    snInput.value = "";
    setModalNote("Removed " + target + ".");
    renderDraftList();
    focusSnEntry();
  }

  function saveDraftList() {
    if (!state.draft) return;
    const titleInput = $("#list-modal-title");
    let name = String(titleInput.value || "").trim().slice(0, 48);
    if (!name) {
      name = state.draft.sns.length
        ? "List (" + state.draft.sns.length + " SN" + (state.draft.sns.length === 1 ? "" : "s") + ")"
        : "Untitled list";
      titleInput.value = name;
      setModalNote("Saved as “" + name + "”. You can Edit to rename.");
    }
    state.draft.name = name;
    let savedId = state.draft.id;
    if (state.draft.id) {
      const existing = findList(state.draft.id);
      if (existing) {
        existing.name = name;
        existing.sns = state.draft.sns.slice();
      } else {
        state.dailyLists.push({
          id: state.draft.id,
          name,
          sns: state.draft.sns.slice(),
        });
      }
    } else {
      const list = {
        id: newListId(),
        name,
        sns: state.draft.sns.slice(),
      };
      state.dailyLists.push(list);
      savedId = list.id;
    }
    // Return to main Lists screen so the saved name is visible.
    state.viewingListId = null;
    saveDailyStore();
    closeListModal();
    renderListsUI();
    openListsPicker();
    const note = $("#lists-save-toast");
    if (note) {
      note.hidden = false;
      note.textContent = "Saved “" + name + "”.";
      setTimeout(() => {
        note.hidden = true;
      }, 2500);
    }
  }

  function deleteDraftList() {
    if (!state.draft) return;
    if (!state.draft.id) {
      // Unsaved create — just discard
      closeListModal();
      return;
    }
    const list = findList(state.draft.id);
    const name = (list && list.name) || state.draft.name || "this list";
    const count = list ? list.sns.length : state.draft.sns.length;
    if (count > 0) {
      if (
        !confirm(
          "Delete list “" +
            name +
            "” (" +
            count +
            " structure number" +
            (count === 1 ? "" : "s") +
            ")?"
        )
      ) {
        return;
      }
    } else if (!confirm("Delete empty list “" + name + "”?")) {
      return;
    }
    const id = state.draft.id;
    state.dailyLists = state.dailyLists.filter((l) => l.id !== id);
    if (state.viewingListId === id) state.viewingListId = null;
    saveDailyStore();
    closeListModal();
    closeListViewer();
    renderListsUI();
    openListsPicker();
  }

  function openListDetail(id) {
    if (!findList(id)) return;
    state.viewingListId = id;
    saveDailyStore();
    renderListsUI();
  }

  function backToListsHome() {
    state.viewingListId = null;
    saveDailyStore();
    renderListsUI();
  }



  function closeListsPicker() {
    const picker = $("#lists-picker");
    if (!picker) return;
    picker.hidden = true;
    if ($("#list-viewer") && $("#list-viewer").hidden) lockBodyScroll(false);
  }

  function closeListViewer() {
    const viewer = $("#list-viewer");
    if (!viewer) return;
    viewer.hidden = true;
    if ($("#lists-picker") && $("#lists-picker").hidden) lockBodyScroll(false);
  }

  function openListViewer(id) {
    const list = findList(id);
    const viewer = $("#list-viewer");
    if (!list || !viewer) return;
    state.viewingListId = id;
    saveDailyStore();
    const heading = $("#list-viewer-heading");
    const items = $("#list-viewer-items");
    const empty = $("#list-viewer-empty");
    if (heading) heading.textContent = list.name;
    if (!items || !empty) return;
    empty.hidden = list.sns.length > 0;
    items.innerHTML = list.sns
      .map((sn) => {
        const hit = state.search ? state.search.lookupExact(sn) : null;
        const bridge = hit ? hit.bridge : null;
        const label = bridge ? shortLabel(bridge) : "Not in inventory";
        const navDisabled = bridge ? "" : " disabled";
        return (
          '<li><div class="daily-item" data-viewer-sn="' +
          escapeHtml(sn) +
          '"><div class="daily-item-sn">' +
          escapeHtml(sn) +
          '</div><div class="daily-item-label">' +
          escapeHtml(label) +
          '</div><div class="daily-item-actions">' +
          '<button type="button" class="btn secondary" data-viewer-show="' +
          escapeHtml(sn) +
          '">Show</button>' +
          '<button type="button" class="btn primary" data-viewer-nav="' +
          escapeHtml(sn) +
          '"' +
          navDisabled +
          ">Navigate</button>" +
          "</div></div></li>"
        );
      })
      .join("");
    closeListsPicker();
    armModalIgnore(500);
    viewer.hidden = false;
    lockBodyScroll(true);
  }

  function renderListsPicker() {
    const ul = $("#lists-picker-items");
    const empty = $("#lists-picker-empty");
    if (!ul || !empty) return;
    empty.hidden = state.dailyLists.length > 0;
    ul.innerHTML = state.dailyLists
      .map((list) => {
        const n = list.sns.length;
        return (
          '<li><button type="button" class="saved-list-btn" data-pick-list="' +
          escapeHtml(list.id) +
          '"><span class="saved-list-name">' +
          escapeHtml(list.name) +
          '</span><span class="saved-list-meta">' +
          n +
          " SN" +
          (n === 1 ? "" : "s") +
          "</span></button></li>"
        );
      })
      .join("");
  }

  function openListsPicker() {
    const picker = $("#lists-picker");
    if (!picker) return;
    closeListViewer();
    renderListsPicker();
    armModalIgnore(500);
    picker.hidden = false;
    lockBodyScroll(true);
  }

  function ensureListsPanelOpen() {
    const panel = $("#daily-list");
    const toggle = $("#daily-toggle");
    if (!panel) return;
    panel.classList.add("open");
    if (toggle) toggle.setAttribute("aria-expanded", "true");
    try {
      localStorage.setItem(DAILY_OPEN_KEY, "1");
    } catch (_) {}
    try {
      panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (_) {}
  }

  function renderSavedLists() {
    const ul = $("#saved-lists");
    const empty = $("#lists-empty");
    const count = $("#daily-count");
    if (!ul || !empty || !count) return;

    count.textContent = String(state.dailyLists.length);
    count.title =
      state.dailyLists.length +
      " saved list" +
      (state.dailyLists.length === 1 ? "" : "s");
    empty.hidden = state.dailyLists.length > 0;

    ul.innerHTML = state.dailyLists
      .map((list) => {
        const n = list.sns.length;
        return (
          '<li><button type="button" class="saved-list-btn" data-open-list="' +
          escapeHtml(list.id) +
          '"><span class="saved-list-name">' +
          escapeHtml(list.name) +
          '</span><span class="saved-list-meta">' +
          n +
          " SN" +
          (n === 1 ? "" : "s") +
          "</span></button></li>"
        );
      })
      .join("");

    ul.querySelectorAll("[data-open-list]").forEach((btn) => {
      btn.addEventListener("click", () => {
        openListDetail(btn.getAttribute("data-open-list"));
      });
    });
  }

  function renderListDetail() {
    const list = viewingList();
    const title = $("#list-detail-title");
    const count = $("#list-detail-count");
    const items = $("#list-detail-items");
    const empty = $("#list-detail-empty");
    if (!title || !items || !empty) return;
    if (!list) {
      items.innerHTML = "";
      return;
    }

    title.textContent = list.name;
    if (count) count.textContent = String(list.sns.length);
    empty.hidden = list.sns.length > 0;

    items.innerHTML = list.sns
      .map((sn) => {
        const hit = state.search ? state.search.lookupExact(sn) : null;
        const bridge = hit ? hit.bridge : null;
        const label = bridge ? shortLabel(bridge) : "Not in inventory";
        const active = state.selectedSn === sn ? " active" : "";
        return (
          '<li><button type="button" class="daily-item' +
          active +
          '" data-sn="' +
          escapeHtml(sn) +
          '"><div class="daily-item-sn">' +
          escapeHtml(sn) +
          '</div><div class="daily-item-label">' +
          escapeHtml(label) +
          "</div></button></li>"
        );
      })
      .join("");

    items.querySelectorAll(".daily-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        const sn = btn.getAttribute("data-sn");
        const hit = state.search && state.search.lookupExact(sn);
        if (hit) select(hit.sn, hit.bridge);
        else setStatus("“" + sn + "” is not in the inventory.", "error");
      });
    });
  }

  function renderListsUI() {
    const home = $("#lists-home");
    const detail = $("#list-detail");
    if (!home || !detail) return;

    const list = viewingList();
    if (list) {
      home.hidden = true;
      detail.hidden = false;
      renderListDetail();
    } else {
      home.hidden = false;
      detail.hidden = true;
      state.viewingListId = null;
      renderSavedLists();
    }
  }

  // Back-compat alias used by select()
  function renderDailyList() {
    renderListsUI();
  }

  function bindDailyList() {
    const panel = $("#daily-list");
    const toggle = $("#daily-toggle");
    const createBtn = $("#list-create-btn");
    const backBtn = $("#list-back-btn");
    const editBtn = $("#list-edit-btn");
    const modal = $("#list-modal");
    const saveBtn = $("#list-modal-save");
    const deleteBtn = $("#list-modal-delete");
    const addBtn = $("#list-modal-add");
    const removeBtn = $("#list-modal-remove");
    const snInput = $("#list-modal-sn");
    const titleInput = $("#list-modal-title");

    let open = true;
    try {
      const stored = localStorage.getItem(DAILY_OPEN_KEY);
      if (stored === "0") open = false;
      if (stored === "1") open = true;
    } catch (_) {
      /* ignore */
    }
    // Keep Lists collapsed on load so Create list isn't clipped in the
    // short phone sidebar; tap Lists for the full-screen sheet.
    open = false;
    panel.classList.toggle("open", open);
    toggle.setAttribute("aria-expanded", open ? "true" : "false");

    toggle.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openListsPicker();
    });

    if (createBtn) {
      createBtn.addEventListener("click", () => openListModal(null));
    }
    const pickerCreate = $("#lists-picker-create");
    if (pickerCreate) {
      pickerCreate.addEventListener("click", () => {
        closeListsPicker();
        openListModal(null);
      });
    }
    document.querySelectorAll("[data-lists-picker-dismiss]").forEach((el) => {
      el.addEventListener("click", (e) => {
        if (modalClickIsNoise()) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        closeListsPicker();
      });
    });
    const pickerItems = $("#lists-picker-items");
    if (pickerItems && !pickerItems.dataset.bound) {
      pickerItems.dataset.bound = "1";
      pickerItems.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-pick-list]");
        if (!btn || !pickerItems.contains(btn)) return;
        e.preventDefault();
        e.stopPropagation();
        openListViewer(btn.getAttribute("data-pick-list"));
      });
    }
    const viewerItems = $("#list-viewer-items");
    if (viewerItems && !viewerItems.dataset.bound) {
      viewerItems.dataset.bound = "1";
      viewerItems.addEventListener("click", (e) => {
        const nav = e.target.closest("[data-viewer-nav]");
        const show = e.target.closest("[data-viewer-show]");
        const sn = (nav || show) && (nav || show).getAttribute(nav ? "data-viewer-nav" : "data-viewer-show");
        if (!sn) return;
        e.preventDefault();
        const hit = state.search && state.search.lookupExact(sn);
        if (!hit) {
          setStatus("“" + sn + "” is not in the inventory.", "error");
          return;
        }
        if (nav) {
          const dest = state.search.navigateDestination
            ? state.search.navigateDestination(hit.sn, hit.bridge)
            : { lat: hit.bridge.lat, lon: hit.bridge.lon };
          const url = mapsDirUrl(dest.lat, dest.lon);
          window.open(url, "_blank", "noopener");
        } else {
          closeListViewer();
          select(hit.sn, hit.bridge);
        }
      });
    }
    const viewerBack = $("#list-viewer-back");
    if (viewerBack) {
      viewerBack.addEventListener("click", () => {
        closeListViewer();
        openListsPicker();
      });
    }
    const viewerEdit = $("#list-viewer-edit");
    if (viewerEdit) {
      viewerEdit.addEventListener("click", () => {
        const list = viewingList();
        if (!list) return;
        closeListViewer();
        openListModal(list);
      });
    }
    document.querySelectorAll("[data-list-viewer-dismiss]").forEach((el) => {
      el.addEventListener("click", (e) => {
        if (modalClickIsNoise()) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        closeListViewer();
      });
    });

    if (backBtn) {
      backBtn.addEventListener("click", () => backToListsHome());
    }
    if (editBtn) {
      editBtn.addEventListener("click", () => {
        const list = viewingList();
        if (list) openListModal(list);
      });
    }

    if (modal) {
      modal.querySelectorAll("[data-list-modal-dismiss]").forEach((el) => {
        el.addEventListener("click", (e) => {
          if (modalClickIsNoise()) {
            e.preventDefault();
            e.stopPropagation();
            return;
          }
          closeListModal();
        });
      });
    }
    bindPm(saveBtn, saveDraftList);
    if (deleteBtn) {
      deleteBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        deleteDraftList();
      });
    }
    // Use pointerup as primary on mobile; guard against double-firing with click.
    function bindPm(btn, fn) {
      if (!btn) return;
      let last = 0;
      const run = () => {
        const now = Date.now();
        if (now - last < 400) return;
        last = now;
        fn();
      };
      btn.addEventListener("pointerup", (e) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        run();
      });
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        run();
      });
    }
    bindPm(addBtn, draftAddSn);
    bindPm(removeBtn, draftRemoveSn);

    if (snInput) {
      snInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          draftAddSn();
        }
      });
    }
    if (titleInput) {
      titleInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          if (snInput) snInput.focus();
        }
      });
    }

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && state.draft) {
        e.preventDefault();
        closeListModal();
      }
    });

    const store = loadDailyStore();
    state.dailyLists = store.lists;
    state.viewingListId = store.viewingId;
    renderListsUI();
  }

  function renderResult(sn, bridge) {
    const host = $("#result");
    if (!bridge) {
      host.innerHTML = "";
      clearMarkers();
      return;
    }
    const county = state.search.countyName(bridge.county);
    const dir = state.search.parseDirection(bridge.carried);
    const twin = state.search.findTwin(sn);
    const dest = state.search.navigateDestination(sn, bridge);
    const dirUrl = mapsDirUrl(dest.lat, dest.lon);
    const focus = mapsSearchUrl(bridge.lat, bridge.lon);

    let dirRow = "";
    if (dir) {
      dirRow =
        '<div class="row"><div class="k">Direction</div><div class="v"><span class="dir-badge">' +
        escapeHtml(dir) +
        "</span> " +
        escapeHtml(state.search.directionLabel(dir)) +
        "</div></div>";
    }

    let twinBlock = "";
    if (twin) {
      const twinDir = state.search.parseDirection(twin.bridge.carried);
      const twinLabel =
        twin.sn +
        (twin.bridge.carried ? " " + twin.bridge.carried : twinDir ? " " + twinDir : "");
      twinBlock =
        '<div class="twin-row">' +
        '<span class="twin-label">Also:</span> ' +
        '<button type="button" class="twin-link" data-twin-sn="' +
        escapeHtml(twin.sn) +
        '">' +
        escapeHtml(twinLabel) +
        "</button></div>";
    }

    let biasNote = "";
    if (dest.biased) {
      biasNote =
        '<div class="bias-note">Navigate aims ~60 m along ' +
        escapeHtml(dir || "travel") +
        " so Maps prefers this barrel.</div>";
    }

    host.innerHTML =
      '<article class="card">' +
      "<h2>" +
      escapeHtml(sn) +
      "</h2>" +
      dirRow +
      twinBlock +
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
      (dest.biased
        ? '<div class="coord-sub">Navigate → ' + dest.lat + ", " + dest.lon + "</div>"
        : "") +
      "</div></div>" +
      biasNote +
      '<div class="actions">' +
      '<a class="btn primary" data-nav href="' +
      dirUrl +
      '" target="_blank" rel="noopener">Navigate</a>' +
      '<a class="btn secondary" href="' +
      focus +
      '" target="_blank" rel="noopener">Open in Maps</a>' +
      "</div></article>";

    const twinBtn = host.querySelector("[data-twin-sn]");
    if (twinBtn) {
      twinBtn.addEventListener("click", () => {
        const tsn = twinBtn.getAttribute("data-twin-sn");
        const hit = state.search.lookupExact(tsn);
        if (hit) select(hit.sn, hit.bridge);
      });
    }

    showOnMap(sn, bridge, twin);
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
    state.selectedSn = sn;
    $("#suggest").classList.remove("open");
    input.setAttribute("aria-expanded", "false");
    input.blur();
    setStatus(null);
    renderResult(sn, bridge);
    renderDailyList();
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


  async function forceFreshBuildIfNeeded() {
    let prev = null;
    try {
      prev = localStorage.getItem(APP_BUILD_KEY);
    } catch (_) {}
    const verEl = document.getElementById("app-version");
    if (verEl) verEl.textContent = APP_BUILD;
    if (prev === APP_BUILD) return false;
    try {
      localStorage.setItem(APP_BUILD_KEY, APP_BUILD);
    } catch (_) {}
    try {
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
      if (window.caches && caches.keys) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch (err) {
      console.warn("cache clear failed", err);
    }
    const url = new URL(location.href);
    url.searchParams.set("v", APP_BUILD);
    location.replace(url.toString());
    return true;
  }

  function registerWorker() {
    if (!("serviceWorker" in navigator)) return;
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("./sw.js?v=v17")
        .then((reg) => {
          try {
            reg.update();
          } catch (_) {}
        })
        .catch((err) => {
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
    if (await forceFreshBuildIfNeeded()) return;
    bindInstallHelp();
    bindDailyList();
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
      // Re-resolve saved list SNs to canonical forms when known; keep unknowns.
      for (const list of state.dailyLists) {
        const resolved = [];
        for (const sn of list.sns) {
          const hit = state.search.lookupExact(sn);
          const out = hit ? hit.sn : sn;
          if (!resolved.includes(out)) resolved.push(out);
        }
        list.sns = resolved;
      }
      saveDailyStore();
      renderDailyList();
      $("#footer").innerHTML =
        "<strong>" +
        state.search.count.toLocaleString() +
        "</strong> Illinois bridges · " +
        (state.search.twinPairCount
          ? "<strong>" +
            state.search.twinPairCount.toLocaleString() +
            "</strong> twin pairs · "
          : "") +
        "FHWA NBI " +
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

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => init());
  } else {
    init();
  }
})();
