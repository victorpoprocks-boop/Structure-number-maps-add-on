(() => {
  "use strict";

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
    activeListId: null,
    selectedSn: null,
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
    if (!lists.length) {
      const daily = { id: newListId(), name: "Daily", sns: [] };
      return { lists: [daily], activeId: daily.id };
    }
    let activeId =
      typeof store.activeId === "string" ? store.activeId : lists[0].id;
    if (!lists.some((l) => l.id === activeId)) activeId = lists[0].id;
    return { lists, activeId };
  }

  function loadDailyStore() {
    try {
      const raw = localStorage.getItem(DAILY_STORE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return normalizeStore(parsed);
      }
    } catch (_) {
      /* fall through to migration */
    }
    const legacy = loadLegacyDailyList();
    const daily = { id: newListId(), name: "Daily", sns: legacy };
    const store = { lists: [daily], activeId: daily.id };
    try {
      localStorage.setItem(DAILY_STORE_KEY, JSON.stringify(store));
      if (legacy.length) localStorage.removeItem(DAILY_KEY_LEGACY);
    } catch (_) {
      /* ignore */
    }
    return store;
  }

  function saveDailyStore() {
    try {
      const payload = {
        lists: state.dailyLists.map((l) => ({
          id: l.id,
          name: l.name,
          sns: l.sns.slice(),
        })),
        activeId: state.activeListId,
      };
      localStorage.setItem(DAILY_STORE_KEY, JSON.stringify(payload));
    } catch (_) {
      /* ignore quota / private mode */
    }
  }

  function activeList() {
    return (
      state.dailyLists.find((l) => l.id === state.activeListId) ||
      state.dailyLists[0] ||
      null
    );
  }

  function activeSns() {
    const list = activeList();
    return list ? list.sns : [];
  }

  function shortLabel(bridge) {
    if (!bridge) return "";
    const carried = bridge.carried || "—";
    const crossed = bridge.crossed || "—";
    return carried + " over " + crossed;
  }

  function setDailyNote(msg) {
    const el = $("#daily-note");
    if (!msg) {
      el.hidden = true;
      el.textContent = "";
      return;
    }
    el.hidden = false;
    el.textContent = msg;
  }

  function promptListName(title, initial) {
    const raw = window.prompt(title, initial || "");
    if (raw === null) return null;
    const name = String(raw).trim().slice(0, 48);
    if (!name) {
      setDailyNote("List name can’t be empty.");
      return null;
    }
    return name;
  }

  function setActiveList(id) {
    if (!state.dailyLists.some((l) => l.id === id)) return;
    state.activeListId = id;
    saveDailyStore();
    setDailyNote(null);
    renderDailyList();
  }

  function createNamedList() {
    const name = promptListName("Name for the new list:", "");
    if (!name) return;
    const list = { id: newListId(), name, sns: [] };
    state.dailyLists.push(list);
    state.activeListId = list.id;
    saveDailyStore();
    setDailyNote("Created “" + name + "”.");
    renderDailyList();
  }

  function renameActiveList() {
    const list = activeList();
    if (!list) return;
    const name = promptListName("Rename list:", list.name);
    if (!name) return;
    list.name = name;
    saveDailyStore();
    setDailyNote("Renamed to “" + name + "”.");
    renderDailyList();
  }

  function deleteActiveList() {
    const list = activeList();
    if (!list) return;
    if (state.dailyLists.length <= 1) {
      if (
        !confirm(
          "This is your only list. Clear all items from “" + list.name + "”?"
        )
      ) {
        return;
      }
      list.sns = [];
      list.name = "Daily";
      saveDailyStore();
      setDailyNote("List cleared.");
      renderDailyList();
      return;
    }
    if (
      !confirm(
        "Delete list “" +
          list.name +
          "” (" +
          list.sns.length +
          " item" +
          (list.sns.length === 1 ? "" : "s") +
          ")?"
      )
    ) {
      return;
    }
    const idx = state.dailyLists.findIndex((l) => l.id === list.id);
    state.dailyLists.splice(idx, 1);
    state.activeListId = state.dailyLists[Math.max(0, idx - 1)].id;
    saveDailyStore();
    setDailyNote("Deleted “" + list.name + "”.");
    renderDailyList();
  }

  function addSnsToDaily(rawText) {
    if (!state.search) return;
    const list = activeList();
    if (!list) return;
    const lines = String(rawText || "")
      .split(/[\n,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!lines.length) {
      setDailyNote("Type or paste at least one structure number.");
      return;
    }
    const added = [];
    const skipped = [];
    const already = [];
    for (const line of lines) {
      const hit = state.search.lookupExact(line);
      if (!hit) {
        skipped.push(line);
        continue;
      }
      if (list.sns.includes(hit.sn)) {
        already.push(hit.sn);
        continue;
      }
      list.sns.push(hit.sn);
      added.push(hit.sn);
    }
    saveDailyStore();
    renderDailyList();
    const bits = [];
    if (added.length) bits.push("Added " + added.length + " to “" + list.name + "”.");
    if (already.length) bits.push(already.length + " already on list.");
    if (skipped.length) {
      bits.push(
        "Skipped " +
          skipped.length +
          " unknown: " +
          skipped.slice(0, 4).join(", ") +
          (skipped.length > 4 ? "…" : "")
      );
    }
    setDailyNote(bits.join(" ") || null);
    return { added, skipped, already };
  }

  function removeFromDaily(sn) {
    const list = activeList();
    if (!list) return;
    list.sns = list.sns.filter((x) => x !== sn);
    saveDailyStore();
    renderDailyList();
  }

  function clearDailyList() {
    const list = activeList();
    if (!list || !list.sns.length) return;
    if (
      !confirm(
        "Clear “" + list.name + "” (" + list.sns.length + " items)?"
      )
    ) {
      return;
    }
    list.sns = [];
    saveDailyStore();
    setDailyNote(null);
    renderDailyList();
  }

  function moveDaily(sn, dir) {
    const list = activeList();
    if (!list) return;
    const i = list.sns.indexOf(sn);
    if (i < 0) return;
    const j = i + dir;
    if (j < 0 || j >= list.sns.length) return;
    const tmp = list.sns[i];
    list.sns[i] = list.sns[j];
    list.sns[j] = tmp;
    saveDailyStore();
    renderDailyList();
  }

  function renderDailyTabs() {
    const tabs = $("#daily-tabs");
    if (!tabs) return;
    tabs.innerHTML = state.dailyLists
      .map((list) => {
        const selected = list.id === state.activeListId;
        return (
          '<button type="button" role="tab" class="daily-tab" data-list-id="' +
          escapeHtml(list.id) +
          '" aria-selected="' +
          (selected ? "true" : "false") +
          '" title="' +
          escapeHtml(list.name) +
          '"><span class="daily-tab-name">' +
          escapeHtml(list.name) +
          '</span><span class="daily-tab-count">' +
          list.sns.length +
          "</span></button>"
        );
      })
      .join("");
    tabs.querySelectorAll(".daily-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        setActiveList(btn.getAttribute("data-list-id"));
      });
    });
    const activeBtn = tabs.querySelector('.daily-tab[aria-selected="true"]');
    if (activeBtn && typeof activeBtn.scrollIntoView === "function") {
      activeBtn.scrollIntoView({
        inline: "nearest",
        block: "nearest",
        behavior: "smooth",
      });
    }
  }

  function renderDailyList() {
    const listEl = $("#daily-items");
    const empty = $("#daily-empty");
    const count = $("#daily-count");
    const clearBtn = $("#daily-clear");
    const heading = $("#daily-list-heading");
    const addBtn = $("#daily-add-btn");
    if (!listEl || !empty || !count) return;

    const list = activeList();
    const sns = list ? list.sns : [];
    const listName = list ? list.name : "List";

    if (heading) heading.textContent = "Lists";
    count.textContent = String(sns.length);
    count.title = listName + ": " + sns.length + " item" + (sns.length === 1 ? "" : "s");
    if (clearBtn) clearBtn.hidden = sns.length === 0;
    if (addBtn) addBtn.textContent = "Add to “" + listName + "”";
    empty.hidden = sns.length > 0;
    empty.textContent =
      "“" +
      listName +
      "” is empty — add from a search result or paste above. Tap an SN to search it.";

    renderDailyTabs();

    if (!sns.length) {
      listEl.innerHTML = "";
      return;
    }

    listEl.innerHTML = sns
      .map((sn, i) => {
        const hit = state.search ? state.search.lookupExact(sn) : null;
        const bridge = hit ? hit.bridge : null;
        const label = bridge ? shortLabel(bridge) : "Not in inventory";
        const active = state.selectedSn === sn ? " active" : "";
        const dest =
          bridge && state.search
            ? state.search.navigateDestination(sn, bridge)
            : null;
        const navHref = dest ? mapsDirUrl(dest.lat, dest.lon) : "#";
        return (
          '<li class="daily-item' +
          active +
          '" data-sn="' +
          escapeHtml(sn) +
          '">' +
          '<div class="daily-item-main">' +
          '<div class="daily-item-reorder">' +
          '<button type="button" class="daily-icon-btn" data-daily-up title="Move up"' +
          (i === 0 ? " disabled" : "") +
          ">▲</button>" +
          '<button type="button" class="daily-icon-btn" data-daily-down title="Move down"' +
          (i === sns.length - 1 ? " disabled" : "") +
          ">▼</button>" +
          "</div>" +
          '<button type="button" class="daily-item-text" data-daily-select title="Search this structure number">' +
          '<div class="daily-item-sn">' +
          escapeHtml(sn) +
          '</div><div class="daily-item-label">' +
          escapeHtml(label) +
          "</div></button></div>" +
          '<div class="daily-item-actions">' +
          (bridge
            ? '<a class="btn primary tiny" data-daily-nav href="' +
              navHref +
              '" target="_blank" rel="noopener">Navigate</a>'
            : "") +
          '<button type="button" class="btn secondary tiny" data-daily-select>Search</button>' +
          '<button type="button" class="btn tiny danger" data-daily-remove title="Remove">✕</button>' +
          "</div></li>"
        );
      })
      .join("");

    listEl.querySelectorAll(".daily-item").forEach((row) => {
      const sn = row.getAttribute("data-sn");
      row.querySelectorAll("[data-daily-select]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const hit = state.search && state.search.lookupExact(sn);
          if (hit) select(hit.sn, hit.bridge);
          else setDailyNote("“" + sn + "” is not in the inventory.");
        });
      });
      const up = row.querySelector("[data-daily-up]");
      if (up) up.addEventListener("click", () => moveDaily(sn, -1));
      const down = row.querySelector("[data-daily-down]");
      if (down) down.addEventListener("click", () => moveDaily(sn, 1));
      const rm = row.querySelector("[data-daily-remove]");
      if (rm) rm.addEventListener("click", () => removeFromDaily(sn));
    });
  }

  function bindDailyList() {
    const panel = $("#daily-list");
    const toggle = $("#daily-toggle");
    const addBtn = $("#daily-add-btn");
    const addInput = $("#daily-add");
    const clearBtn = $("#daily-clear");
    const newBtn = $("#daily-new-list");
    const renameBtn = $("#daily-rename-list");
    const deleteBtn = $("#daily-delete-list");

    let open = true;
    try {
      const stored = localStorage.getItem(DAILY_OPEN_KEY);
      if (stored === "0") open = false;
      if (stored === "1") open = true;
    } catch (_) {
      /* ignore */
    }
    panel.classList.toggle("open", open);
    toggle.setAttribute("aria-expanded", open ? "true" : "false");

    toggle.addEventListener("click", () => {
      open = !panel.classList.contains("open");
      panel.classList.toggle("open", open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      try {
        localStorage.setItem(DAILY_OPEN_KEY, open ? "1" : "0");
      } catch (_) {
        /* ignore */
      }
    });

    addBtn.addEventListener("click", () => {
      const result = addSnsToDaily(addInput.value);
      if (result && result.added.length) addInput.value = "";
    });
    addInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        addBtn.click();
      }
    });
    clearBtn.addEventListener("click", () => clearDailyList());
    if (newBtn) newBtn.addEventListener("click", () => createNamedList());
    if (renameBtn) renameBtn.addEventListener("click", () => renameActiveList());
    if (deleteBtn) deleteBtn.addEventListener("click", () => deleteActiveList());

    const store = loadDailyStore();
    state.dailyLists = store.lists;
    state.activeListId = store.activeId;
    // Re-canonicalize against inventory once search is ready (done in init)
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
      '<button type="button" class="btn secondary tiny" data-add-daily>Add to list</button>' +
      "</div></article>";

    const twinBtn = host.querySelector("[data-twin-sn]");
    if (twinBtn) {
      twinBtn.addEventListener("click", () => {
        const tsn = twinBtn.getAttribute("data-twin-sn");
        const hit = state.search.lookupExact(tsn);
        if (hit) select(hit.sn, hit.bridge);
      });
    }

    const addDailyBtn = host.querySelector("[data-add-daily]");
    if (addDailyBtn) {
      const list = activeList();
      const listName = list ? list.name : "list";
      const onList = list ? list.sns.includes(sn) : false;
      addDailyBtn.textContent = onList
        ? "On “" + listName + "”"
        : "Add to “" + listName + "”";
      if (onList) addDailyBtn.disabled = true;
      addDailyBtn.addEventListener("click", () => {
        addSnsToDaily(sn);
        const cur = activeList();
        const curName = cur ? cur.name : listName;
        addDailyBtn.textContent = "On “" + curName + "”";
        addDailyBtn.disabled = true;
        const panel = $("#daily-list");
        if (panel && !panel.classList.contains("open")) {
          panel.classList.add("open");
          $("#daily-toggle").setAttribute("aria-expanded", "true");
        }
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
      // Re-resolve saved list SNs to canonical forms; drop unknowns quietly
      let dropped = 0;
      for (const list of state.dailyLists) {
        const resolved = [];
        for (const sn of list.sns) {
          const hit = state.search.lookupExact(sn);
          if (hit) {
            if (!resolved.includes(hit.sn)) resolved.push(hit.sn);
          } else {
            dropped += 1;
          }
        }
        list.sns = resolved;
      }
      saveDailyStore();
      renderDailyList();
      if (dropped) {
        setDailyNote(
          "Removed " +
            dropped +
            " unknown SN" +
            (dropped === 1 ? "" : "s") +
            " from saved lists."
        );
      }
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

  init();
})();
