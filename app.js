/* =====================================================================
   Marcialonga 2027 – 3D-karta
   MapLibre GL JS + Supabase.
   - Banor: Marcialonga (rutt) + Canazei (skidområde, Sellaronda)
   - Liftar: klustrade markörer, grupperade per typ i listan
   - Hållpunkter: egna grupper (namn + ikon), expanderbara listor
   ===================================================================== */
(function () {
  "use strict";

  const CFG = window.APP_CONFIG || {};
  const $ = (id) => document.getElementById(id);

  const LIFT_TYPE_SV = { gondola: "Kabinbana (gondol)", cable_car: "Linbana", chair_lift: "Stollift",
    drag_lift: "Släplift", platter: "Tallrikslift", "t-bar": "Ankarlift", "j-bar": "J-bygellift",
    magic_carpet: "Rullband", mixed_lift: "Kombibana", rope_tow: "Draglina" };
  const LIFT_TYPE_ORDER = ["cable_car", "gondola", "chair_lift", "mixed_lift", "t-bar", "j-bar", "platter", "drag_lift", "rope_tow", "magic_carpet"];
  const ICON_PALETTE = ["ℹ️","🍽","☕","🍺","🍷","📷","🏨","🅿️","🚠","🎿","⛰","🏔","⚠️","🚻","🎯","⭐","❤️","🏁","🚩","💧","🥐","🧀","🛒","🎪"];
  const DEFAULT_ICON = "📍";
  const COLOR_PALETTE = ["#e23b3b","#f59e0b","#eab308","#22c55e","#14b8a6","#2b6cb0","#6366f1","#a855f7","#ec4899","#64748b"];
  const DEFAULT_COLOR = "#e23b3b";
  const BUCKET = "waypoint-images";

  const BANOR = [
    { id: "marcialonga", type: "route", icon: "🎿", name: "Marcialonga",
      stats: "69,9 km · 798–1449 m ö.h.", mask: { clearKm: 5, rings: [6, 7, 8, 9, 10] } },
    { id: "canazei", type: "ski", icon: "⛷", name: "Canazei – skidområde",
      stats: "Liftar & pister · Sellaronda", pill: { lng: 11.7700, lat: 46.4767 },
      bbox: [11.70, 46.43, 11.95, 46.58], overlay: "https://www.opensnowmap.org/pistes/{z}/{x}/{y}.png",
      overlayAttr: "Pister & liftar © OpenSnowMap, OpenStreetMap", hasLifts: true,
      mask: { clearKm: 2, rings: [4, 7, 10, 14, 18] } },
  ];
  const MASK_OPS = [0.2, 0.4, 0.6, 0.78, 0.9], MASK_FAR_OP = 0.96, MASK_COLOR = "#f6f4ee";
  const banaById = (id) => BANOR.find((b) => b.id === id);

  // ---- Tillstånd ----
  let map = null, sb = null;
  let view = "overview", current = null;
  let editing = false, canEdit = false;
  let waypoints = [], groups = [], usingDefaults = true;
  let editMarker = null;               // enda draggbara HTML-markör (redigering/ny punkt)
  const pills = [];
  const expanded = new Set();          // vilka accordion-sektioner som är öppna
  let selectedId = null, draft = null, addMode = false, newGroupOpen = false, pickIcon = DEFAULT_ICON, pickColor = DEFAULT_COLOR, pickAlways = false;
  let peekTarget = null;               // { kind:"wp"|"lift", id } – vald punkt visad som kompakt rad
  let mode = "sommar";
  try {
    const saved = localStorage.getItem("mly-mode") || localStorage.getItem("mly-season");
    if (saved === "winter") mode = "vinter";
    else if (saved === "summer") mode = "sommar";
    else if (saved) mode = saved;
  } catch (e) {}

  // =====================================================================
  //  Kartstil
  // =====================================================================
  function buildStyle() {
    // Vinter-baslager definieras direkt i stilen (ej via addSource i efterhand),
    // eftersom MapLibre med 3D-terräng aldrig rapporterar stilen som "loaded".
    const sources = {
      satellite: { type: "raster", tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
        tileSize: 256, maxzoom: 19, attribution: "Satellit © Esri, Maxar, Earthstar Geographics" },
      terrarium: { type: "raster-dem", tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
        encoding: "terrarium", tileSize: 256, maxzoom: 15, attribution: "Höjddata: Mapzen / AWS Terrain Tiles" },
      "route-pos": { type: "geojson", data: { type: "FeatureCollection", features: [] } },
    };
    const baseLayers = [];
    if (cfgHas("MAPTILER_KEY")) {
      sources["maptiler-winter"] = { type: "raster", tiles: [`https://api.maptiler.com/maps/winter/256/{z}/{x}/{y}.png?key=${String(CFG.MAPTILER_KEY).trim()}`],
        tileSize: 256, maxzoom: 22, attribution: "© MapTiler © OpenStreetMap contributors" };
      baseLayers.push({ id: "base-maptiler-winter", type: "raster", source: "maptiler-winter", layout: { visibility: "none" } });
    }
    if (cfgHas("SENTINEL_WMS")) {
      sources["sentinel-winter"] = { type: "raster", tiles: [String(CFG.SENTINEL_WMS).trim()],
        tileSize: 512, maxzoom: 17, attribution: "Sentinel-2 © Copernicus / ESA" };
      baseLayers.push({ id: "base-sentinel-winter", type: "raster", source: "sentinel-winter", layout: { visibility: "none" } });
    }
    const style = {
      version: 8,
      glyphs: "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf",
      sources,
      layers: [
        { id: "bg", type: "background", paint: { "background-color": "#9fc0e6" } },
        { id: "satellite", type: "raster", source: "satellite" },
        ...baseLayers,
        { id: "hillshade", type: "hillshade", source: "terrarium", paint: { "hillshade-exaggeration": 0.35, "hillshade-shadow-color": "#1b2430" } },
        { id: "winter-snow", type: "background", paint: { "background-color": "#f5fbff", "background-opacity": 0 } },
        { id: "route-pos-dot", type: "circle", source: "route-pos", layout: { visibility: "none" }, paint: { "circle-radius": 7, "circle-color": "#ff6a2b", "circle-stroke-color": "#fff", "circle-stroke-width": 3 } },
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
      addLabels(); addRoute(); registerLiftHandlers(); registerWaypointHandlers();
      applyMode();
      enterOverview(true);
    });
    map.on("error", (e) => console.warn("Kartfel:", e && e.error ? e.error.message : e));
    $("btnReset").addEventListener("click", () => { if (view === "course") frameCurrent(); else resetOverview(); });
    $("btnProfile").addEventListener("click", toggleProfile);
    $("profClose").addEventListener("click", closeProfile);
    window.addEventListener("resize", () => { if (profileOpen) renderProfile(); });
    $("btnSeason").addEventListener("click", (e) => { e.stopPropagation(); toggleModeMenu(); });
  }

  function addLabels() {
    if (map.getSource("esri-ref")) return;
    map.addSource("esri-ref", { type: "raster",
      tiles: ["https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"],
      tileSize: 256, maxzoom: 19, attribution: "Ortnamn © Esri" });
    map.addLayer({ id: "place-labels", type: "raster", source: "esri-ref", paint: { "raster-opacity": 1 } });
  }

  function addRoute() {
    const route = window.ROUTE_GEOJSON;
    if (!route || map.getSource("route")) return;
    map.addSource("route", { type: "geojson", data: route });
    map.addLayer({ id: "route-casing", type: "line", source: "route", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#10243a", "line-width": 7, "line-opacity": 0.9 } });
    map.addLayer({ id: "route-line", type: "line", source: "route", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#ff6a2b", "line-width": 3.6 } });
    map.addLayer({ id: "route-hit", type: "line", source: "route", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#000", "line-opacity": 0.01, "line-width": 24 } });
    map.on("click", "route-hit", () => { if (view === "overview") enterBana(banaById("marcialonga")); });
    map.on("mouseenter", "route-hit", () => { if (view === "overview") map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", "route-hit", () => { map.getCanvas().style.cursor = ""; });
    map.addSource("lift-hl", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({ id: "lift-hl-casing", type: "line", source: "lift-hl", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#ffffff", "line-width": 8, "line-opacity": 0.85 } });
    map.addLayer({ id: "lift-hl-l", type: "line", source: "lift-hl", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#000000", "line-width": 4.5 } });
  }
  function setRouteVisible(v) { ["route-casing", "route-line", "route-hit"].forEach((id) => { if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", v ? "visible" : "none"); }); }
  function setLiftHighlight(coords) { const s = map.getSource("lift-hl"); if (s) s.setData({ type: "Feature", geometry: { type: "LineString", coordinates: densify(coords, 40) }, properties: {} }); }
  function clearLiftHighlight() { const s = map.getSource("lift-hl"); if (s) s.setData({ type: "FeatureCollection", features: [] }); }
  function densify(coords, stepM) {
    const out = [];
    for (let i = 0; i < coords.length - 1; i++) {
      const a = coords[i], b = coords[i + 1]; out.push(a);
      const dLng = b[0] - a[0], dLat = b[1] - a[1], kx = Math.cos(a[1] * Math.PI / 180);
      const n = Math.max(1, Math.floor(Math.hypot(dLat, dLng * kx) * 111320 / stepM));
      for (let j = 1; j < n; j++) out.push([a[0] + dLng * j / n, a[1] + dLat * j / n]);
    }
    out.push(coords[coords.length - 1]); return out;
  }

  // =====================================================================
  //  Lägen – sommar / stiliserad vinter / MapTiler-vinterkarta / vintersatellit
  // =====================================================================
  const SKY_SUMMER = { "sky-color": "#aed2f5", "horizon-color": "#eaf2fb", "fog-color": "#dfeaf6", "sky-horizon-blend": 0.5, "horizon-fog-blend": 0.6, "fog-ground-blend": 0.3 };
  const SKY_WINTER = { "sky-color": "#cfe4fb", "horizon-color": "#f6faff", "fog-color": "#eef4fb", "sky-horizon-blend": 0.6, "horizon-fog-blend": 0.6, "fog-ground-blend": 0.22 };
  const SAT_SUMMER = { "raster-saturation": 0, "raster-contrast": 0, "raster-brightness-min": 0, "raster-brightness-max": 1 };
  const SAT_WINTER = { "raster-saturation": -0.55, "raster-contrast": -0.07, "raster-brightness-min": 0.12, "raster-brightness-max": 1 };

  const MODES = {
    sommar:      { label: "☀️ Sommar",              short: "☀️", base: "satellite",       sat: SAT_SUMMER, snow: 0,    hillExag: 0.35, hillShadow: "#1b2430", sky: SKY_SUMMER },
    vinter:      { label: "❄️ Vinter (stiliserad)",  short: "❄️", base: "satellite",       sat: SAT_WINTER, snow: 0.26, hillExag: 0.55, hillShadow: "#49607b", sky: SKY_WINTER },
    vinterkarta: { label: "🗺️ Vinterkarta",          short: "🗺️", base: "maptiler-winter",                   snow: 0,    hillExag: 0.30, hillShadow: "#64748b", sky: SKY_WINTER, needs: "MAPTILER_KEY" },
    vintersat:   { label: "🛰️ Äkta vintersatellit",  short: "🛰️", base: "sentinel-winter",                   snow: 0,    hillExag: 0.12, hillShadow: "#49607b", sky: SKY_WINTER, needs: "SENTINEL_WMS" },
  };
  const MODE_ORDER = ["sommar", "vinter", "vinterkarta", "vintersat"];
  function cfgHas(name) { return !!(CFG[name] && String(CFG[name]).trim()); }

  function setBaseVisible(which) {
    const all = { satellite: "satellite", "maptiler-winter": "base-maptiler-winter", "sentinel-winter": "base-sentinel-winter" };
    for (const k in all) { const lid = all[k]; if (map.getLayer(lid)) map.setLayoutProperty(lid, "visibility", which === k ? "visible" : "none"); }
  }
  function modeAvailable(key) { const m = MODES[key]; return m && (!m.needs || map.getLayer("base-" + m.base)); }

  function applyMode() {
    if (!modeAvailable(mode)) mode = "vinter";
    const m = MODES[mode] || MODES.sommar;
    try {
      // Baslagren finns redan i stilen (byggda i buildStyle); här togglas bara synlighet.
      let baseKey = "satellite";
      if (m.base === "maptiler-winter" && map.getLayer("base-maptiler-winter")) baseKey = "maptiler-winter";
      else if (m.base === "sentinel-winter" && map.getLayer("base-sentinel-winter")) baseKey = "sentinel-winter";
      setBaseVisible(baseKey);
      if (m.sat && map.getLayer("satellite")) for (const k in m.sat) map.setPaintProperty("satellite", k, m.sat[k]);
      if (map.getLayer("winter-snow")) map.setPaintProperty("winter-snow", "background-opacity", m.snow);
      if (map.getLayer("hillshade")) {
        map.setPaintProperty("hillshade", "hillshade-exaggeration", m.hillExag);
        map.setPaintProperty("hillshade", "hillshade-shadow-color", m.hillShadow);
      }
      try { if (map.setSky) map.setSky(m.sky); } catch (e) {}
    } catch (e) { console.warn("Läge:", e); }
    updateModeBtn();
  }
  function setMode(key) {
    if (!modeAvailable(key)) return;
    mode = key;
    try { localStorage.setItem("mly-mode", mode); } catch (e) {}
    applyMode();
    closeModeMenu();
  }
  function updateModeBtn() {
    const b = $("btnSeason"); if (!b) return;
    const m = MODES[mode] || MODES.sommar;
    b.textContent = m.label;
    b.title = "Byt kartläge";
    b.classList.toggle("active", mode !== "sommar");
  }
  let modeMenuEl = null;
  function closeModeMenu() { if (modeMenuEl) { modeMenuEl.remove(); modeMenuEl = null; document.removeEventListener("click", onDocClickMode, true); } }
  function onDocClickMode(e) { if (modeMenuEl && !modeMenuEl.contains(e.target) && e.target !== $("btnSeason")) closeModeMenu(); }
  function toggleModeMenu() {
    if (modeMenuEl) { closeModeMenu(); return; }
    const btn = $("btnSeason"); if (!btn) return;
    const menu = document.createElement("div");
    menu.className = "mode-menu";
    MODE_ORDER.forEach((key) => {
      const m = MODES[key];
      const row = document.createElement("button");
      const avail = modeAvailable(key);
      row.className = "mode-row" + (key === mode ? " cur" : "") + (avail ? "" : " off");
      row.innerHTML = `<span class="mode-ico">${m.short}</span><span class="mode-lbl">${m.label.replace(/^\S+\s/, "")}</span>` + (avail ? (key === mode ? `<span class="mode-chk">✓</span>` : "") : `<span class="mode-note">lägg till nyckel</span>`);
      if (avail) row.addEventListener("click", (e) => { e.stopPropagation(); setMode(key); });
      else row.disabled = true;
      menu.appendChild(row);
    });
    document.body.appendChild(menu);
    const r = btn.getBoundingClientRect();
    menu.style.top = (r.bottom + 8) + "px";
    menu.style.right = Math.max(8, window.innerWidth - r.right) + "px";
    modeMenuEl = menu;
    setTimeout(() => document.addEventListener("click", onDocClickMode, true), 0);
  }

  // =====================================================================
  //  Liftar – klustrade markörer
  // =====================================================================
  function liftFC() {
    return { type: "FeatureCollection", features: (window.CANAZEI_LIFTS || []).map((lf) => ({ type: "Feature", properties: { id: lf.id, name: lf.name, type: lf.type }, geometry: { type: "Point", coordinates: lf.mid } })) };
  }
  function addLiftCluster() {
    if (map.getSource("lifts")) return;
    map.addSource("lifts", { type: "geojson", data: liftFC(), cluster: true, clusterRadius: 46, clusterMaxZoom: 13 });
    const before = map.getLayer("lift-hl-casing") ? "lift-hl-casing" : undefined;
    map.addLayer({ id: "lift-clusters", type: "circle", source: "lifts", filter: ["has", "point_count"],
      paint: { "circle-color": "#2b6cb0", "circle-opacity": 0.92, "circle-stroke-color": "#dbeafe", "circle-stroke-width": 2,
        "circle-radius": ["step", ["get", "point_count"], 15, 5, 19, 15, 24, 40, 30] } }, before);
    map.addLayer({ id: "lift-cluster-count", type: "symbol", source: "lifts", filter: ["has", "point_count"],
      layout: { "text-field": ["get", "point_count_abbreviated"], "text-font": ["Open Sans Bold"], "text-size": 13 }, paint: { "text-color": "#fff" } }, before);
    map.addLayer({ id: "lift-points", type: "circle", source: "lifts", filter: ["!", ["has", "point_count"]],
      paint: { "circle-color": "#2b6cb0", "circle-radius": 7, "circle-stroke-color": "#dbeafe", "circle-stroke-width": 2 } }, before);
    map.addLayer({ id: "lift-points-sel", type: "circle", source: "lifts", filter: ["==", ["get", "id"], "__none__"],
      paint: { "circle-color": "#ff6a2b", "circle-radius": 9, "circle-stroke-color": "#fff", "circle-stroke-width": 3 } }, before);
    map.addLayer({ id: "lift-hit", type: "circle", source: "lifts", filter: ["!", ["has", "point_count"]],
      paint: { "circle-color": "#000", "circle-opacity": 0.01, "circle-radius": 20 } }, before);
  }
  function removeLiftCluster() {
    ["lift-clusters", "lift-cluster-count", "lift-points", "lift-points-sel", "lift-hit"].forEach((id) => { if (map.getLayer(id)) map.removeLayer(id); });
    if (map.getSource("lifts")) map.removeSource("lifts");
  }
  function registerLiftHandlers() {
    map.on("click", "lift-clusters", (e) => {
      const f = map.queryRenderedFeatures(e.point, { layers: ["lift-clusters"] })[0]; if (!f) return;
      map.getSource("lifts").getClusterExpansionZoom(f.properties.cluster_id).then((z) => map.easeTo({ center: f.geometry.coordinates, zoom: z + 0.3, pitch: 45 })).catch(() => {});
    });
    map.on("click", "lift-hit", (e) => { if (e.features && e.features[0]) selectLift(e.features[0].properties.id, true); });
    ["lift-clusters", "lift-hit"].forEach((id) => {
      map.on("mouseenter", id, () => map.getCanvas().style.cursor = "pointer");
      map.on("mouseleave", id, () => map.getCanvas().style.cursor = "");
    });
  }
  function highlightLiftPoint(id) { if (map.getLayer("lift-points-sel")) map.setFilter("lift-points-sel", ["==", ["get", "id"], id || "__none__"]); }

  // =====================================================================
  //  Etiketter (pills)
  // =====================================================================
  function routeCoords() { return (window.ROUTE_GEOJSON && window.ROUTE_GEOJSON.geometry.coordinates) || []; }
  function routeBounds() { const b = new maplibregl.LngLatBounds(); routeCoords().forEach((p) => b.extend(p)); return b; }
  function banaPill(b) { return b.type === "route" ? routeCoords()[Math.floor(routeCoords().length / 2)] : [b.pill.lng, b.pill.lat]; }
  function addPills() {
    removePills();
    BANOR.forEach((b) => {
      const el = document.createElement("div");
      el.className = "course-pill"; el.innerHTML = `<span class="cp-ic">${b.icon}</span> ${esc(b.name)} <span class="cp-arrow">›</span>`;
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
    removeMask(); removeOverlay(); removeLiftCluster(); removeWaypointCluster(); removeEditMarker(); clearLiftHighlight(); highlightLiftPoint(null); closePanel(); peekCloseClear(); closeProfile();
    if ($("btnProfile")) $("btnProfile").classList.add("hidden");
    setRouteVisible(true); addPills();
    if (!initial) resetOverview();
  }
  function resetOverview() { const s = CFG.START; map.easeTo({ center: [s.lng, s.lat], zoom: s.zoom, pitch: s.pitch, bearing: s.bearing, duration: 1100 }); }

  function enterBana(b) {
    if (view === "course" && current && current.id === b.id) return;
    current = b; view = "course"; expanded.clear();
    document.body.classList.add("in-course");
    removePills(); clearLiftHighlight(); highlightLiftPoint(null);
    setRouteVisible(b.type === "route");
    removeOverlay(); if (b.overlay) addOverlay(b);
    removeLiftCluster(); if (b.hasLifts && window.CANAZEI_LIFTS) { addLiftCluster(); expanded.add("lifts"); }
    frameCurrent(); showMask(b); addWaypointCluster();
    if (map.getLayer("lift-hl-casing")) map.moveLayer("lift-hl-casing");
    if (map.getLayer("lift-hl-l")) map.moveLayer("lift-hl-l");
    closeProfile(); registerRouteHover();
    $("btnProfile").classList.toggle("hidden", !hasProfile());
    renderPanel();
  }
  function exitCourse() { enterOverview(false); }

  function frameCurrent() {
    const b = current; if (!b) return;
    const narrow = window.innerWidth < 760, pad = { top: 70, bottom: 70, left: 40, right: narrow ? 40 : 400 };
    if (b.type === "route") map.fitBounds(routeBounds(), { padding: pad, pitch: 60, duration: 1300, maxZoom: 13.5 });
    else map.fitBounds([[b.bbox[0], b.bbox[1]], [b.bbox[2], b.bbox[3]]], { padding: pad, pitch: 50, duration: 1300, maxZoom: 13.5 });
  }

  function addOverlay(b) {
    if (!map.getSource("ski-overlay")) map.addSource("ski-overlay", { type: "raster", tiles: [b.overlay], tileSize: 256, maxzoom: 18, attribution: b.overlayAttr || "" });
    if (!map.getLayer("ski-overlay-l")) map.addLayer({ id: "ski-overlay-l", type: "raster", source: "ski-overlay", paint: { "raster-opacity": 1 } }, map.getLayer("route-casing") ? "route-casing" : undefined);
  }
  function removeOverlay() { if (map.getLayer("ski-overlay-l")) map.removeLayer("ski-overlay-l"); if (map.getSource("ski-overlay")) map.removeSource("ski-overlay"); }

  function showMask(b) {
    if (!window.turf || !map.getLayer("route-casing")) return;
    removeMask();
    try {
      const geom = b.type === "route" ? window.turf.lineString(routeCoords()) : window.turf.bboxPolygon(b.bbox);
      const radii = [b.mask.clearKm, ...b.mask.rings], buf = radii.map((r) => window.turf.buffer(geom, r, { units: "kilometers" }));
      const bb = window.turf.bbox(buf[buf.length - 1]), pad = 0.8;
      const world = window.turf.bboxPolygon([bb[0] - pad, bb[1] - pad, bb[2] + pad, bb[3] + pad]), feats = [];
      const outer = window.turf.difference(world, buf[buf.length - 1]);
      if (outer) feats.push({ type: "Feature", properties: { op: MASK_FAR_OP }, geometry: outer.geometry });
      for (let i = buf.length - 1; i >= 1; i--) { const ring = window.turf.difference(buf[i], buf[i - 1]); if (ring) feats.push({ type: "Feature", properties: { op: MASK_OPS[i - 1] }, geometry: ring.geometry }); }
      map.addSource("mask", { type: "geojson", data: { type: "FeatureCollection", features: feats } });
      map.addLayer({ id: "mask-fill", type: "fill", source: "mask", paint: { "fill-color": MASK_COLOR, "fill-opacity": ["get", "op"], "fill-antialias": false } }, "route-casing");
    } catch (e) { console.warn("Mask:", e); }
  }
  function removeMask() { if (map.getLayer("mask-fill")) map.removeLayer("mask-fill"); if (map.getSource("mask")) map.removeSource("mask"); }

  // =====================================================================
  //  Supabase
  // =====================================================================
  function initSupabase() {
    const url = (CFG.SUPABASE_URL || "").trim(), anon = (CFG.SUPABASE_ANON_KEY || "").trim();
    if (!url || !anon || !window.supabase) { status("Visar exempelpunkter. Koppla Supabase i config.js för att spara och redigera.", "", 6000); return false; }
    try { sb = window.supabase.createClient(url, anon); } catch (e) { console.warn(e); return false; }
    sb.auth.getSession().then(({ data }) => setEditor(!!(data && data.session)));
    sb.auth.onAuthStateChange((_e, session) => setEditor(!!session));
    try {
      sb.channel("wp-changes")
        .on("postgres_changes", { event: "*", schema: "public", table: "waypoints" }, () => loadWaypoints())
        .on("postgres_changes", { event: "*", schema: "public", table: "groups" }, () => loadGroups())
        .subscribe();
    } catch (e) {}
    return true;
  }
  function setEditor(hasSession) {
    canEdit = hasSession;
    $("btnLogin").textContent = hasSession ? "✎ Redigerar" : "✎ Redigera";
    $("btnLogin").classList.toggle("active", hasSession);
    if (!hasSession) setEditing(false);
  }
  async function loadGroups() {
    if (!sb) { groups = []; return; }
    try { const { data, error } = await sb.from("groups").select("*").order("sort", { ascending: true }); if (!error && data) { groups = data; if (view === "course") { updateWps(); refreshPanelIfList(); } } }
    catch (e) { console.warn("Läsa grupper:", e); }
  }
  async function loadWaypoints() {
    if (sb) {
      try {
        const { data, error } = await sb.from("waypoints").select("*").order("sort", { ascending: true });
        if (error) throw error;
        if (data) { waypoints = data; usingDefaults = false; if (view === "course") updateWps(); if (view === "course") refreshPanelIfList(); return; }
      } catch (e) { console.warn("Läsa punkter:", e); }
    }
    waypoints = (window.DEFAULT_WAYPOINTS || []).slice(); usingDefaults = true; if (view === "course") updateWps();
  }
  function refreshPanelIfList() { const v = $("panelView"); if (!v.classList.contains("hidden") && v.querySelector(".course-head")) renderPanel(); }

  function curWaypoints() { const id = current ? current.id : null; return waypoints.filter((w) => (w.area_id || "marcialonga") === id); }
  function curGroups() { const id = current ? current.id : null; return groups.filter((g) => (g.area_id || "marcialonga") === id).sort((a, b) => (a.sort || 0) - (b.sort || 0)); }
  function groupById(id) { return groups.find((g) => g.id === id); }
  function wpIcon(wp) { const g = groupById(wp.group_id); return g ? g.icon : DEFAULT_ICON; }
  function wpColor(wp) { const g = groupById(wp.group_id); return (g && g.color) ? g.color : DEFAULT_COLOR; }
  function wpAlways(wp) { const g = groupById(wp.group_id); return !!(g && g.always_visible); }

  // =====================================================================
  //  Snäppning
  // =====================================================================
  function snap(lng, lat) {
    if (!current || current.type !== "route") return [+lng.toFixed(6), +lat.toFixed(6)];
    const c = routeCoords(); if (c.length < 2) return [lng, lat];
    const kx = Math.cos(lat * Math.PI / 180), px = lng * kx, py = lat; let best = null, bd = Infinity;
    for (let i = 0; i < c.length - 1; i++) {
      const ax = c[i][0] * kx, ay = c[i][1], bx = c[i + 1][0] * kx, by = c[i + 1][1], dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
      let t = L > 0 ? ((px - ax) * dx + (py - ay) * dy) / L : 0; t = Math.max(0, Math.min(1, t));
      const cx = ax + t * dx, cy = ay + t * dy, d = (px - cx) ** 2 + (py - cy) ** 2; if (d < bd) { bd = d; best = [cx / kx, cy]; }
    }
    return best ? [+best[0].toFixed(6), +best[1].toFixed(6)] : [lng, lat];
  }

  // =====================================================================
  //  Hållpunkter – klustrade (röda), + en draggbar markör vid redigering
  // =====================================================================
  function wpFeat(w) { return { type: "Feature", properties: { id: w.id, color: wpColor(w) }, geometry: { type: "Point", coordinates: [w.lng, w.lat] } }; }
  function wpParts() {
    const edId = draft ? draft.id : null;
    const all = curWaypoints().filter((w) => w.id !== edId && typeof w.lng === "number" && typeof w.lat === "number");
    return {
      clustered: { type: "FeatureCollection", features: all.filter((w) => !wpAlways(w)).map(wpFeat) },
      always: { type: "FeatureCollection", features: all.filter((w) => wpAlways(w)).map(wpFeat) },
    };
  }
  function addWaypointCluster() {
    if (map.getSource("wps")) { updateWps(); return; }
    const parts = wpParts();
    const before = map.getLayer("lift-hl-casing") ? "lift-hl-casing" : undefined;
    // --- Klustrade hållpunkter (ej alltid-synliga grupper) ---
    map.addSource("wps", { type: "geojson", data: parts.clustered, cluster: true, clusterRadius: 44, clusterMaxZoom: 14 });
    map.addLayer({ id: "wp-clusters", type: "circle", source: "wps", filter: ["has", "point_count"],
      paint: { "circle-color": "#334155", "circle-opacity": 0.92, "circle-stroke-color": "#e5edf7", "circle-stroke-width": 2,
        "circle-radius": ["step", ["get", "point_count"], 17, 5, 21, 15, 26, 40, 32] } }, before);
    map.addLayer({ id: "wp-cluster-count", type: "symbol", source: "wps", filter: ["has", "point_count"],
      layout: { "text-field": ["get", "point_count_abbreviated"], "text-font": ["Open Sans Bold"], "text-size": 13 }, paint: { "text-color": "#fff" } }, before);
    map.addLayer({ id: "wp-points", type: "circle", source: "wps", filter: ["!", ["has", "point_count"]],
      paint: { "circle-color": ["get", "color"], "circle-radius": 8, "circle-stroke-color": "#fff", "circle-stroke-width": 2 } }, before);
    map.addLayer({ id: "wp-points-sel", type: "circle", source: "wps", filter: ["==", ["get", "id"], "__none__"],
      paint: { "circle-color": "#ff6a2b", "circle-radius": 10, "circle-stroke-color": "#fff", "circle-stroke-width": 3 } }, before);
    // Större, nästan osynlig klickyta för enskilda punkter
    map.addLayer({ id: "wp-hit", type: "circle", source: "wps", filter: ["!", ["has", "point_count"]],
      paint: { "circle-color": "#000", "circle-opacity": 0.01, "circle-radius": 20 } }, before);
    // --- Alltid synliga hållpunkter (t.ex. boenden), oklustrat ---
    map.addSource("wps-always", { type: "geojson", data: parts.always });
    map.addLayer({ id: "wpa-points", type: "circle", source: "wps-always",
      paint: { "circle-color": ["get", "color"], "circle-radius": 9, "circle-stroke-color": "#fff", "circle-stroke-width": 2.5 } }, before);
    map.addLayer({ id: "wpa-points-sel", type: "circle", source: "wps-always", filter: ["==", ["get", "id"], "__none__"],
      paint: { "circle-color": "#ff6a2b", "circle-radius": 11, "circle-stroke-color": "#fff", "circle-stroke-width": 3 } }, before);
    map.addLayer({ id: "wpa-hit", type: "circle", source: "wps-always",
      paint: { "circle-color": "#000", "circle-opacity": 0.01, "circle-radius": 20 } }, before);
  }
  function updateWps() {
    const parts = wpParts();
    if (map.getSource("wps")) map.getSource("wps").setData(parts.clustered);
    if (map.getSource("wps-always")) map.getSource("wps-always").setData(parts.always);
  }
  function removeWaypointCluster() {
    ["wp-clusters", "wp-cluster-count", "wp-points", "wp-points-sel", "wp-hit", "wpa-points", "wpa-points-sel", "wpa-hit"].forEach((id) => { if (map.getLayer(id)) map.removeLayer(id); });
    ["wps", "wps-always"].forEach((s) => { if (map.getSource(s)) map.removeSource(s); });
  }
  function registerWaypointHandlers() {
    map.on("click", "wp-clusters", (e) => {
      const f = map.queryRenderedFeatures(e.point, { layers: ["wp-clusters"] })[0]; if (!f) return;
      map.getSource("wps").getClusterExpansionZoom(f.properties.cluster_id).then((z) => map.easeTo({ center: f.geometry.coordinates, zoom: z + 0.3 })).catch(() => {});
    });
    map.on("click", "wp-hit", (e) => { if (e.features && e.features[0]) selectWaypoint(e.features[0].properties.id, true); });
    map.on("click", "wpa-hit", (e) => { if (e.features && e.features[0]) selectWaypoint(e.features[0].properties.id, true); });
    ["wp-clusters", "wp-hit", "wpa-hit"].forEach((id) => { map.on("mouseenter", id, () => map.getCanvas().style.cursor = "pointer"); map.on("mouseleave", id, () => map.getCanvas().style.cursor = ""); });
  }
  function highlightWp(id) {
    const f = ["==", ["get", "id"], id || "__none__"];
    if (map.getLayer("wp-points-sel")) map.setFilter("wp-points-sel", f);
    if (map.getLayer("wpa-points-sel")) map.setFilter("wpa-points-sel", f);
  }

  // =====================================================================
  //  Banprofil (höjdprofil) med kopplad hover karta <-> profil
  // =====================================================================
  const PROF = { padL: 42, padR: 14, padT: 14, padB: 26, H: 150, W: 600 };
  let profileOpen = false, profSvg = null, routeHoverOn = false;
  function profData() { return window.ROUTE_PROFILE; }
  function hasProfile() { return current && current.type === "route" && profData(); }
  function px(d) { const P = profData(); return PROF.padL + (d / P.distKm) * (PROF.W - PROF.padL - PROF.padR); }
  function pxInv(x) { const P = profData(); return ((x - PROF.padL) / (PROF.W - PROF.padL - PROF.padR)) * P.distKm; }
  function py(e) { const P = profData(); const span = (P.eleMax - P.eleMin) || 1; return PROF.padT + (1 - (e - P.eleMin) / span) * (PROF.H - PROF.padT - PROF.padB); }
  function slopeColor(s) { if (s <= -4) return "#38bdf8"; if (s < 2) return "#8aa0b4"; if (s < 5) return "#eab308"; if (s < 8) return "#ff8c3b"; return "#e23b3b"; }
  function profAt(d) {
    const p = profData().pts; if (d <= p[0].d) return p[0]; if (d >= p[p.length - 1].d) return p[p.length - 1];
    let lo = 0, hi = p.length - 1; while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (p[mid].d < d) lo = mid; else hi = mid; }
    const a = p[lo], b = p[hi], t = (d - a.d) / ((b.d - a.d) || 1);
    return { d, e: a.e + (b.e - a.e) * t, lng: a.lng + (b.lng - a.lng) * t, lat: a.lat + (b.lat - a.lat) * t };
  }
  function nearestD(lng, lat) {
    const p = profData().pts; let best = 0, bd = Infinity, kx = Math.cos(lat * Math.PI / 180);
    for (let i = 0; i < p.length; i++) { const dx = (p[i].lng - lng) * kx, dy = p[i].lat - lat, dd = dx * dx + dy * dy; if (dd < bd) { bd = dd; best = i; } }
    return p[best].d;
  }
  function localSlope(d) { const w = 0.15, P = profData(); const a = profAt(Math.max(0, d - w)), b = profAt(Math.min(P.distKm, d + w)); const dm = (b.d - a.d) * 1000; return dm > 0 ? ((b.e - a.e) / dm) * 100 : 0; }
  function profWaypoints() {
    return curWaypoints().filter((w) => typeof w.lng === "number" && typeof w.lat === "number")
      .map((w) => { const d = nearestD(w.lng, w.lat); return { id: w.id, d, e: profAt(d).e, color: wpColor(w) }; });
  }
  function renderProfile() {
    const P = profData(); if (!P) return;
    PROF.W = Math.max(320, $("profChart").clientWidth || 600);
    const pts = P.pts, VW = PROF.W, VH = PROF.H, step = Math.max(1, Math.round(pts.length / 170));
    let segs = "", prev = pts[0];
    for (let i = step; i < pts.length; i += step) {
      const cur = pts[i], dm = (cur.d - prev.d) * 1000, s = dm > 0 ? ((cur.e - prev.e) / dm) * 100 : 0;
      segs += `<line x1="${px(prev.d).toFixed(1)}" y1="${py(prev.e).toFixed(1)}" x2="${px(cur.d).toFixed(1)}" y2="${py(cur.e).toFixed(1)}" stroke="${slopeColor(s)}" stroke-width="2.6" stroke-linecap="round"/>`;
      prev = cur;
    }
    let area = `M ${px(pts[0].d).toFixed(1)} ${py(pts[0].e).toFixed(1)}`;
    for (let i = step; i < pts.length; i += step) area += ` L ${px(pts[i].d).toFixed(1)} ${py(pts[i].e).toFixed(1)}`;
    area += ` L ${px(P.distKm).toFixed(1)} ${(VH - PROF.padB).toFixed(1)} L ${px(0).toFixed(1)} ${(VH - PROF.padB).toFixed(1)} Z`;
    let grid = "";
    for (let km = 0; km <= P.distKm; km += 10) { const x = px(km).toFixed(1); grid += `<line x1="${x}" y1="${PROF.padT}" x2="${x}" y2="${VH - PROF.padB}" stroke="#1d2a38" stroke-dasharray="3 4"/><text x="${x}" y="${VH - 9}" text-anchor="middle" class="pf-ax">${km}</text>`; }
    const yl = `<text x="${PROF.padL - 6}" y="${(py(P.eleMax) + 4).toFixed(1)}" text-anchor="end" class="pf-ax">${P.eleMax}</text><text x="${PROF.padL - 6}" y="${(py(P.eleMin) + 4).toFixed(1)}" text-anchor="end" class="pf-ax">${P.eleMin}</text>`;
    let wps = "";
    profWaypoints().forEach((w) => { wps += `<circle class="pf-wp" data-id="${esc(String(w.id))}" cx="${px(w.d).toFixed(1)}" cy="${py(w.e).toFixed(1)}" r="5" fill="${w.color}" stroke="#0f1720" stroke-width="2"/>`; });
    const cur = `<g id="pfCur" style="display:none"><line id="pfCurL" y1="${PROF.padT}" y2="${VH - PROF.padB}" stroke="#fff" stroke-opacity="0.6" stroke-dasharray="4 4"/><circle id="pfCurDot" r="5" fill="#ff6a2b" stroke="#fff" stroke-width="2"/><rect id="pfTipBg" rx="6" height="22" y="${PROF.padT}" fill="#1b2a3a" stroke="#33465c"/><text id="pfTipT" class="pf-tip"></text></g>`;
    $("profChart").innerHTML = `<svg id="pfSvg" width="${VW}" height="${VH}" viewBox="0 0 ${VW} ${VH}" xmlns="http://www.w3.org/2000/svg">
      <line x1="${PROF.padL}" y1="${VH - PROF.padB}" x2="${VW - PROF.padR}" y2="${VH - PROF.padB}" stroke="#2a3a4d"/>
      ${grid}${yl}<path d="${area}" fill="#ff6a2b" fill-opacity="0.12"/>${segs}${wps}${cur}</svg>`;
    $("profSum").textContent = `${P.distKm.toFixed(1)} km · +${P.ascent} m · ${P.eleMin}–${P.eleMax} m ö.h.`;
    profSvg = $("pfSvg");
    const move = (clientX) => { const r = profSvg.getBoundingClientRect(); const x = (clientX - r.left) * (VW / r.width); setCursor(Math.max(0, Math.min(P.distKm, pxInv(x)))); };
    profSvg.addEventListener("mousemove", (e) => move(e.clientX));
    profSvg.addEventListener("mouseleave", clearCursor);
    profSvg.addEventListener("touchstart", (e) => { if (e.touches[0]) move(e.touches[0].clientX); }, { passive: true });
    profSvg.addEventListener("touchmove", (e) => { if (e.touches[0]) move(e.touches[0].clientX); }, { passive: true });
    profSvg.querySelectorAll(".pf-wp").forEach((c) => c.addEventListener("click", (e) => { e.stopPropagation(); selectWaypoint(coerceId(c.getAttribute("data-id")), true); }));
  }
  function setCursor(d) {
    if (d == null) return clearCursor();
    const pos = profAt(d);
    if (map.getSource("route-pos")) map.getSource("route-pos").setData({ type: "Feature", geometry: { type: "Point", coordinates: [pos.lng, pos.lat] } });
    if (map.getLayer("route-pos-dot")) map.setLayoutProperty("route-pos-dot", "visibility", "visible");
    const g = document.getElementById("pfCur"); if (!g) return;
    g.style.display = "";
    const cx = px(d), cy = py(pos.e), slope = localSlope(d);
    const L = document.getElementById("pfCurL"); L.setAttribute("x1", cx); L.setAttribute("x2", cx);
    const dot = document.getElementById("pfCurDot"); dot.setAttribute("cx", cx); dot.setAttribute("cy", cy);
    const label = `km ${d.toFixed(1)} · ${Math.round(pos.e)} m · ${slope >= 0 ? "▲" : "▼"} ${Math.abs(slope).toFixed(0)}%`;
    const tw = Math.max(96, label.length * 6.4); let tx = cx + 8; if (tx + tw > PROF.W) tx = cx - 8 - tw;
    const bg = document.getElementById("pfTipBg"); bg.setAttribute("x", tx); bg.setAttribute("width", tw);
    const t = document.getElementById("pfTipT"); t.textContent = label; t.setAttribute("x", tx + 8); t.setAttribute("y", PROF.padT + 15);
  }
  function clearCursor() { const g = document.getElementById("pfCur"); if (g) g.style.display = "none"; if (map.getLayer("route-pos-dot")) map.setLayoutProperty("route-pos-dot", "visibility", "none"); }
  function registerRouteHover() {
    if (routeHoverOn) return; routeHoverOn = true;
    const over = (e) => { if (profileOpen) setCursor(nearestD(e.lngLat.lng, e.lngLat.lat)); };
    ["route-hit", "route-line"].forEach((id) => { map.on("mousemove", id, over); map.on("mouseleave", id, () => { if (profileOpen) clearCursor(); }); });
  }
  function openProfile() {
    if (!hasProfile()) return;
    profileOpen = true;
    if (map.getLayer("route-pos-dot")) map.moveLayer("route-pos-dot");
    const d = $("profile"); d.classList.remove("hidden"); d.setAttribute("aria-hidden", "false");
    document.body.classList.add("prof-open");
    renderProfile();
    $("btnProfile").classList.add("active");
  }
  function closeProfile() {
    profileOpen = false; clearCursor();
    const d = $("profile"); if (d) { d.classList.add("hidden"); d.setAttribute("aria-hidden", "true"); }
    document.body.classList.remove("prof-open");
    const b = $("btnProfile"); if (b) b.classList.remove("active");
  }
  function toggleProfile() { profileOpen ? closeProfile() : openProfile(); }

  function showEditMarker() {
    removeEditMarker();
    const el = document.createElement("div"); el.className = "mk wpmk editmk"; el.textContent = draft ? wpIcon(draft) : "📍";
    editMarker = new maplibregl.Marker({ element: el, anchor: "center", draggable: true }).setLngLat([draft.lng, draft.lat]).addTo(map);
    editMarker.on("dragend", async () => {
      const ll = editMarker.getLngLat(), sn = snap(ll.lng, ll.lat); editMarker.setLngLat(sn);
      draft.lng = sn[0]; draft.lat = sn[1]; if ($("fLng")) { $("fLng").value = sn[0]; $("fLat").value = sn[1]; }
      if (!draft.__isNew && sb) { try { await sb.from("waypoints").update({ lng: draft.lng, lat: draft.lat }).eq("id", draft.id); } catch (e) {} }
      status("Position uppdaterad", "ok", 1500);
    });
  }
  function removeEditMarker() { if (editMarker) { editMarker.remove(); editMarker = null; } }

  // =====================================================================
  //  Lift-detalj
  // =====================================================================
  function selectLift(id, fromMap) {
    const lf = (window.CANAZEI_LIFTS || []).find((l) => l.id === id); if (!lf) return;
    selectedId = null; highlightWp(null); highlightLiftPoint(id);
    setLiftHighlight(lf.coords);
    if (map.getLayer("lift-hl-casing")) map.moveLayer("lift-hl-casing");
    if (map.getLayer("lift-hl-l")) map.moveLayer("lift-hl-l");
    const bnds = new maplibregl.LngLatBounds(); lf.coords.forEach((c) => bnds.extend(c));
    const narrow = window.innerWidth < 760;
    map.fitBounds(bnds, { padding: { top: 80, bottom: 80, left: 40, right: narrow ? 40 : 340 }, pitch: 0, bearing: 0, duration: 900, maxZoom: 15.5 });
    if (fromMap) showPeek({ kind: "lift", id });
    else { renderLiftView(lf); openPanel(); }
  }
  function renderLiftView(lf) {
    $("panelEdit").classList.add("hidden");
    const v = $("panelView"); v.classList.remove("hidden");
    const lenTxt = lf.len != null ? (lf.len >= 1000 ? (lf.len / 1000).toFixed(1).replace(".", ",") + " km" : lf.len + " m") : "–";
    const dropTxt = lf.drop != null ? lf.drop + " hm" : "–";
    v.innerHTML = `
      <button class="link-back" id="toList">‹ Tillbaka</button>
      <span class="wp-badge">🚠 ${esc(LIFT_TYPE_SV[lf.type] || "Lift")}</span>
      <h2 class="wp-title">${esc(lf.name)}</h2>
      <div class="lift-stats">
        <div class="lift-stat"><span class="ls-ic">📏</span><div><div class="ls-val">${lenTxt}</div><div class="ls-lbl">Längd</div></div></div>
        <div class="lift-stat"><span class="ls-ic">⛰</span><div><div class="ls-val">${dropTxt}</div><div class="ls-lbl">Höjdmeter</div></div></div>
      </div>
      <div class="wp-body">Liftens sträckning är markerad med en svart linje på kartan.</div>`;
    $("toList").addEventListener("click", renderPanel);
  }

  // =====================================================================
  //  Panel – accordion med grupper och liftar
  // =====================================================================
  function section(key, icon, title, count, bodyHtml, extraHeadHtml) {
    const open = expanded.has(key);
    return `<div class="acc ${open ? "open" : ""}">
      <div class="acc-head" data-acc="${esc(key)}">
        <span class="acc-ic">${icon}</span><span class="acc-title">${esc(title)}</span>
        <span class="acc-count">${count}</span>${extraHeadHtml || ""}<span class="acc-chev">▾</span>
      </div>
      <div class="acc-body">${open ? bodyHtml : ""}</div></div>`;
  }
  function wpItem(wp) { return `<div class="list-item" data-id="${esc(String(wp.id))}"><div class="list-ic" style="box-shadow:inset 0 0 0 2px ${wpColor(wp)}">${wpIcon(wp)}</div><div class="list-txt">${esc(wp.title || "Namnlös")}</div></div>`; }
  function liftItem(lf) { return `<div class="list-item" data-lift-id="${esc(lf.id)}"><div class="list-ic">🚠</div><div class="list-txt">${esc(lf.name)}<span class="list-sub">${esc(LIFT_TYPE_SV[lf.type] || "Lift")} · ${lf.len >= 1000 ? (lf.len / 1000).toFixed(1).replace(".", ",") + " km" : lf.len + " m"} · ${lf.drop} hm</span></div></div>`; }

  function renderPanel() {
    selectedId = null; highlightWp(null); clearLiftHighlight(); highlightLiftPoint(null);
    $("panelEdit").classList.add("hidden");
    const v = $("panelView"); v.classList.remove("hidden");
    const b = current, pts = curWaypoints(), grs = curGroups();
    let html = `<div class="course-head"><div class="course-name">${b.icon} ${esc(b.name)}</div><div class="course-stats">${esc(b.stats)}</div></div>`;

    // Hållpunktsgrupper
    html += `<p class="list-head">Hållpunkter</p>`;
    grs.forEach((g) => {
      const gp = pts.filter((w) => w.group_id === g.id);
      const add = editing ? `<button class="acc-mini" data-addgrp="${esc(g.id)}" title="Lägg till punkt">＋</button><button class="acc-mini" data-editgrp="${esc(g.id)}" title="Redigera grupp">✎</button>` : "";
      html += section("grp:" + g.id, g.icon, g.name, gp.length, gp.map(wpItem).join("") || `<p class="muted mini-note">Inga punkter än.</p>`, add);
    });
    const ungrouped = pts.filter((w) => !w.group_id || !groupById(w.group_id));
    if (ungrouped.length) html += section("ungrouped", "📍", "Övrigt", ungrouped.length, ungrouped.map(wpItem).join(""), "");
    if (editing) html += newGroupOpen ? newGroupForm() : `<button class="btn-ghost small" id="newGrpBtn">＋ Ny grupp</button>`;
    else if (!grs.length && !ungrouped.length) html += `<p class="muted">Inga hållpunkter än.</p>`;

    // Liftar (grupperade per typ)
    const lifts = (b.hasLifts && window.CANAZEI_LIFTS) ? window.CANAZEI_LIFTS : [];
    if (lifts.length) {
      const byType = {};
      lifts.forEach((lf) => { (byType[lf.type] = byType[lf.type] || []).push(lf); });
      let inner = "";
      LIFT_TYPE_ORDER.filter((t) => byType[t]).forEach((t) => {
        const arr = byType[t].slice().sort((a, c) => a.name.localeCompare(c.name, "sv"));
        inner += section("lt:" + t, "🚠", LIFT_TYPE_SV[t] || t, arr.length, arr.map(liftItem).join(""), "");
      });
      html += `<p class="list-head" style="margin-top:18px">Liftar</p>` + section("lifts", "🚠", "Alla liftar", lifts.length, inner, "");
    }

    v.innerHTML = html;

    v.querySelectorAll(".acc-head").forEach((el) => el.addEventListener("click", (ev) => {
      if (ev.target.closest(".acc-mini")) return;
      const k = el.getAttribute("data-acc"); if (expanded.has(k)) expanded.delete(k); else expanded.add(k); renderPanel();
    }));
    v.querySelectorAll("[data-id]").forEach((el) => el.addEventListener("click", () => selectWaypoint(coerceId(el.getAttribute("data-id")))));
    v.querySelectorAll("[data-lift-id]").forEach((el) => el.addEventListener("click", () => selectLift(el.getAttribute("data-lift-id"))));
    v.querySelectorAll("[data-addgrp]").forEach((el) => el.addEventListener("click", (ev) => { ev.stopPropagation(); startAdd(el.getAttribute("data-addgrp")); }));
    v.querySelectorAll("[data-editgrp]").forEach((el) => el.addEventListener("click", (ev) => { ev.stopPropagation(); editGroup(el.getAttribute("data-editgrp")); }));
    if ($("newGrpBtn")) $("newGrpBtn").addEventListener("click", () => { newGroupOpen = true; pickIcon = DEFAULT_ICON; pickColor = DEFAULT_COLOR; pickAlways = false; renderPanel(); });
    wireNewGroupForm();
    openPanel();
  }

  // ---- Ny/ändra grupp ----
  function iconPickerHtml(sel) { return `<div class="icon-pick">${ICON_PALETTE.map((e) => `<button type="button" class="ip ${e === sel ? "on" : ""}" data-ic="${e}">${e}</button>`).join("")}</div>`; }
  function colorPickerHtml(sel) { return `<div class="color-pick">${COLOR_PALETTE.map((c) => `<button type="button" class="cp ${c === sel ? "on" : ""}" data-col="${c}" style="background:${c}" aria-label="Färg ${c}"></button>`).join("")}</div>`; }
  function newGroupForm(g) {
    const name = g ? esc(g.name) : "", ic = g ? g.icon : pickIcon;
    const col = g ? (g.color || DEFAULT_COLOR) : pickColor, always = g ? !!g.always_visible : pickAlways;
    return `<div class="grp-form">
      <label>Gruppnamn</label><input id="grpName" type="text" value="${name}" placeholder="t.ex. Vätskekontroll">
      <label>Ikon</label>${iconPickerHtml(ic)}
      <label>Färg</label>${colorPickerHtml(col)}
      <label class="chk"><input type="checkbox" id="grpAlways" ${always ? "checked" : ""}> Visa alltid på kartan (även utzoomat)</label>
      <div class="btns">
        <button class="btn-primary" id="grpSave">${g ? "Spara" : "Skapa grupp"}</button>
        <button class="btn-ghost" id="grpCancel">Avbryt</button>
        ${g ? `<button class="btn-danger" id="grpDelete">Ta bort</button>` : ""}
      </div></div>`;
  }
  function wireNewGroupForm() {
    const form = $("panelView").querySelector(".grp-form"); if (!form) return;
    form.querySelectorAll(".ip").forEach((b) => b.addEventListener("click", () => { pickIcon = b.getAttribute("data-ic"); form.querySelectorAll(".ip").forEach((x) => x.classList.toggle("on", x === b)); }));
    form.querySelectorAll(".cp").forEach((b) => b.addEventListener("click", () => { pickColor = b.getAttribute("data-col"); form.querySelectorAll(".cp").forEach((x) => x.classList.toggle("on", x === b)); }));
    const editId = form.getAttribute("data-edit");
    $("grpSave").addEventListener("click", () => saveGroup(editId));
    $("grpCancel").addEventListener("click", () => { newGroupOpen = false; renderPanel(); });
    if ($("grpDelete")) $("grpDelete").addEventListener("click", () => deleteGroup(editId));
  }
  function editGroup(id) {
    const g = groupById(id); if (!g) return;
    pickIcon = g.icon; pickColor = g.color || DEFAULT_COLOR; pickAlways = !!g.always_visible; newGroupOpen = false;
    const v = $("panelView"); // ersätt gruppens body-area med formulär
    renderPanel();
    // injicera redigeringsformulär överst
    const wrap = document.createElement("div"); wrap.innerHTML = newGroupForm(g);
    wrap.firstChild.setAttribute("data-edit", id);
    v.insertBefore(wrap.firstChild, v.querySelector(".list-head"));
    wireNewGroupForm();
    $("grpName") && $("grpName").focus();
  }
  async function saveGroup(editId) {
    if (!sb) return status("Koppla Supabase för att spara grupper.", "err", 4000);
    const name = ($("grpName").value || "").trim(); if (!name) return status("Gruppnamn krävs.", "err", 3000);
    try {
      const always = $("grpAlways") ? $("grpAlways").checked : false;
      if (editId) { await sb.from("groups").update({ name, icon: pickIcon, color: pickColor, always_visible: always }).eq("id", editId); }
      else { const sort = curGroups().reduce((m, g) => Math.max(m, g.sort || 0), 0) + 1; await sb.from("groups").insert({ area_id: current.id, name, icon: pickIcon, color: pickColor, always_visible: always, sort }); }
      newGroupOpen = false; status("Grupp sparad", "ok", 1500); await loadGroups(); updateWps(); renderPanel();
    } catch (e) { console.warn(e); status("Kunde inte spara grupp: " + (e.message || e), "err", 5000); }
  }
  async function deleteGroup(id) {
    if (!sb || !id) return;
    if (!window.confirm("Ta bort gruppen? Punkterna blir kvar under \"Övrigt\".")) return;
    try {
      await sb.from("waypoints").update({ group_id: null }).eq("group_id", id);
      await sb.from("groups").delete().eq("id", id);
      status("Grupp borttagen", "ok", 1500); await loadGroups(); await loadWaypoints(); renderPanel();
    } catch (e) { console.warn(e); status("Kunde inte ta bort: " + (e.message || e), "err", 5000); }
  }

  function coerceId(s) { const wp = waypoints.find((w) => String(w.id) === s); return wp ? wp.id : s; }

  // =====================================================================
  //  Hållpunkt – visa/redigera
  // =====================================================================
  function selectWaypoint(id, fromMap) {
    clearLiftHighlight(); highlightLiftPoint(null);
    const wp = waypoints.find((w) => w.id === id); if (!wp) return;
    selectedId = id; highlightWp(id);
    map.easeTo({ center: [wp.lng, wp.lat], duration: 700, offset: [window.innerWidth < 760 ? 0 : -160, 0] });
    if (editing) { renderEdit(wp); openPanel(); return; }
    if (fromMap) showPeek({ kind: "wp", id });       // klick på kartan → kompakt rad
    else { renderView(wp); openPanel(); }            // klick i listan → full detalj
  }
  function renderView(wp) {
    $("panelEdit").classList.add("hidden");
    const v = $("panelView"); v.classList.remove("hidden");
    const g = groupById(wp.group_id);
    const img = wp.image_url ? `<img class="wp-img" src="${esc(wp.image_url)}" alt="">` : "";
    v.innerHTML = `
      <button class="link-back" id="toList">‹ Alla hållpunkter</button>
      ${img}
      <span class="wp-badge">${g ? g.icon + " " + esc(g.name) : "📍 Övrigt"}</span>
      <h2 class="wp-title">${esc(wp.title || "Namnlös punkt")}</h2>
      <div class="wp-body">${linkify(wp.body || "")}</div>
      ${editing ? `<div class="btns"><button class="btn-ghost" id="toEdit">✎ Redigera denna</button></div>` : ""}`;
    $("toList").addEventListener("click", renderPanel);
    if (editing) $("toEdit").addEventListener("click", () => renderEdit(wp));
  }
  function renderEdit(wp) {
    draft = Object.assign({}, wp);
    updateWps(); showEditMarker();
    $("panelView").classList.add("hidden");
    const e = $("panelEdit"); e.classList.remove("hidden");
    const grs = curGroups();
    const opts = grs.map((g) => `<option value="${esc(g.id)}" ${draft.group_id === g.id ? "selected" : ""}>${g.icon} ${esc(g.name)}</option>`).join("");
    const thumb = draft.image_url ? `<img class="thumb" src="${esc(draft.image_url)}" alt="">` : "";
    const hint = current && current.type === "route" ? "📍 Dra markören för att flytta – snäpps till banan." : "📍 Dra markören för att flytta punkten.";
    e.innerHTML = `
      <h2 class="wp-title">${draft.__isNew ? "Ny hållpunkt" : "Redigera"}</h2>
      <label>Rubrik</label><input id="fTitle" type="text" value="${esc(draft.title || "")}" placeholder="t.ex. Lunch: Rifugio Belvedere">
      <label>Grupp</label>
      <select id="fGroup">${opts}<option value="__new__">➕ Ny grupp…</option></select>
      <div id="newGrpInline"></div>
      <label>Text</label><textarea id="fBody" placeholder="Beskrivning, tips...">${esc(draft.body || "")}</textarea>
      <label>Bild</label><input id="fFile" type="file" accept="image/*"><div class="hint">Max 10 MB.</div>
      <div id="thumbWrap">${thumb}</div>
      <div class="hint" style="margin-top:12px">${hint}</div>
      <div class="btns">
        <button class="btn-primary" id="fSave">Spara</button>
        <button class="btn-ghost" id="fCancel">Avbryt</button>
        ${draft.__isNew ? "" : `<button class="btn-danger" id="fDelete">Ta bort</button>`}
      </div>`;
    $("fGroup").addEventListener("change", onGroupChange);
    $("fFile").addEventListener("change", onPickImage);
    $("fSave").addEventListener("click", onSave);
    $("fCancel").addEventListener("click", () => { removeEditMarker(); draft = null; updateWps(); renderPanel(); });
    if (!draft.__isNew) $("fDelete").addEventListener("click", onDelete);
  }
  function onGroupChange() {
    const val = $("fGroup").value, wrap = $("newGrpInline");
    if (val === "__new__") {
      pickIcon = DEFAULT_ICON;
      wrap.innerHTML = `<div class="grp-inline"><input id="niName" type="text" placeholder="Nytt gruppnamn">${iconPickerHtml(pickIcon)}<button type="button" class="btn-ghost small" id="niCreate">Skapa</button></div>`;
      wrap.querySelectorAll(".ip").forEach((b) => b.addEventListener("click", () => { pickIcon = b.getAttribute("data-ic"); wrap.querySelectorAll(".ip").forEach((x) => x.classList.toggle("on", x === b)); }));
      $("niCreate").addEventListener("click", createInlineGroup);
    } else wrap.innerHTML = "";
  }
  async function createInlineGroup() {
    if (!sb) return status("Koppla Supabase först.", "err", 4000);
    const name = ($("niName").value || "").trim(); if (!name) return status("Gruppnamn krävs.", "err", 3000);
    try {
      const sort = curGroups().reduce((m, g) => Math.max(m, g.sort || 0), 0) + 1;
      const { data, error } = await sb.from("groups").insert({ area_id: current.id, name, icon: pickIcon, color: DEFAULT_COLOR, always_visible: false, sort }).select().single();
      if (error) throw error;
      await loadGroups(); draft.group_id = data.id;
      const sel = $("fGroup"); sel.innerHTML = curGroups().map((g) => `<option value="${esc(g.id)}" ${draft.group_id === g.id ? "selected" : ""}>${g.icon} ${esc(g.name)}</option>`).join("") + `<option value="__new__">➕ Ny grupp…</option>`;
      $("newGrpInline").innerHTML = ""; status("Grupp skapad", "ok", 1500);
    } catch (e) { console.warn(e); status("Kunde inte skapa grupp: " + (e.message || e), "err", 5000); }
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
      $("thumbWrap").innerHTML = `<img class="thumb" src="${esc(draft.image_url)}" alt="">`; status("Bild uppladdad", "ok", 1500);
    } catch (e) { console.warn(e); status("Uppladdning misslyckades: " + (e.message || e), "err", 5000); }
  }
  async function onSave() {
    if (!sb) return status("Koppla Supabase i config.js för att spara.", "err", 4000);
    draft.title = $("fTitle").value.trim(); draft.body = $("fBody").value;
    const gval = $("fGroup").value; if (gval && gval !== "__new__") draft.group_id = gval;
    if (!draft.title) return status("Rubrik krävs.", "err", 3000);
    const g = groupById(draft.group_id);
    const row = { id: draft.id || cryptoId(), title: draft.title, body: draft.body, icon: g ? "info" : (draft.icon || "info"),
      lng: draft.lng, lat: draft.lat, image_url: draft.image_url || null, area_id: current ? current.id : "marcialonga",
      group_id: draft.group_id || null, sort: draft.sort != null ? draft.sort : nextSort() };
    status("Sparar…");
    try { const { error } = await sb.from("waypoints").upsert(row); if (error) throw error; removeDraftMarker(); draft = null; status("Sparat", "ok", 1500); await loadWaypoints(); selectWaypoint(row.id); }
    catch (e) { console.warn(e); status("Kunde inte spara: " + (e.message || e), "err", 5000); }
  }
  async function onDelete() {
    if (!sb || !draft) return; if (!window.confirm("Ta bort denna hållpunkt?")) return;
    status("Tar bort…");
    try { const { error } = await sb.from("waypoints").delete().eq("id", draft.id); if (error) throw error; removeEditMarker(); draft = null; selectedId = null; status("Borttagen", "ok", 1500); await loadWaypoints(); renderPanel(); }
    catch (e) { console.warn(e); status("Kunde inte ta bort: " + (e.message || e), "err", 5000); }
  }

  function startAdd(groupId) {
    if (!canEdit) return;
    addMode = true; status(current && current.type === "route" ? "Klicka på banan där hållpunkten ska ligga…" : "Klicka där hållpunkten ska ligga…");
    map.getCanvas().style.cursor = "crosshair";
    map.once("click", (e) => {
      addMode = false; map.getCanvas().style.cursor = "";
      const p = snap(e.lngLat.lng, e.lngLat.lat), id = cryptoId();
      const gid = groupId || (curGroups()[0] && curGroups()[0].id) || null;
      draft = { __isNew: true, id, title: "", body: "", lng: p[0], lat: p[1], image_url: null, area_id: current.id, group_id: gid, sort: nextSort() };
      selectedId = id; renderEdit(draft); openPanel(); status("");
    });
  }
  function removeDraftMarker() { removeEditMarker(); }

  // =====================================================================
  //  Redigeringsläge, inloggning, helpers
  // =====================================================================
  function setEditing(on) { editing = on && canEdit; document.body.classList.toggle("editing", editing); if (!editing) { removeEditMarker(); draft = null; newGroupOpen = false; updateWps(); } }
  function wireLogin() {
    $("btnLogin").addEventListener("click", () => {
      if (!sb) return status("Koppla Supabase i config.js först.", "err", 4000);
      if (canEdit) { setEditing(!editing); if (view === "course") renderPanel(); return; }
      openModal();
    });
    $("loginCancel").addEventListener("click", closeModal);
    $("loginSend").addEventListener("click", async () => {
      const email = $("loginEmail").value.trim(); if (!email) return ($("loginMsg").textContent = "Ange en e-postadress.");
      $("loginMsg").textContent = "Skickar…";
      try { const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin + window.location.pathname } }); if (error) throw error; $("loginMsg").textContent = "Klart! Kolla din e-post och klicka på länken."; }
      catch (e) { $("loginMsg").textContent = "Fel: " + (e.message || e); }
    });
  }
  function openModal() { $("loginModal").classList.remove("hidden"); $("loginEmail").focus(); }
  function closeModal() { $("loginModal").classList.add("hidden"); $("loginMsg").textContent = ""; }
  function openPanel() { const p = $("panel"); p.classList.remove("hidden"); p.setAttribute("aria-hidden", "false"); hidePeek(); }
  function closePanel() { const p = $("panel"); p.classList.add("hidden"); p.setAttribute("aria-hidden", "true"); selectedId = null; highlightWp(null); highlightLiftPoint(null); }

  // ---- Kompakt rad (peek) vid klick på en ikon ----
  function showPeek(t) {
    peekTarget = t;
    let icon = "📍", name = "", color = DEFAULT_COLOR;
    if (t.kind === "wp") {
      const wp = waypoints.find((w) => w.id === t.id); if (!wp) return;
      name = wp.title || "Namnlös punkt"; icon = wpIcon(wp); color = wpColor(wp);
      selectedId = t.id; highlightWp(t.id);
    } else {
      const lf = (window.CANAZEI_LIFTS || []).find((l) => l.id === t.id); if (!lf) return;
      name = lf.name; icon = "🚠"; color = "#2b6cb0"; highlightLiftPoint(t.id);
    }
    $("peekIc").textContent = icon; $("peekIc").style.background = color;
    $("peekName").textContent = name;
    const p = $("panel"); p.classList.add("hidden"); p.setAttribute("aria-hidden", "true");
    const pk = $("peek"); pk.classList.remove("hidden"); pk.setAttribute("aria-hidden", "false");
  }
  function hidePeek() { const pk = $("peek"); if (pk) { pk.classList.add("hidden"); pk.setAttribute("aria-hidden", "true"); } }
  function peekOpenDetails() {
    if (!peekTarget) return;
    const t = peekTarget;
    if (t.kind === "wp") { const wp = waypoints.find((w) => w.id === t.id); if (wp) { renderView(wp); openPanel(); } }
    else { const lf = (window.CANAZEI_LIFTS || []).find((l) => l.id === t.id); if (lf) { renderLiftView(lf); openPanel(); } }
  }
  function peekCloseClear() { hidePeek(); peekTarget = null; selectedId = null; highlightWp(null); clearLiftHighlight(); highlightLiftPoint(null); }

  let statusTimer = null;
  function status(msg, kind, ms) { const el = $("status"); if (!msg) { el.classList.add("hidden"); return; } el.textContent = msg; el.className = kind || ""; el.classList.remove("hidden"); if (statusTimer) clearTimeout(statusTimer); if (ms) statusTimer = setTimeout(() => el.classList.add("hidden"), ms); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  function linkify(s) { return esc(s).replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>'); }
  function cryptoId() { return (crypto && crypto.randomUUID) ? crypto.randomUUID() : "x" + Date.now() + Math.random().toString(16).slice(2); }
  function nextSort() { return waypoints.reduce((m, w) => Math.max(m, w.sort || 0), 0) + 1; }

  // =====================================================================
  //  Start
  // =====================================================================
  function main() {
    if (!window.maplibregl) { document.body.innerHTML = "<p style='padding:20px'>Kunde inte ladda kartbiblioteket.</p>"; return; }
    initMap();
    $("panelClose").addEventListener("click", () => { closePanel(); if (peekTarget && view === "course") showPeek(peekTarget); });
    $("btnBack").addEventListener("click", exitCourse);
    $("btnList").addEventListener("click", () => { peekCloseClear(); renderPanel(); });
    $("peekInfo").addEventListener("click", peekOpenDetails);
    $("peekClose").addEventListener("click", peekCloseClear);
    wireLogin(); initSupabase();
    if (map.loaded()) { loadGroups(); loadWaypoints(); } else map.on("load", () => { loadGroups(); loadWaypoints(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeModal(); if (view === "course") { closePanel(); peekCloseClear(); } } });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", main); else main();
})();
