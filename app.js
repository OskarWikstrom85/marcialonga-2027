/* =====================================================================
   Marcialonga 2027 – 3D-karta
   MapLibre GL JS + Supabase (delad lagring, bilder, inloggning för redigering)
   ===================================================================== */
(function () {
  "use strict";

  const CFG = window.APP_CONFIG || {};
  const $ = (id) => document.getElementById(id);

  const ICON_GLYPH = { start: "S", finish: "🏁", peak: "⛰", food: "🍊", info: "i", default: "•" };
  const ICON_LABEL = { start: "Start", finish: "Mål", peak: "Topp/vändpunkt", food: "Vätska/mat", info: "Info", default: "Plats" };
  const ICON_ORDER = ["start", "finish", "peak", "food", "info", "default"];

  // ---- Tillstånd ----
  let map = null;
  let sb = null;             // Supabase-klient (null om ej konfigurerad)
  let editing = false;       // är inloggad redaktör aktiv redigeringsläge
  let canEdit = false;       // har giltig session
  let waypoints = [];        // aktuella hållpunkter
  let usingDefaults = true;  // visar vi fallback-punkter?
  const markers = new Map(); // id -> maplibregl.Marker
  let selectedId = null;
  let draft = null;          // ny, ej sparad punkt under redigering
  let addMode = false;

  const BUCKET = "waypoint-images";

  // =====================================================================
  //  Karta
  // =====================================================================
  function buildStyle() {
    const key = (CFG.MAPTILER_KEY || "").trim();
    if (key) {
      // MapTiler: snygg satellit med ortnamn + terräng
      return {
        style: `https://api.maptiler.com/maps/hybrid/style.json?key=${key}`,
        terrainSource: "maptiler-terrain",
        terrainTiles: `https://api.maptiler.com/tiles/terrain-rgb-v2/tiles.json?key=${key}`,
        terrainEncoding: "mapbox",
      };
    }
    // Nyckelfritt: Esri satellit + AWS terräng (terrarium)
    const style = {
      version: 8,
      sources: {
        satellite: {
          type: "raster",
          tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
          tileSize: 256, maxzoom: 19,
          attribution: "Satellit © Esri, Maxar, Earthstar Geographics",
        },
        terrarium: {
          type: "raster-dem",
          tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
          encoding: "terrarium", tileSize: 256, maxzoom: 15,
          attribution: "Höjddata: Mapzen / AWS Terrain Tiles",
        },
      },
      layers: [
        { id: "bg", type: "background", paint: { "background-color": "#9fc0e6" } },
        { id: "satellite", type: "raster", source: "satellite" },
        { id: "hillshade", type: "hillshade", source: "terrarium",
          paint: { "hillshade-exaggeration": 0.35, "hillshade-shadow-color": "#1b2430" } },
      ],
    };
    return { style, terrainSource: "terrarium", terrainTiles: null, terrainEncoding: "terrarium" };
  }

  function initMap() {
    const s = buildStyle();
    const start = CFG.START || { lng: 11.58, lat: 46.38, zoom: 10.5, pitch: 62, bearing: 20 };

    map = new maplibregl.Map({
      container: "map",
      style: s.style,
      center: [start.lng, start.lat],
      zoom: start.zoom, pitch: start.pitch, bearing: start.bearing,
      maxPitch: 85, hash: false, attributionControl: { compact: true },
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
    map.addControl(new maplibregl.GeolocateControl({ trackUserLocation: false }), "bottom-right");

    map.on("load", () => {
      // Terräng
      try {
        if (s.terrainTiles) {
          map.addSource(s.terrainSource, { type: "raster-dem", url: s.terrainTiles, tileSize: 256 });
        }
        map.setTerrain({ source: s.terrainSource, exaggeration: CFG.TERRAIN_EXAGGERATION || 1.4 });
      } catch (e) { console.warn("Terräng kunde inte aktiveras:", e); }

      try { map.setSky && map.setSky({ "sky-color": "#aed2f5", "horizon-color": "#eaf2fb", "fog-color": "#dfeaf6", "sky-horizon-blend": 0.5, "horizon-fog-blend": 0.6, "fog-ground-blend": 0.3 }); } catch (e) {}

      addRoute();
    });

    map.on("error", (e) => console.warn("Kartfel:", e && e.error ? e.error.message : e));

    $("btnReset").addEventListener("click", () =>
      map.easeTo({ center: [start.lng, start.lat], zoom: start.zoom, pitch: start.pitch, bearing: start.bearing, duration: 1200 }));
  }

  function addRoute() {
    const route = window.ROUTE_GEOJSON;
    if (!route) return;
    if (map.getSource("route")) return;
    map.addSource("route", { type: "geojson", data: route });
    map.addLayer({ id: "route-casing", type: "line", source: "route",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": "#10243a", "line-width": 7, "line-opacity": 0.9 } });
    map.addLayer({ id: "route-line", type: "line", source: "route",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": "#ff6a2b", "line-width": 3.5 } });
  }

  // =====================================================================
  //  Supabase
  // =====================================================================
  function initSupabase() {
    const url = (CFG.SUPABASE_URL || "").trim();
    const anon = (CFG.SUPABASE_ANON_KEY || "").trim();
    if (!url || !anon || !window.supabase) {
      status("Visar exempelpunkter. Koppla Supabase i config.js för att spara och redigera.", "", 6000);
      return false;
    }
    try {
      sb = window.supabase.createClient(url, anon);
    } catch (e) { console.warn("Supabase-init misslyckades:", e); return false; }

    sb.auth.getSession().then(({ data }) => setEditor(!!(data && data.session)));
    sb.auth.onAuthStateChange((_ev, session) => setEditor(!!session));

    // Realtidsuppdatering – ändringar från andra syns direkt
    try {
      sb.channel("wp-changes")
        .on("postgres_changes", { event: "*", schema: "public", table: "waypoints" }, () => loadWaypoints())
        .subscribe();
    } catch (e) { /* realtime valfritt */ }
    return true;
  }

  function setEditor(hasSession) {
    canEdit = hasSession;
    $("btnLogin").textContent = hasSession ? "✎ Redigerar" : "✎ Redigera";
    $("btnLogin").classList.toggle("active", hasSession);
    if (!hasSession) setEditing(false);
  }

  async function loadWaypoints() {
    if (sb) {
      try {
        const { data, error } = await sb.from("waypoints").select("*").order("sort", { ascending: true });
        if (error) throw error;
        if (data && data.length) { waypoints = data; usingDefaults = false; renderMarkers(); return; }
      } catch (e) { console.warn("Kunde inte läsa punkter:", e); }
    }
    waypoints = (window.DEFAULT_WAYPOINTS || []).slice();
    usingDefaults = true;
    renderMarkers();
  }

  // =====================================================================
  //  Markörer
  // =====================================================================
  function makeEl(wp) {
    const el = document.createElement("div");
    const t = ICON_GLYPH[wp.icon] ? wp.icon : "default";
    el.className = "mk " + t;
    el.textContent = ICON_GLYPH[t];
    el.title = wp.title || "";
    el.addEventListener("click", (ev) => { ev.stopPropagation(); selectWaypoint(wp.id); });
    return el;
  }

  function renderMarkers() {
    markers.forEach((m) => m.remove());
    markers.clear();
    waypoints.forEach((wp) => {
      if (typeof wp.lng !== "number" || typeof wp.lat !== "number") return;
      const el = makeEl(wp);
      const m = new maplibregl.Marker({ element: el, anchor: "center", draggable: false })
        .setLngLat([wp.lng, wp.lat]).addTo(map);
      m.on("dragend", async () => {
        const ll = m.getLngLat();
        wp.lng = +ll.lng.toFixed(6); wp.lat = +ll.lat.toFixed(6);
        if (!usingDefaults && sb && !String(wp.id).startsWith("d")) {
          try { await sb.from("waypoints").update({ lng: wp.lng, lat: wp.lat }).eq("id", wp.id); } catch (e) {}
        }
        if (selectedId === wp.id && draft) { draft.lng = wp.lng; draft.lat = wp.lat; }
        status("Position uppdaterad", "ok", 1500);
      });
      markers.set(wp.id, m);
      applyMarkerState(wp.id);
      el.classList.toggle("sel", wp.id === selectedId);
    });
    syncDraggable();
  }

  function applyMarkerState(id) {
    const m = markers.get(id); if (!m) return;
    m.getElement().classList.toggle("sel", id === selectedId);
  }

  function syncDraggable() {
    markers.forEach((m, id) => {
      const on = editing && !usingDefaults && !String(id).startsWith("d");
      m.setDraggable(on);
    });
  }

  // =====================================================================
  //  Panel – visa
  // =====================================================================
  function selectWaypoint(id) {
    selectedId = id;
    markers.forEach((m, mid) => m.getElement().classList.toggle("sel", mid === id));
    const wp = waypoints.find((w) => w.id === id);
    if (!wp) return;
    const m = markers.get(id);
    if (m) map.easeTo({ center: m.getLngLat(), duration: 800, offset: [-90, 0] });
    if (editing) renderEdit(wp); else renderView(wp);
    openPanel();
  }

  function renderView(wp) {
    $("panelEdit").classList.add("hidden");
    const v = $("panelView"); v.classList.remove("hidden");
    const t = ICON_GLYPH[wp.icon] ? wp.icon : "default";
    const img = wp.image_url ? `<img class="wp-img" src="${esc(wp.image_url)}" alt="">` : "";
    v.innerHTML = `
      ${img}
      <span class="wp-badge">${ICON_GLYPH[t]} ${esc(ICON_LABEL[t])}</span>
      <h2 class="wp-title">${esc(wp.title || "Namnlös punkt")}</h2>
      <div class="wp-body">${esc(wp.body || "")}</div>
      ${editing ? `<div class="btns"><button class="btn-ghost" id="toEdit">✎ Redigera denna</button></div>` : ""}`;
    if (editing) $("toEdit").addEventListener("click", () => renderEdit(wp));
  }

  // =====================================================================
  //  Panel – redigera
  // =====================================================================
  function renderEdit(wp) {
    draft = Object.assign({}, wp);
    $("panelView").classList.add("hidden");
    const e = $("panelEdit"); e.classList.remove("hidden");
    const opts = ICON_ORDER.map((k) => `<option value="${k}" ${((draft.icon||"default")===k)?"selected":""}>${ICON_GLYPH[k]} ${ICON_LABEL[k]}</option>`).join("");
    const thumb = draft.image_url ? `<img class="thumb" src="${esc(draft.image_url)}" alt="">` : "";
    e.innerHTML = `
      <h2 class="wp-title">${draft.__isNew ? "Ny hållpunkt" : "Redigera"}</h2>
      <label>Rubrik</label>
      <input id="fTitle" type="text" value="${esc(draft.title||"")}" placeholder="t.ex. Vätskekontroll Predazzo">
      <label>Typ</label>
      <select id="fIcon">${opts}</select>
      <label>Text</label>
      <textarea id="fBody" placeholder="Beskrivning, historia, tips...">${esc(draft.body||"")}</textarea>
      <label>Bild</label>
      <input id="fFile" type="file" accept="image/*">
      <div class="hint">Max 10 MB. Bilden sparas i din Supabase-lagring.</div>
      <div id="thumbWrap">${thumb}</div>
      <div class="row">
        <div><label>Longitud</label><input id="fLng" type="text" value="${draft.lng??""}"></div>
        <div><label>Latitud</label><input id="fLat" type="text" value="${draft.lat??""}"></div>
      </div>
      <div class="hint">Tips: dra markören på kartan för att flytta punkten.</div>
      <div class="btns">
        <button class="btn-primary" id="fSave">Spara</button>
        <button class="btn-ghost" id="fCancel">Avbryt</button>
        ${draft.__isNew ? "" : `<button class="btn-danger" id="fDelete">Ta bort</button>`}
      </div>`;

    $("fFile").addEventListener("change", onPickImage);
    $("fSave").addEventListener("click", onSave);
    $("fCancel").addEventListener("click", () => { if (draft && draft.__isNew) removeDraftMarker(); draft = null; closePanel(); });
    if (!draft.__isNew) $("fDelete").addEventListener("click", onDelete);
  }

  async function onPickImage(ev) {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    if (!sb) return status("Koppla Supabase för att ladda upp bilder.", "err", 4000);
    if (file.size > 10 * 1024 * 1024) return status("Bilden är för stor (max 10 MB).", "err", 4000);
    status("Laddar upp bild…");
    try {
      const id = draft.id || (draft.id = cryptoId());
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
      const path = `${id}/${Date.now()}.${ext}`;
      const { error } = await sb.storage.from(BUCKET).upload(path, file, { upsert: true, contentType: file.type });
      if (error) throw error;
      const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
      draft.image_url = data.publicUrl;
      $("thumbWrap").innerHTML = `<img class="thumb" src="${esc(draft.image_url)}" alt="">`;
      status("Bild uppladdad", "ok", 1500);
    } catch (e) {
      console.warn(e); status("Uppladdning misslyckades: " + (e.message || e), "err", 5000);
    }
  }

  async function onSave() {
    if (!sb) return status("Koppla Supabase i config.js för att spara.", "err", 4000);
    draft.title = $("fTitle").value.trim();
    draft.icon = $("fIcon").value;
    draft.body = $("fBody").value;
    const lng = parseFloat($("fLng").value), lat = parseFloat($("fLat").value);
    if (!isFinite(lng) || !isFinite(lat)) return status("Ogiltiga koordinater.", "err", 3000);
    draft.lng = +lng.toFixed(6); draft.lat = +lat.toFixed(6);
    if (!draft.title) return status("Rubrik krävs.", "err", 3000);

    const row = { id: draft.id || cryptoId(), title: draft.title, icon: draft.icon,
      body: draft.body, lng: draft.lng, lat: draft.lat, image_url: draft.image_url || null,
      sort: draft.sort != null ? draft.sort : nextSort() };

    status("Sparar…");
    try {
      const { error } = await sb.from("waypoints").upsert(row);
      if (error) throw error;
      removeDraftMarker();
      draft = null;
      status("Sparat", "ok", 1500);
      await loadWaypoints();
      selectWaypoint(row.id);
    } catch (e) {
      console.warn(e); status("Kunde inte spara: " + (e.message || e), "err", 5000);
    }
  }

  async function onDelete() {
    if (!sb || !draft) return;
    if (!confirmSoft("Ta bort denna hållpunkt?")) return;
    status("Tar bort…");
    try {
      const { error } = await sb.from("waypoints").delete().eq("id", draft.id);
      if (error) throw error;
      draft = null; selectedId = null;
      status("Borttagen", "ok", 1500);
      closePanel();
      await loadWaypoints();
    } catch (e) { console.warn(e); status("Kunde inte ta bort: " + (e.message || e), "err", 5000); }
  }

  // Lägg till ny punkt genom att klicka på kartan
  function startAdd() {
    if (!canEdit) return;
    addMode = true;
    status("Klicka på kartan där punkten ska ligga…");
    map.getCanvas().style.cursor = "crosshair";
    map.once("click", (e) => {
      addMode = false;
      map.getCanvas().style.cursor = "";
      const id = cryptoId();
      draft = { __isNew: true, id, icon: "info", title: "", body: "",
        lng: +e.lngLat.lng.toFixed(6), lat: +e.lngLat.lat.toFixed(6), image_url: null, sort: nextSort() };
      // temporär markör
      const el = makeEl({ id, icon: "info", title: "Ny punkt" });
      const m = new maplibregl.Marker({ element: el, anchor: "center", draggable: true })
        .setLngLat([draft.lng, draft.lat]).addTo(map);
      m.on("dragend", () => { const ll = m.getLngLat(); draft.lng = +ll.lng.toFixed(6); draft.lat = +ll.lat.toFixed(6);
        if ($("fLng")) { $("fLng").value = draft.lng; $("fLat").value = draft.lat; } });
      markers.set(id, m);
      selectedId = id;
      renderEdit(draft);
      openPanel();
      status("");
    });
  }

  function removeDraftMarker() {
    if (draft && draft.__isNew && markers.has(draft.id)) {
      markers.get(draft.id).remove();
      markers.delete(draft.id);
    }
  }

  // =====================================================================
  //  Lista
  // =====================================================================
  function showList() {
    selectedId = null;
    markers.forEach((m) => m.getElement().classList.remove("sel"));
    $("panelEdit").classList.add("hidden");
    const v = $("panelView"); v.classList.remove("hidden");
    const items = waypoints.slice().sort((a, b) => (a.sort || 0) - (b.sort || 0)).map((wp) => {
      const t = ICON_GLYPH[wp.icon] ? wp.icon : "default";
      return `<div class="list-item" data-id="${esc(String(wp.id))}">
        <div class="list-ic">${ICON_GLYPH[t]}</div><div class="list-txt">${esc(wp.title || "Namnlös")}</div></div>`;
    }).join("");
    v.innerHTML = `<p class="list-head">Hållpunkter (${waypoints.length})</p>${items || '<p class="muted">Inga punkter än.</p>'}
      ${editing ? `<div class="btns"><button class="btn-primary" id="addNew">+ Lägg till punkt</button></div>` : ""}`;
    v.querySelectorAll(".list-item").forEach((el) =>
      el.addEventListener("click", () => selectWaypoint(coerceId(el.getAttribute("data-id")))));
    if (editing) $("addNew").addEventListener("click", () => { closePanel(); startAdd(); });
    openPanel();
  }

  function coerceId(s) {
    const wp = waypoints.find((w) => String(w.id) === s);
    return wp ? wp.id : s;
  }

  // =====================================================================
  //  Redigeringsläge av/på
  // =====================================================================
  function setEditing(on) {
    editing = on && canEdit;
    document.body.classList.toggle("editing", editing);
    syncDraggable();
    if (!editing) { if (draft && draft.__isNew) removeDraftMarker(); draft = null; }
  }

  // =====================================================================
  //  Inloggning (magic link)
  // =====================================================================
  function wireLogin() {
    $("btnLogin").addEventListener("click", () => {
      if (!sb) return status("Koppla Supabase i config.js först.", "err", 4000);
      if (canEdit) { setEditing(!editing); showList(); return; } // redan inloggad -> toggla redigering
      openModal();
    });
    $("loginCancel").addEventListener("click", closeModal);
    $("loginSend").addEventListener("click", async () => {
      const email = $("loginEmail").value.trim();
      if (!email) return ($("loginMsg").textContent = "Ange en e-postadress.");
      $("loginMsg").textContent = "Skickar…";
      try {
        const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.href.split("#")[0] } });
        if (error) throw error;
        $("loginMsg").textContent = "Klart! Kolla din e-post och klicka på länken.";
      } catch (e) { $("loginMsg").textContent = "Fel: " + (e.message || e); }
    });
  }
  function openModal() { $("loginModal").classList.remove("hidden"); $("loginEmail").focus(); }
  function closeModal() { $("loginModal").classList.add("hidden"); $("loginMsg").textContent = ""; }

  // =====================================================================
  //  Panel-helpers, status, utils
  // =====================================================================
  function openPanel() { const p = $("panel"); p.classList.remove("hidden"); p.setAttribute("aria-hidden", "false"); }
  function closePanel() { const p = $("panel"); p.classList.add("hidden"); p.setAttribute("aria-hidden", "true");
    selectedId = null; markers.forEach((m) => m.getElement().classList.remove("sel")); }

  let statusTimer = null;
  function status(msg, kind, ms) {
    const el = $("status");
    if (!msg) { el.classList.add("hidden"); return; }
    el.textContent = msg; el.className = kind || ""; el.classList.remove("hidden");
    if (statusTimer) clearTimeout(statusTimer);
    if (ms) statusTimer = setTimeout(() => el.classList.add("hidden"), ms);
  }

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  function cryptoId() { return (crypto && crypto.randomUUID) ? crypto.randomUUID() :
    "x" + Date.now() + Math.random().toString(16).slice(2); }
  function nextSort() { return waypoints.reduce((m, w) => Math.max(m, w.sort || 0), 0) + 1; }
  function confirmSoft(msg) { return window.confirm(msg); }

  // =====================================================================
  //  Start
  // =====================================================================
  function main() {
    if (!window.maplibregl) { document.body.innerHTML = "<p style='padding:20px'>Kunde inte ladda kartbiblioteket. Kontrollera internetanslutningen.</p>"; return; }
    initMap();
    $("panelClose").addEventListener("click", closePanel);
    $("btnList").addEventListener("click", showList);
    wireLogin();
    const ok = initSupabase();
    // vänta tills kartan laddat innan markörer ritas
    if (map.loaded()) loadWaypoints(); else map.on("load", loadWaypoints);
    // stäng panel med Esc
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closePanel(); closeModal(); } });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", main); else main();
})();
