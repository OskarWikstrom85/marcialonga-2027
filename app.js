/* =====================================================================
   Marcialonga 2027 – 3D-karta
   MapLibre GL JS + Supabase.
   Flera "banor": Marcialonga (loppsträcka) + Canazei (skidområde).
   Översikt visar banornas etiketter; klick går in i en bana med punkter,
   lista och redigering. Skidområdet visar liftar + pister (OpenSnowMap).
   ===================================================================== */
(function () {
  "use strict";

  const CFG = window.APP_CONFIG || {};
  const $ = (id) => document.getElementById(id);

  const ICON_GLYPH = { start: "S", finish: "🏁", peak: "⛰", food: "🍊", info: "i", lift: "🚠", default: "•" };
  const ICON_LABEL = { start: "Start", finish: "Mål", peak: "Topp/vändpunkt", food: "Vätska/mat", info: "Info", lift: "Lift/station", default: "Plats" };
  const ICON_ORDER = ["start", "finish", "peak", "food", "lift", "info", "default"];
  const BUCKET = "waypoint-images";
  const LIFT_TYPE_SV = { gondola: "Kabinbana (gondol)", cable_car: "Linbana", chair_lift: "Stollift",
    drag_lift: "Släplift", platter: "Tallrikslift", "t-bar": "Ankarlift", "j-bar": "J-bygellift",
    magic_carpet: "Rullband", mixed_lift: "Kombibana", rope_tow: "Draglina" };

  // ---- Banor ----
  const BANOR = [
    { id: "marcialonga", type: "route", icon: "🎿", name: "Marcialonga",
      stats: "69,9 km · 798–1449 m ö.h.",
      mask: { clearKm: 5, rings: [6, 7, 8, 9, 10] } },
    { id: "canazei", type: "ski", icon: "⛷", name: "Canazei – skidområde",
      stats: "Liftar & pister · Belvedere / Sellaronda",
      pill: { lng: 11.7700, lat: 46.4767 },
      bbox: [11.70, 46.43, 11.95, 46.58],
      overlay: "https://www.opensnowmap.org/pistes/{z}/{x}/{y}.png",
      overlayAttr: "Pister & liftar © OpenSnowMap, OpenStreetMap",
      hasLifts: true,
      mask: { clearKm: 2, rings: [4, 7, 10, 14, 18] } },
  ];
  const MASK_OPS = [0.2, 0.4, 0.6, 0.78, 0.9];
  const MASK_FAR_OP = 0.96;
  const MASK_COLOR = "#f6f4ee";
  const banaById = (id) => BANOR.find((b) => b.id === id);

  // ---- Tillstånd ----
  let map = null, sb = null;
  let view = "overview", current = null;     // current = aktiv bana (objekt) eller null
  let editing = false, canEdit = false;
  let waypoints = [], usingDefaults = true;  // ALLA punkter (filtreras per bana)
  const markers = new Map();
  const liftMarkers = new Map();
  const pills = [];
  let selectedId = null, draft = null, addMode = false;

  // =====================================================================
  //  Kartstil
  // =====================================================================
  function buildStyle() {
    const key = (CFG.MAPTILER_KEY || "").trim();
    if (key) return { style: `https://api.maptiler.com/maps/hybrid/style.json?key=${key}`,
      terrainSource: "maptiler-terrain", terrainTiles: `https://api.maptiler.com/tiles/terrain-rgb-v2/tiles.json?key=${key}` };
    const style = {
      version: 8,
      sources: {
        satellite: { type: "raster", tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
          tileSize: 256, maxzoom: 19, attribution: "Satellit © Esri, Maxar, Earthstar Geographics" },
        terrarium: { type: "raster-dem", tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
          encoding: "terrarium", tileSize: 256, maxzoom: 15, attribution: "Höjddata: Mapzen / AWS Terrain Tiles" },
      },
      layers: [
        { id: "bg", type: "background", paint: { "background-color": "#9fc0e6" } },
        { id: "satellite", type: "raster", source: "satellite" },
        { id: "hillshade", type: "hillshade", source: "terrarium", paint: { "hillshade-exaggeration": 0.35, "hillshade-shadow-color": "#1b2430" } },
      ],
    };
    return { style, terrainSource: "terrarium", terrainTiles: null };
  }

  function initMap() {
    const s = buildStyle();
    const start = CFG.START || { lng: 11.59, lat: 46.38, zoom: 10.3, pitch: 55, bearing: 15 };
    map = new maplibregl.Map({ container: "map", style: s.style, center: [start.lng, start.lat],
      zoom: start.zoom, pitch: start.pitch, bearing: start.bearing, maxPitch: 85, attributionControl: { compact: true } });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");

    map.on("load", () => {
      try {
        if (s.terrainTiles) map.addSource(s.terrainSource, { type: "raster-dem", url: s.terrainTiles, tileSize: 256 });
        map.setTerrain({ source: s.terrainSource, exaggeration: CFG.TERRAIN_EXAGGERATION || 1.4 });
      } catch (e) { console.warn("Terräng:", e); }
      try { map.setSky && map.setSky({ "sky-color": "#aed2f5", "horizon-color": "#eaf2fb", "fog-color": "#dfeaf6", "sky-horizon-blend": 0.5, "horizon-fog-blend": 0.6, "fog-ground-blend": 0.3 }); } catch (e) {}
      addLabels();
      addRoute();
      enterOverview(true);
    });
    map.on("error", (e) => console.warn("Kartfel:", e && e.error ? e.error.message : e));
    $("btnReset").addEventListener("click", () => { if (view === "course") frameCurrent(); else resetOverview(); });
  }

  function addLabels() {
    if ((CFG.MAPTILER_KEY || "").trim() || map.getSource("esri-ref")) return;
    map.addSource("esri-ref", { type: "raster",
      tiles: ["https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"],
      tileSize: 256, maxzoom: 19, attribution: "Ortnamn © Esri" });
    map.addLayer({ id: "place-labels", type: "raster", source: "esri-ref", paint: { "raster-opacity": 1 } });
  }

  function addRoute() {
    const route = window.ROUTE_GEOJSON;
    if (!route || map.getSource("route")) return;
    map.addSource("route", { type: "geojson", data: route });
    map.addLayer({ id: "route-casing", type: "line", source: "route", layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": "#10243a", "line-width": 7, "line-opacity": 0.9 } });
    map.addLayer({ id: "route-line", type: "line", source: "route", layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": "#ff6a2b", "line-width": 3.6 } });
    map.addLayer({ id: "route-hit", type: "line", source: "route", layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": "#000", "line-opacity": 0.01, "line-width": 24 } });
    map.on("click", "route-hit", () => { if (view === "overview") enterBana(banaById("marcialonga")); });
    map.on("mouseenter", "route-hit", () => { if (view === "overview") map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", "route-hit", () => { map.getCanvas().style.cursor = ""; });
    // Liftförstärkning (svart linje) – ligger överst
    map.addSource("lift-hl", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({ id: "lift-hl-casing", type: "line", source: "lift-hl", layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": "#ffffff", "line-width": 8, "line-opacity": 0.85 } });
    map.addLayer({ id: "lift-hl-l", type: "line", source: "lift-hl", layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": "#000000", "line-width": 4.5 } });
  }
  function densify(coords, stepM) {
    const out = [];
    for (let i = 0; i < coords.length - 1; i++) {
      const a = coords[i], b = coords[i + 1];
      out.push(a);
      const dLng = b[0] - a[0], dLat = b[1] - a[1];
      const kx = Math.cos(a[1] * Math.PI / 180);
      const distM = Math.hypot(dLat, dLng * kx) * 111320;
      const n = Math.max(1, Math.floor(distM / stepM));
      for (let j = 1; j < n; j++) out.push([a[0] + dLng * j / n, a[1] + dLat * j / n]);
    }
    out.push(coords[coords.length - 1]);
    return out;
  }
  function setLiftHighlight(coords) {
    const s = map.getSource("lift-hl");
    if (s) s.setData({ type: "Feature", geometry: { type: "LineString", coordinates: densify(coords, 40) }, properties: {} });
  }
  function clearLiftHighlight() {
    const s = map.getSource("lift-hl"); if (s) s.setData({ type: "FeatureCollection", features: [] });
    liftMarkers.forEach((m) => m.getElement().classList.remove("sel"));
  }
  function setRouteVisible(v) {
    ["route-casing", "route-line", "route-hit"].forEach((id) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", v ? "visible" : "none");
    });
  }

  // =====================================================================
  //  Etiketter (pills) i översikten
  // =====================================================================
  function routeCoords() { return (window.ROUTE_GEOJSON && window.ROUTE_GEOJSON.geometry.coordinates) || []; }
  function routeBounds() { const b = new maplibregl.LngLatBounds(); routeCoords().forEach((p) => b.extend(p)); return b; }
  function routeMid() { const c = routeCoords(); return c[Math.floor(c.length / 2)]; }
  function banaPill(b) { return b.type === "route" ? routeMid() : [b.pill.lng, b.pill.lat]; }

  function addPills() {
    removePills();
    BANOR.forEach((b) => {
      const el = document.createElement("div");
      el.className = "course-pill";
      el.innerHTML = `<span class="cp-ic">${b.icon}</span> ${esc(b.name)} <span class="cp-arrow">›</span>`;
      el.addEventListener("click", (e) => { e.stopPropagation(); enterBana(b); });
      pills.push(new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat(banaPill(b)).addTo(map));
    });
  }
  function removePills() { pills.forEach((p) => p.remove()); pills.length = 0; }

  // =====================================================================
  //  Lägen
  // =====================================================================
  function enterOverview(initial) {
    view = "overview"; current = null;
    document.body.classList.remove("in-course");
    removeMask(); removeOverlay(); clearMarkers(); clearLifts(); clearLiftHighlight(); closePanel();
    setRouteVisible(true);
    addPills();
    if (!initial) resetOverview();
  }
  function resetOverview() {
    const s = CFG.START; map.easeTo({ center: [s.lng, s.lat], zoom: s.zoom, pitch: s.pitch, bearing: s.bearing, duration: 1100 });
  }

  function enterBana(b) {
    if (view === "course" && current && current.id === b.id) return;
    current = b; view = "course";
    document.body.classList.add("in-course");
    removePills();
    clearLifts(); clearLiftHighlight();
    setRouteVisible(b.type === "route");
    removeOverlay(); if (b.overlay) addOverlay(b);
    frameCurrent();
    showMask(b);
    renderMarkers();
    if (b.hasLifts && window.CANAZEI_LIFTS) renderLifts();
    // håll liftlinjen överst (ovanför mask/overlay)
    if (map.getLayer("lift-hl-casing")) map.moveLayer("lift-hl-casing");
    if (map.getLayer("lift-hl-l")) map.moveLayer("lift-hl-l");
    showCoursePanel();
  }
  function exitCourse() { enterOverview(false); }

  function frameCurrent() {
    const b = current; if (!b) return;
    const narrow = window.innerWidth < 760;
    const pad = { top: 70, bottom: 70, left: 40, right: narrow ? 40 : 400 };
    if (b.type === "route") map.fitBounds(routeBounds(), { padding: pad, pitch: 60, duration: 1300, maxZoom: 13.5 });
    else map.fitBounds([[b.bbox[0], b.bbox[1]], [b.bbox[2], b.bbox[3]]], { padding: pad, pitch: 55, duration: 1300, maxZoom: 13.5 });
  }

  // Skidöverlay (OpenSnowMap raster)
  function addOverlay(b) {
    if (!map.getSource("ski-overlay")) {
      map.addSource("ski-overlay", { type: "raster", tiles: [b.overlay], tileSize: 256, maxzoom: 18, attribution: b.overlayAttr || "" });
    }
    if (!map.getLayer("ski-overlay-l")) {
      const before = map.getLayer("route-casing") ? "route-casing" : undefined;
      map.addLayer({ id: "ski-overlay-l", type: "raster", source: "ski-overlay", paint: { "raster-opacity": 1 } }, before);
    }
  }
  function removeOverlay() {
    if (map.getLayer("ski-overlay-l")) map.removeLayer("ski-overlay-l");
    if (map.getSource("ski-overlay")) map.removeSource("ski-overlay");
  }

  // Ljus uttoning utanför banan/området
  function showMask(b) {
    if (!window.turf || !map.getLayer("route-casing")) return;
    removeMask();
    try {
      const geom = b.type === "route"
        ? window.turf.lineString(routeCoords())
        : window.turf.bboxPolygon(b.bbox);
      const radii = [b.mask.clearKm, ...b.mask.rings];
      const buf = radii.map((r) => window.turf.buffer(geom, r, { units: "kilometers" }));
      const bb = window.turf.bbox(buf[buf.length - 1]); const pad = 0.8;
      const world = window.turf.bboxPolygon([bb[0] - pad, bb[1] - pad, bb[2] + pad, bb[3] + pad]);
      const feats = [];
      const outer = window.turf.difference(world, buf[buf.length - 1]);
      if (outer) feats.push({ type: "Feature", properties: { op: MASK_FAR_OP }, geometry: outer.geometry });
      for (let i = buf.length - 1; i >= 1; i--) {
        const ring = window.turf.difference(buf[i], buf[i - 1]);
        if (ring) feats.push({ type: "Feature", properties: { op: MASK_OPS[i - 1] }, geometry: ring.geometry });
      }
      map.addSource("mask", { type: "geojson", data: { type: "FeatureCollection", features: feats } });
      map.addLayer({ id: "mask-fill", type: "fill", source: "mask",
        paint: { "fill-color": MASK_COLOR, "fill-opacity": ["get", "op"], "fill-antialias": false } }, "route-casing");
    } catch (e) { console.warn("Mask:", e); }
  }
  function removeMask() {
    if (map.getLayer("mask-fill")) map.removeLayer("mask-fill");
    if (map.getSource("mask")) map.removeSource("mask");
  }

  // =====================================================================
  //  Supabase
  // =====================================================================
  function initSupabase() {
    const url = (CFG.SUPABASE_URL || "").trim(), anon = (CFG.SUPABASE_ANON_KEY || "").trim();
    if (!url || !anon || !window.supabase) { status("Visar exempelpunkter. Koppla Supabase i config.js för att spara och redigera.", "", 6000); return false; }
    try { sb = window.supabase.createClient(url, anon); } catch (e) { console.warn(e); return false; }
    sb.auth.getSession().then(({ data }) => setEditor(!!(data && data.session)));
    sb.auth.onAuthStateChange((_e, session) => setEditor(!!session));
    try { sb.channel("wp-changes").on("postgres_changes", { event: "*", schema: "public", table: "waypoints" }, () => loadWaypoints()).subscribe(); } catch (e) {}
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
        if (data) { waypoints = data; usingDefaults = false; refreshMarkers(); if (view === "course") refreshPanelIfList(); return; }
      } catch (e) { console.warn("Läsa punkter:", e); }
    }
    waypoints = (window.DEFAULT_WAYPOINTS || []).slice(); usingDefaults = true; refreshMarkers();
  }
  function refreshPanelIfList() { const v = $("panelView"); if (!v.classList.contains("hidden") && v.querySelector(".course-head")) showCoursePanel(); }

  // Punkter som tillhör aktuell bana
  function curWaypoints() { const id = current ? current.id : null; return waypoints.filter((w) => (w.area_id || "marcialonga") === id); }

  // =====================================================================
  //  Snäppning (bara för rutt-banor)
  // =====================================================================
  function snap(lng, lat) {
    if (!current || current.type !== "route") return [+lng.toFixed(6), +lat.toFixed(6)];
    const c = routeCoords(); if (c.length < 2) return [lng, lat];
    const kx = Math.cos(lat * Math.PI / 180), px = lng * kx, py = lat;
    let best = null, bd = Infinity;
    for (let i = 0; i < c.length - 1; i++) {
      const ax = c[i][0] * kx, ay = c[i][1], bx = c[i + 1][0] * kx, by = c[i + 1][1];
      const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
      let t = L > 0 ? ((px - ax) * dx + (py - ay) * dy) / L : 0; t = Math.max(0, Math.min(1, t));
      const cx = ax + t * dx, cy = ay + t * dy, d = (px - cx) ** 2 + (py - cy) ** 2;
      if (d < bd) { bd = d; best = [cx / kx, cy]; }
    }
    return best ? [+best[0].toFixed(6), +best[1].toFixed(6)] : [lng, lat];
  }

  // =====================================================================
  //  Markörer
  // =====================================================================
  function refreshMarkers() { if (view === "course") renderMarkers(); }
  function clearMarkers() { markers.forEach((m) => m.remove()); markers.clear(); }
  function makeEl(wp) {
    const el = document.createElement("div");
    const t = ICON_GLYPH[wp.icon] ? wp.icon : "default";
    el.className = "mk " + t; el.textContent = ICON_GLYPH[t]; el.title = wp.title || "";
    el.addEventListener("click", (ev) => { ev.stopPropagation(); selectWaypoint(wp.id); });
    return el;
  }
  function renderMarkers() {
    clearMarkers();
    curWaypoints().forEach((wp) => {
      if (typeof wp.lng !== "number" || typeof wp.lat !== "number") return;
      const m = new maplibregl.Marker({ element: makeEl(wp), anchor: "center", draggable: false }).setLngLat([wp.lng, wp.lat]).addTo(map);
      m.on("dragend", async () => {
        const ll = m.getLngLat(); const sn = snap(ll.lng, ll.lat); m.setLngLat(sn);
        wp.lng = sn[0]; wp.lat = sn[1];
        if (!usingDefaults && sb && !String(wp.id).startsWith("d")) { try { await sb.from("waypoints").update({ lng: wp.lng, lat: wp.lat }).eq("id", wp.id); } catch (e) {} }
        if (selectedId === wp.id && draft) { draft.lng = wp.lng; draft.lat = wp.lat; if ($("fLng")) { $("fLng").value = wp.lng; $("fLat").value = wp.lat; } }
        status("Position uppdaterad", "ok", 1500);
      });
      markers.set(wp.id, m);
      m.getElement().classList.toggle("sel", wp.id === selectedId);
    });
    syncDraggable();
  }
  function syncDraggable() { markers.forEach((m, id) => m.setDraggable(editing && !usingDefaults && !String(id).startsWith("d"))); }

  // ---- Liftar (statisk OSM-data, ej redigerbara) ----
  function clearLifts() { liftMarkers.forEach((m) => m.remove()); liftMarkers.clear(); }
  function renderLifts() {
    clearLifts();
    (window.CANAZEI_LIFTS || []).forEach((lf) => {
      const el = document.createElement("div");
      el.className = "mk liftmk"; el.textContent = "🚠"; el.title = lf.name;
      el.addEventListener("click", (ev) => { ev.stopPropagation(); selectLift(lf.id); });
      liftMarkers.set(lf.id, new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat(lf.mid).addTo(map));
    });
  }
  function selectLift(id) {
    const lf = (window.CANAZEI_LIFTS || []).find((l) => l.id === id); if (!lf) return;
    selectedId = null; markers.forEach((m) => m.getElement().classList.remove("sel"));
    liftMarkers.forEach((m, mid) => m.getElement().classList.toggle("sel", mid === id));
    setLiftHighlight(lf.coords);
    if (map.getLayer("lift-hl-casing")) map.moveLayer("lift-hl-casing");
    if (map.getLayer("lift-hl-l")) map.moveLayer("lift-hl-l");
    const bnds = new maplibregl.LngLatBounds(); lf.coords.forEach((c) => bnds.extend(c));
    const narrow = window.innerWidth < 760;
    map.fitBounds(bnds, { padding: { top: 80, bottom: 80, left: 40, right: narrow ? 40 : 340 }, pitch: 50, bearing: 0, duration: 900, maxZoom: 15 });
    renderLiftView(lf); openPanel();
  }
  function renderLiftView(lf) {
    $("panelEdit").classList.add("hidden");
    const v = $("panelView"); v.classList.remove("hidden");
    v.innerHTML = `
      <button class="link-back" id="toList">‹ Tillbaka</button>
      <span class="wp-badge">🚠 ${esc(LIFT_TYPE_SV[lf.type] || "Lift")}</span>
      <h2 class="wp-title">${esc(lf.name)}</h2>
      <div class="wp-body">Liftens sträckning är markerad med en svart linje på kartan.</div>`;
    $("toList").addEventListener("click", showCoursePanel);
  }

  // =====================================================================
  //  Panel
  // =====================================================================
  function showCoursePanel() {
    selectedId = null; markers.forEach((m) => m.getElement().classList.remove("sel"));
    clearLiftHighlight();
    $("panelEdit").classList.add("hidden");
    const v = $("panelView"); v.classList.remove("hidden");
    const b = current, list = curWaypoints();
    const items = list.slice().sort((a, c) => (a.sort || 0) - (c.sort || 0)).map((wp) => {
      const t = ICON_GLYPH[wp.icon] ? wp.icon : "default";
      return `<div class="list-item" data-id="${esc(String(wp.id))}"><div class="list-ic">${ICON_GLYPH[t]}</div><div class="list-txt">${esc(wp.title || "Namnlös")}</div></div>`;
    }).join("");
    const lifts = (b.hasLifts && window.CANAZEI_LIFTS) ? window.CANAZEI_LIFTS : [];
    const liftItems = lifts.map((lf) =>
      `<div class="list-item" data-lift-id="${esc(lf.id)}"><div class="list-ic">🚠</div><div class="list-txt">${esc(lf.name)}<span class="list-sub">${esc(LIFT_TYPE_SV[lf.type] || "Lift")}</span></div></div>`).join("");
    v.innerHTML = `
      <div class="course-head">
        <div class="course-name">${b.icon} ${esc(b.name)}</div>
        <div class="course-stats">${esc(b.stats)}</div>
      </div>
      <p class="list-head">Hållpunkter (${list.length})</p>
      ${items || '<p class="muted">Inga hållpunkter än.</p>'}
      ${editing ? `<div class="btns"><button class="btn-primary" id="addNew">+ Lägg till hållpunkt</button></div>`
                : (canEdit ? `<p class="muted" style="margin-top:12px">Slå på redigering (✎) för att lägga till punkter.</p>` : "")}
      ${lifts.length ? `<p class="list-head" style="margin-top:18px">Liftar (${lifts.length})</p>${liftItems}` : ""}`;
    v.querySelectorAll("[data-id]").forEach((el) => el.addEventListener("click", () => selectWaypoint(coerceId(el.getAttribute("data-id")))));
    v.querySelectorAll("[data-lift-id]").forEach((el) => el.addEventListener("click", () => selectLift(el.getAttribute("data-lift-id"))));
    if (editing) $("addNew").addEventListener("click", () => startAdd());
    openPanel();
  }
  function coerceId(s) { const wp = waypoints.find((w) => String(w.id) === s); return wp ? wp.id : s; }

  function selectWaypoint(id) {
    clearLiftHighlight();
    selectedId = id; markers.forEach((m, mid) => m.getElement().classList.toggle("sel", mid === id));
    const wp = waypoints.find((w) => w.id === id); if (!wp) return;
    const m = markers.get(id);
    if (m) map.easeTo({ center: m.getLngLat(), duration: 700, offset: [window.innerWidth < 760 ? 0 : -160, 0] });
    if (editing) renderEdit(wp); else renderView(wp);
    openPanel();
  }
  function renderView(wp) {
    $("panelEdit").classList.add("hidden");
    const v = $("panelView"); v.classList.remove("hidden");
    const t = ICON_GLYPH[wp.icon] ? wp.icon : "default";
    const img = wp.image_url ? `<img class="wp-img" src="${esc(wp.image_url)}" alt="">` : "";
    v.innerHTML = `
      <button class="link-back" id="toList">‹ Alla hållpunkter</button>
      ${img}
      <span class="wp-badge">${ICON_GLYPH[t]} ${esc(ICON_LABEL[t])}</span>
      <h2 class="wp-title">${esc(wp.title || "Namnlös punkt")}</h2>
      <div class="wp-body">${esc(wp.body || "")}</div>
      ${editing ? `<div class="btns"><button class="btn-ghost" id="toEdit">✎ Redigera denna</button></div>` : ""}`;
    $("toList").addEventListener("click", showCoursePanel);
    if (editing) $("toEdit").addEventListener("click", () => renderEdit(wp));
  }
  function renderEdit(wp) {
    draft = Object.assign({}, wp);
    $("panelView").classList.add("hidden");
    const e = $("panelEdit"); e.classList.remove("hidden");
    const opts = ICON_ORDER.map((k) => `<option value="${k}" ${((draft.icon || "default") === k) ? "selected" : ""}>${ICON_GLYPH[k]} ${ICON_LABEL[k]}</option>`).join("");
    const thumb = draft.image_url ? `<img class="thumb" src="${esc(draft.image_url)}" alt="">` : "";
    const hint = current && current.type === "route"
      ? "📍 Punkten ligger på banan. Dra markören för att flytta – den snäpps till spåret."
      : "📍 Dra markören för att flytta punkten var du vill i området.";
    e.innerHTML = `
      <h2 class="wp-title">${draft.__isNew ? "Ny hållpunkt" : "Redigera"}</h2>
      <label>Rubrik</label>
      <input id="fTitle" type="text" value="${esc(draft.title || "")}" placeholder="t.ex. Lunch: Rifugio Belvedere">
      <label>Typ</label>
      <select id="fIcon">${opts}</select>
      <label>Text</label>
      <textarea id="fBody" placeholder="Beskrivning, tips...">${esc(draft.body || "")}</textarea>
      <label>Bild</label>
      <input id="fFile" type="file" accept="image/*">
      <div class="hint">Max 10 MB. Bilden sparas i din Supabase-lagring.</div>
      <div id="thumbWrap">${thumb}</div>
      <div class="hint" style="margin-top:12px">${hint}</div>
      <div class="btns">
        <button class="btn-primary" id="fSave">Spara</button>
        <button class="btn-ghost" id="fCancel">Avbryt</button>
        ${draft.__isNew ? "" : `<button class="btn-danger" id="fDelete">Ta bort</button>`}
      </div>`;
    $("fFile").addEventListener("change", onPickImage);
    $("fSave").addEventListener("click", onSave);
    $("fCancel").addEventListener("click", () => { if (draft && draft.__isNew) removeDraftMarker(); draft = null; showCoursePanel(); });
    if (!draft.__isNew) $("fDelete").addEventListener("click", onDelete);
  }

  async function onPickImage(ev) {
    const file = ev.target.files && ev.target.files[0]; if (!file) return;
    if (!sb) return status("Koppla Supabase för att ladda upp bilder.", "err", 4000);
    if (file.size > 10 * 1024 * 1024) return status("Bilden är för stor (max 10 MB).", "err", 4000);
    status("Laddar upp bild…");
    try {
      const id = draft.id || (draft.id = cryptoId());
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
      const path = `${id}/${Date.now()}.${ext}`;
      const { error } = await sb.storage.from(BUCKET).upload(path, file, { upsert: true, contentType: file.type });
      if (error) throw error;
      draft.image_url = sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
      $("thumbWrap").innerHTML = `<img class="thumb" src="${esc(draft.image_url)}" alt="">`;
      status("Bild uppladdad", "ok", 1500);
    } catch (e) { console.warn(e); status("Uppladdning misslyckades: " + (e.message || e), "err", 5000); }
  }
  async function onSave() {
    if (!sb) return status("Koppla Supabase i config.js för att spara.", "err", 4000);
    draft.title = $("fTitle").value.trim(); draft.icon = $("fIcon").value; draft.body = $("fBody").value;
    if (!draft.title) return status("Rubrik krävs.", "err", 3000);
    const row = { id: draft.id || cryptoId(), title: draft.title, icon: draft.icon, body: draft.body,
      lng: draft.lng, lat: draft.lat, image_url: draft.image_url || null,
      area_id: current ? current.id : "marcialonga", sort: draft.sort != null ? draft.sort : nextSort() };
    status("Sparar…");
    try {
      const { error } = await sb.from("waypoints").upsert(row);
      if (error) throw error;
      removeDraftMarker(); draft = null; status("Sparat", "ok", 1500);
      await loadWaypoints(); selectWaypoint(row.id);
    } catch (e) { console.warn(e); status("Kunde inte spara: " + (e.message || e), "err", 5000); }
  }
  async function onDelete() {
    if (!sb || !draft) return;
    if (!window.confirm("Ta bort denna hållpunkt?")) return;
    status("Tar bort…");
    try {
      const { error } = await sb.from("waypoints").delete().eq("id", draft.id);
      if (error) throw error;
      draft = null; selectedId = null; status("Borttagen", "ok", 1500);
      await loadWaypoints(); showCoursePanel();
    } catch (e) { console.warn(e); status("Kunde inte ta bort: " + (e.message || e), "err", 5000); }
  }

  function startAdd() {
    if (!canEdit) return;
    addMode = true;
    status(current && current.type === "route" ? "Klicka på banan där hållpunkten ska ligga…" : "Klicka där hållpunkten ska ligga…");
    map.getCanvas().style.cursor = "crosshair";
    map.once("click", (e) => {
      addMode = false; map.getCanvas().style.cursor = "";
      const p = snap(e.lngLat.lng, e.lngLat.lat);
      const id = cryptoId();
      draft = { __isNew: true, id, icon: "info", title: "", body: "", lng: p[0], lat: p[1], image_url: null, area_id: current.id, sort: nextSort() };
      const m = new maplibregl.Marker({ element: makeEl({ id, icon: "info", title: "Ny punkt" }), anchor: "center", draggable: true }).setLngLat(p).addTo(map);
      m.on("dragend", () => { const ll = m.getLngLat(); const sn = snap(ll.lng, ll.lat); m.setLngLat(sn); draft.lng = sn[0]; draft.lat = sn[1]; if ($("fLng")) { $("fLng").value = sn[0]; $("fLat").value = sn[1]; } });
      markers.set(id, m); selectedId = id; renderEdit(draft); openPanel(); status("");
    });
  }
  function removeDraftMarker() { if (draft && draft.__isNew && markers.has(draft.id)) { markers.get(draft.id).remove(); markers.delete(draft.id); } }

  // =====================================================================
  //  Redigeringsläge, inloggning, helpers
  // =====================================================================
  function setEditing(on) {
    editing = on && canEdit; document.body.classList.toggle("editing", editing); syncDraggable();
    if (!editing) { if (draft && draft.__isNew) removeDraftMarker(); draft = null; }
  }
  function wireLogin() {
    $("btnLogin").addEventListener("click", () => {
      if (!sb) return status("Koppla Supabase i config.js först.", "err", 4000);
      if (canEdit) { setEditing(!editing); if (view === "course") showCoursePanel(); return; }
      openModal();
    });
    $("loginCancel").addEventListener("click", closeModal);
    $("loginSend").addEventListener("click", async () => {
      const email = $("loginEmail").value.trim();
      if (!email) return ($("loginMsg").textContent = "Ange en e-postadress.");
      $("loginMsg").textContent = "Skickar…";
      try {
        const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin + window.location.pathname } });
        if (error) throw error;
        $("loginMsg").textContent = "Klart! Kolla din e-post och klicka på länken.";
      } catch (e) { $("loginMsg").textContent = "Fel: " + (e.message || e); }
    });
  }
  function openModal() { $("loginModal").classList.remove("hidden"); $("loginEmail").focus(); }
  function closeModal() { $("loginModal").classList.add("hidden"); $("loginMsg").textContent = ""; }
  function openPanel() { const p = $("panel"); p.classList.remove("hidden"); p.setAttribute("aria-hidden", "false"); }
  function closePanel() { const p = $("panel"); p.classList.add("hidden"); p.setAttribute("aria-hidden", "true"); selectedId = null; markers.forEach((m) => m.getElement().classList.remove("sel")); }

  let statusTimer = null;
  function status(msg, kind, ms) {
    const el = $("status"); if (!msg) { el.classList.add("hidden"); return; }
    el.textContent = msg; el.className = kind || ""; el.classList.remove("hidden");
    if (statusTimer) clearTimeout(statusTimer);
    if (ms) statusTimer = setTimeout(() => el.classList.add("hidden"), ms);
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  function cryptoId() { return (crypto && crypto.randomUUID) ? crypto.randomUUID() : "x" + Date.now() + Math.random().toString(16).slice(2); }
  function nextSort() { return waypoints.reduce((m, w) => Math.max(m, w.sort || 0), 0) + 1; }

  // =====================================================================
  //  Start
  // =====================================================================
  function main() {
    if (!window.maplibregl) { document.body.innerHTML = "<p style='padding:20px'>Kunde inte ladda kartbiblioteket.</p>"; return; }
    initMap();
    $("panelClose").addEventListener("click", () => { if (view === "course") showCoursePanel(); closePanel(); });
    $("btnBack").addEventListener("click", exitCourse);
    $("btnList").addEventListener("click", showCoursePanel);
    wireLogin();
    initSupabase();
    if (map.loaded()) loadWaypoints(); else map.on("load", loadWaypoints);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeModal(); if (view === "course") closePanel(); } });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", main); else main();
})();
