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
  let selectedId = null, draft = null, addMode = false, newGroupOpen = false, pickIcon = DEFAULT_ICON;
  let season = "summer";
  try { if (localStorage.getItem("mly-season") === "winter") season = "winter"; } catch (e) {}

  // =====================================================================
  //  Kartstil
  // =====================================================================
  function buildStyle() {
    const key = (CFG.MAPTILER_KEY || "").trim();
    if (key) return { style: `https://api.maptiler.com/maps/hybrid/style.json?key=${key}`,
      terrainSource: "maptiler-terrain", terrainTiles: `https://api.maptiler.com/tiles/terrain-rgb-v2/tiles.json?key=${key}` };
    const style = {
      version: 8,
      glyphs: "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf",
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
      addWinterLayer(); addLabels(); addRoute(); registerLiftHandlers(); registerWaypointHandlers();
      applySeason();
      enterOverview(true);
    });
    map.on("error", (e) => console.warn("Kartfel:", e && e.error ? e.error.message : e));
    $("btnReset").addEventListener("click", () => { if (view === "course") frameCurrent(); else resetOverview(); });
    $("btnSeason").addEventListener("click", toggleSeason);
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
  //  Säsong – sommar/vinter-läge (stiliserad vinter ovanpå satellitbilden)
  // =====================================================================
  const SEASONS = {
    summer: {
      sat: { "raster-saturation": 0, "raster-contrast": 0, "raster-brightness-min": 0, "raster-brightness-max": 1 },
      snow: 0, hillExag: 0.35, hillShadow: "#1b2430", hillHighlight: "#ffffff",
      sky: { "sky-color": "#aed2f5", "horizon-color": "#eaf2fb", "fog-color": "#dfeaf6", "sky-horizon-blend": 0.5, "horizon-fog-blend": 0.6, "fog-ground-blend": 0.3 },
    },
    winter: {
      sat: { "raster-saturation": -0.55, "raster-contrast": -0.07, "raster-brightness-min": 0.12, "raster-brightness-max": 1 },
      snow: 0.26, hillExag: 0.55, hillShadow: "#49607b", hillHighlight: "#ffffff",
      sky: { "sky-color": "#cfe4fb", "horizon-color": "#f6faff", "fog-color": "#eef4fb", "sky-horizon-blend": 0.6, "horizon-fog-blend": 0.6, "fog-ground-blend": 0.22 },
    },
  };
  function addWinterLayer() {
    if (!map.getLayer("satellite") || map.getLayer("winter-snow")) return;
    map.addLayer({ id: "winter-snow", type: "background", paint: { "background-color": "#f5fbff", "background-opacity": 0 } });
  }
  function applySeason() {
    const p = SEASONS[season] || SEASONS.summer;
    try {
      if (map.getLayer("satellite")) for (const k in p.sat) map.setPaintProperty("satellite", k, p.sat[k]);
      if (map.getLayer("winter-snow")) map.setPaintProperty("winter-snow", "background-opacity", p.snow);
      if (map.getLayer("hillshade")) {
        map.setPaintProperty("hillshade", "hillshade-exaggeration", p.hillExag);
        map.setPaintProperty("hillshade", "hillshade-shadow-color", p.hillShadow);
        map.setPaintProperty("hillshade", "hillshade-highlight-color", p.hillHighlight);
      }
      if (map.setSky) map.setSky(p.sky);
    } catch (e) { console.warn("Säsong:", e); }
    updateSeasonBtn();
  }
  function updateSeasonBtn() {
    const b = $("btnSeason"); if (!b) return;
    if (season === "winter") { b.textContent = "☀️ Sommar"; b.title = "Växla till sommarvy"; b.classList.add("active"); }
    else { b.textContent = "❄️ Vinter"; b.title = "Växla till vintervy"; b.classList.remove("active"); }
  }
  function toggleSeason() {
    season = season === "winter" ? "summer" : "winter";
    try { localStorage.setItem("mly-season", season); } catch (e) {}
    applySeason();
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
  }
  function removeLiftCluster() {
    ["lift-clusters", "lift-cluster-count", "lift-points", "lift-points-sel"].forEach((id) => { if (map.getLayer(id)) map.removeLayer(id); });
    if (map.getSource("lifts")) map.removeSource("lifts");
  }
  function registerLiftHandlers() {
    map.on("click", "lift-clusters", (e) => {
      const f = map.queryRenderedFeatures(e.point, { layers: ["lift-clusters"] })[0]; if (!f) return;
      map.getSource("lifts").getClusterExpansionZoom(f.properties.cluster_id).then((z) => map.easeTo({ center: f.geometry.coordinates, zoom: z + 0.3, pitch: 45 })).catch(() => {});
    });
    map.on("click", "lift-points", (e) => { if (e.features && e.features[0]) selectLift(e.features[0].properties.id); });
    ["lift-clusters", "lift-points"].forEach((id) => {
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
    removeMask(); removeOverlay(); removeLiftCluster(); removeWaypointCluster(); removeEditMarker(); clearLiftHighlight(); highlightLiftPoint(null); closePanel();
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
    try { const { data, error } = await sb.from("groups").select("*").order("sort", { ascending: true }); if (!error && data) { groups = data; if (view === "course") refreshPanelIfList(); } }
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
  function wpFC() {
    const edId = draft ? draft.id : null;
    return { type: "FeatureCollection", features: curWaypoints()
      .filter((w) => w.id !== edId && typeof w.lng === "number" && typeof w.lat === "number")
      .map((w) => ({ type: "Feature", properties: { id: w.id }, geometry: { type: "Point", coordinates: [w.lng, w.lat] } })) };
  }
  function addWaypointCluster() {
    if (map.getSource("wps")) { updateWps(); return; }
    map.addSource("wps", { type: "geojson", data: wpFC(), cluster: true, clusterRadius: 44, clusterMaxZoom: 14 });
    const before = map.getLayer("lift-hl-casing") ? "lift-hl-casing" : undefined;
    map.addLayer({ id: "wp-clusters", type: "circle", source: "wps", filter: ["has", "point_count"],
      paint: { "circle-color": "#e23b3b", "circle-opacity": 0.92, "circle-stroke-color": "#ffd9d4", "circle-stroke-width": 2,
        "circle-radius": ["step", ["get", "point_count"], 15, 5, 19, 15, 24, 40, 30] } }, before);
    map.addLayer({ id: "wp-cluster-count", type: "symbol", source: "wps", filter: ["has", "point_count"],
      layout: { "text-field": ["get", "point_count_abbreviated"], "text-font": ["Open Sans Bold"], "text-size": 13 }, paint: { "text-color": "#fff" } }, before);
    map.addLayer({ id: "wp-points", type: "circle", source: "wps", filter: ["!", ["has", "point_count"]],
      paint: { "circle-color": "#e23b3b", "circle-radius": 7, "circle-stroke-color": "#ffd9d4", "circle-stroke-width": 2 } }, before);
    map.addLayer({ id: "wp-points-sel", type: "circle", source: "wps", filter: ["==", ["get", "id"], "__none__"],
      paint: { "circle-color": "#ff6a2b", "circle-radius": 9, "circle-stroke-color": "#fff", "circle-stroke-width": 3 } }, before);
  }
  function updateWps() { if (map.getSource("wps")) map.getSource("wps").setData(wpFC()); }
  function removeWaypointCluster() { ["wp-clusters", "wp-cluster-count", "wp-points", "wp-points-sel"].forEach((id) => { if (map.getLayer(id)) map.removeLayer(id); }); if (map.getSource("wps")) map.removeSource("wps"); }
  function registerWaypointHandlers() {
    map.on("click", "wp-clusters", (e) => {
      const f = map.queryRenderedFeatures(e.point, { layers: ["wp-clusters"] })[0]; if (!f) return;
      map.getSource("wps").getClusterExpansionZoom(f.properties.cluster_id).then((z) => map.easeTo({ center: f.geometry.coordinates, zoom: z + 0.3 })).catch(() => {});
    });
    map.on("click", "wp-points", (e) => { if (e.features && e.features[0]) selectWaypoint(e.features[0].properties.id); });
    ["wp-clusters", "wp-points"].forEach((id) => { map.on("mouseenter", id, () => map.getCanvas().style.cursor = "pointer"); map.on("mouseleave", id, () => map.getCanvas().style.cursor = ""); });
  }
  function highlightWp(id) { if (map.getLayer("wp-points-sel")) map.setFilter("wp-points-sel", ["==", ["get", "id"], id || "__none__"]); }

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
  function selectLift(id) {
    const lf = (window.CANAZEI_LIFTS || []).find((l) => l.id === id); if (!lf) return;
    selectedId = null; highlightWp(null); highlightLiftPoint(id);
    setLiftHighlight(lf.coords);
    if (map.getLayer("lift-hl-casing")) map.moveLayer("lift-hl-casing");
    if (map.getLayer("lift-hl-l")) map.moveLayer("lift-hl-l");
    const bnds = new maplibregl.LngLatBounds(); lf.coords.forEach((c) => bnds.extend(c));
    const narrow = window.innerWidth < 760;
    map.fitBounds(bnds, { padding: { top: 80, bottom: 80, left: 40, right: narrow ? 40 : 340 }, pitch: 0, bearing: 0, duration: 900, maxZoom: 15.5 });
    renderLiftView(lf); openPanel();
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
  function wpItem(wp) { return `<div class="list-item" data-id="${esc(String(wp.id))}"><div class="list-ic">${wpIcon(wp)}</div><div class="list-txt">${esc(wp.title || "Namnlös")}</div></div>`; }
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
    if ($("newGrpBtn")) $("newGrpBtn").addEventListener("click", () => { newGroupOpen = true; pickIcon = DEFAULT_ICON; renderPanel(); });
    wireNewGroupForm();
    openPanel();
  }

  // ---- Ny/ändra grupp ----
  function iconPickerHtml(sel) { return `<div class="icon-pick">${ICON_PALETTE.map((e) => `<button type="button" class="ip ${e === sel ? "on" : ""}" data-ic="${e}">${e}</button>`).join("")}</div>`; }
  function newGroupForm(g) {
    const name = g ? esc(g.name) : "", ic = g ? g.icon : pickIcon;
    return `<div class="grp-form">
      <label>Gruppnamn</label><input id="grpName" type="text" value="${name}" placeholder="t.ex. Vätskekontroll">
      <label>Ikon</label>${iconPickerHtml(ic)}
      <div class="btns">
        <button class="btn-primary" id="grpSave">${g ? "Spara" : "Skapa grupp"}</button>
        <button class="btn-ghost" id="grpCancel">Avbryt</button>
        ${g ? `<button class="btn-danger" id="grpDelete">Ta bort</button>` : ""}
      </div></div>`;
  }
  function wireNewGroupForm() {
    const form = $("panelView").querySelector(".grp-form"); if (!form) return;
    form.querySelectorAll(".ip").forEach((b) => b.addEventListener("click", () => { pickIcon = b.getAttribute("data-ic"); form.querySelectorAll(".ip").forEach((x) => x.classList.toggle("on", x === b)); }));
    const editId = form.getAttribute("data-edit");
    $("grpSave").addEventListener("click", () => saveGroup(editId));
    $("grpCancel").addEventListener("click", () => { newGroupOpen = false; renderPanel(); });
    if ($("grpDelete")) $("grpDelete").addEventListener("click", () => deleteGroup(editId));
  }
  function editGroup(id) {
    const g = groupById(id); if (!g) return;
    pickIcon = g.icon; newGroupOpen = false;
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
      if (editId) { await sb.from("groups").update({ name, icon: pickIcon }).eq("id", editId); }
      else { const sort = curGroups().reduce((m, g) => Math.max(m, g.sort || 0), 0) + 1; await sb.from("groups").insert({ area_id: current.id, name, icon: pickIcon, sort }); }
      newGroupOpen = false; status("Grupp sparad", "ok", 1500); await loadGroups(); renderPanel();
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
  function selectWaypoint(id) {
    clearLiftHighlight(); highlightLiftPoint(null);
    const wp = waypoints.find((w) => w.id === id); if (!wp) return;
    selectedId = id; highlightWp(id);
    map.easeTo({ center: [wp.lng, wp.lat], duration: 700, offset: [window.innerWidth < 760 ? 0 : -160, 0] });
    if (editing) renderEdit(wp); else renderView(wp);
    openPanel();
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
      const { data, error } = await sb.from("groups").insert({ area_id: current.id, name, icon: pickIcon, sort }).select().single();
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
  function openPanel() { const p = $("panel"); p.classList.remove("hidden"); p.setAttribute("aria-hidden", "false"); }
  function closePanel() { const p = $("panel"); p.classList.add("hidden"); p.setAttribute("aria-hidden", "true"); selectedId = null; highlightWp(null); highlightLiftPoint(null); }

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
    $("panelClose").addEventListener("click", () => { if (view === "course") renderPanel(); closePanel(); });
    $("btnBack").addEventListener("click", exitCourse);
    $("btnList").addEventListener("click", renderPanel);
    wireLogin(); initSupabase();
    if (map.loaded()) { loadGroups(); loadWaypoints(); } else map.on("load", () => { loadGroups(); loadWaypoints(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeModal(); if (view === "course") closePanel(); } });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", main); else main();
})();
