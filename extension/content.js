(() => {
  "use strict";
  if (window.__IL_BRIDGE_MAPS_LOADED__) return;
  window.__IL_BRIDGE_MAPS_LOADED__ = true;

  const STATE = {
    search: null,
    activeIdx: -1,
    suggestions: [],
    current: null,
  };

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      Object.entries(attrs).forEach(([k, v]) => {
        if (k === "className") node.className = v;
        else if (k === "text") node.textContent = v;
        else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v);
        else if (v !== null && v !== undefined) node.setAttribute(k, v);
      });
    }
    (children || []).forEach((c) => {
      if (c == null) return;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }

  function buildUI() {
    const root = el("div", { id: "il-bridge-root" });
    root.innerHTML = `
      <div class="ilb-card">
        <div class="ilb-header" data-drag>
          <div class="ilb-badge">IL</div>
          <div class="ilb-title">Bridge Finder<small>NBI / IDOT structure #</small></div>
          <button class="ilb-icon-btn" type="button" data-collapse title="Collapse">–</button>
        </div>
        <div class="ilb-body">
          <div class="ilb-search-wrap">
            <input class="ilb-input" type="text" placeholder="e.g. 016-0001 or 0160001"
              autocomplete="off" spellcheck="false" data-input />
            <div class="ilb-suggest" data-suggest></div>
          </div>
          <div class="ilb-hint">Dashes &amp; leading zeros optional · typeahead as you type</div>
          <div class="ilb-status loading" data-status>Loading Illinois bridge inventory…</div>
          <div data-result></div>
          <div class="ilb-footer" data-footer></div>
        </div>
      </div>
    `;
    document.documentElement.appendChild(root);
    enableDrag(root);
    return root;
  }

  function enableDrag(root) {
    const handle = root.querySelector("[data-drag]");
    let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;
    handle.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button")) return;
      dragging = true;
      const rect = root.getBoundingClientRect();
      ox = rect.left; oy = rect.top; sx = e.clientX; sy = e.clientY;
      handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const nx = Math.max(8, Math.min(window.innerWidth - 40, ox + (e.clientX - sx)));
      const ny = Math.max(8, Math.min(window.innerHeight - 40, oy + (e.clientY - sy)));
      root.style.left = nx + "px";
      root.style.top = ny + "px";
      root.style.right = "auto";
    });
    handle.addEventListener("pointerup", () => { dragging = false; });
  }

  function setStatus(root, msg, kind) {
    const s = root.querySelector("[data-status]");
    if (!msg) { s.style.display = "none"; return; }
    s.style.display = "block";
    s.className = "ilb-status" + (kind ? " " + kind : "");
    s.textContent = msg;
  }

  function renderResult(root, sn, bridge) {
    const host = root.querySelector("[data-result]");
    if (!bridge) { host.innerHTML = ""; return; }
    const county = STATE.search.countyName(bridge.county);
    host.innerHTML = "";
    const box = el("div", { className: "ilb-result" }, [
      el("div", { className: "ilb-sn", text: sn }),
      el("div", { className: "ilb-row" }, [
        el("div", { className: "k", text: "Carried" }),
        el("div", { className: "v", text: bridge.carried || "—" }),
      ]),
      el("div", { className: "ilb-row" }, [
        el("div", { className: "k", text: "Crossed" }),
        el("div", { className: "v", text: bridge.crossed || "—" }),
      ]),
      el("div", { className: "ilb-row" }, [
        el("div", { className: "k", text: "County" }),
        el("div", { className: "v", text: county + (bridge.county ? " (" + bridge.county + ")" : "") }),
      ]),
      el("div", { className: "ilb-row" }, [
        el("div", { className: "k", text: "Location" }),
        el("div", { className: "v", text: bridge.loc || "—" }),
      ]),
      el("div", { className: "ilb-row" }, [
        el("div", { className: "k", text: "Coords" }),
        el("div", { className: "v", text: bridge.lat + ", " + bridge.lon }),
      ]),
      el("div", { className: "ilb-actions" }, [
        el("button", {
          className: "ilb-btn primary", type: "button", text: "Navigate",
          onClick: () => navigateTo(bridge),
        }),
        el("button", {
          className: "ilb-btn secondary", type: "button", text: "Focus map",
          onClick: () => focusMap(bridge),
        }),
      ]),
    ]);
    host.appendChild(box);
    STATE.current = { sn, bridge };
  }

  function navigateTo(bridge) {
    const url = STATE.search.mapsDirectionsUrl(bridge.lat, bridge.lon);
    window.open(url, "_blank", "noopener");
  }

  function focusMap(bridge) {
    // Prefer in-page URL update so Maps pans without leaving the tab.
    const place = STATE.search.mapsSearchUrl(bridge.lat, bridge.lon);
    try {
      history.pushState({}, "", place);
      // Soft reload of Maps view via location when pushState alone is insufficient
      window.location.assign(place);
    } catch (_) {
      window.location.href = place;
    }
  }

  function renderSuggest(root, items) {
    const box = root.querySelector("[data-suggest]");
    STATE.suggestions = items;
    STATE.activeIdx = items.length ? 0 : -1;
    if (!items.length) {
      box.classList.remove("open");
      box.innerHTML = "";
      return;
    }
    box.innerHTML = "";
    items.forEach((item, i) => {
      const b = item.bridge;
      const county = STATE.search.countyName(b.county);
      const btn = el("button", {
        type: "button",
        className: i === STATE.activeIdx ? "active" : "",
        onClick: () => selectBridge(root, item.sn, b),
      });
      btn.innerHTML =
        '<div class="sn">' +
        escapeHtml(item.sn) +
        '</div><div class="meta">' +
        escapeHtml((b.carried || "—") + " over " + (b.crossed || "—") + " · " + county) +
        "</div>";
      box.appendChild(btn);
    });
    box.classList.add("open");
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function selectBridge(root, sn, bridge) {
    const input = root.querySelector("[data-input]");
    input.value = sn;
    root.querySelector("[data-suggest]").classList.remove("open");
    setStatus(root, null);
    renderResult(root, sn, bridge);
  }

  function onQuery(root, q) {
    if (!STATE.search) return;
    const exact = STATE.search.lookupExact(q);
    if (exact && (!q.includes(" ") || exact.sn === q.trim())) {
      // Show typeahead too while typing prefixes
    }
    const suggestions = STATE.search.typeahead(q, 10);
    renderSuggest(root, suggestions);

    if (exact && digitsOnlyEqual(q, exact.sn)) {
      setStatus(root, null);
      renderResult(root, exact.sn, exact.bridge);
    } else if (q.trim() && !suggestions.length) {
      setStatus(root, "No Illinois bridges match “" + q.trim() + "”.", "error");
      renderResult(root, null, null);
    } else if (!q.trim()) {
      setStatus(root, "Enter an IL structure number (example: 016-0001).");
      renderResult(root, null, null);
    } else {
      setStatus(root, suggestions.length + " match" + (suggestions.length === 1 ? "" : "es") + " — pick one or keep typing.");
      renderResult(root, null, null);
    }
  }

  function digitsOnlyEqual(a, b) {
    const da = String(a).replace(/\D/g, "");
    const db = String(b).replace(/\D/g, "");
    return da === db || da.replace(/^0+/, "") === db.replace(/^0+/, "");
  }

  async function init() {
    const root = buildUI();
    const input = root.querySelector("[data-input]");
    const collapseBtn = root.querySelector("[data-collapse]");

    collapseBtn.addEventListener("click", () => {
      root.classList.toggle("ilb-collapsed");
      collapseBtn.textContent = root.classList.contains("ilb-collapsed") ? "+" : "–";
    });

    input.addEventListener("input", () => onQuery(root, input.value));
    input.addEventListener("keydown", (e) => {
      const box = root.querySelector("[data-suggest]");
      if (e.key === "ArrowDown" && STATE.suggestions.length) {
        e.preventDefault();
        STATE.activeIdx = Math.min(STATE.suggestions.length - 1, STATE.activeIdx + 1);
        [...box.children].forEach((c, i) => c.classList.toggle("active", i === STATE.activeIdx));
      } else if (e.key === "ArrowUp" && STATE.suggestions.length) {
        e.preventDefault();
        STATE.activeIdx = Math.max(0, STATE.activeIdx - 1);
        [...box.children].forEach((c, i) => c.classList.toggle("active", i === STATE.activeIdx));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (STATE.activeIdx >= 0 && STATE.suggestions[STATE.activeIdx]) {
          const item = STATE.suggestions[STATE.activeIdx];
          selectBridge(root, item.sn, item.bridge);
        } else {
          const hit = STATE.search && STATE.search.lookupExact(input.value);
          if (hit) selectBridge(root, hit.sn, hit.bridge);
          else setStatus(root, "Structure number not found in Illinois NBI inventory.", "error");
        }
      } else if (e.key === "Escape") {
        box.classList.remove("open");
      }
    });

    document.addEventListener("click", (e) => {
      if (!root.contains(e.target)) {
        root.querySelector("[data-suggest]").classList.remove("open");
      }
    });

    try {
      const url = chrome.runtime.getURL("data/bridges.json");
      const resp = await fetch(url);
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      const data = await resp.json();
      STATE.search = window.ILBridgeSearch.createSearchIndex(data);
      root.querySelector("[data-footer]").textContent =
        STATE.search.count.toLocaleString() +
        " IL bridges · NBI " +
        (STATE.search.meta.sourceYear || "");
      setStatus(root, "Ready — search by structure number.");
      input.focus();
    } catch (err) {
      console.error("IL Bridge Maps load failed", err);
      setStatus(root, "Failed to load bridge data: " + err.message, "error");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
