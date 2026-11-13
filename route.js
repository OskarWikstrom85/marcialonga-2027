// =====================================================================
//  Marcialonga-sträckan (APPROXIMATIV) + standard-hållpunkter.
//
//  Rutten nedan följer dalgången grovt: Moena -> upp till Canazei (vändpunkt)
//  -> tillbaka ner genom Predazzo, Tesero, Molina -> mål i Cavalese.
//  Byt gärna ut mot en exakt GPX senare (se README: "Byta ut rutten").
// =====================================================================

window.ROUTE_GEOJSON = {
  type: "Feature",
  properties: { name: "Marcialonga 70 km (approx.)" },
  geometry: {
    type: "LineString",
    coordinates: [
      // --- Moena upp mot Canazei (Fassadalen) ---
      [11.6633, 46.3775], // Moena (start)
      [11.6690, 46.3900],
      [11.6697, 46.3975], // Soraga
      [11.6730, 46.4090],
      [11.6760, 46.4178], // Vigo/San Giovanni
      [11.6830, 46.4230],
      [11.6889, 46.4269], // Pozza / Sèn Jan
      [11.6975, 46.4328], // Pera
      [11.7072, 46.4411], // Mazzin
      [11.7210, 46.4560],
      [11.7392, 46.4719], // Campitello
      [11.7560, 46.4745],
      [11.7700, 46.4767], // Canazei (vändpunkt)
      // --- tillbaka ner genom Fassadalen ---
      [11.7392, 46.4719],
      [11.7072, 46.4411],
      [11.6889, 46.4269],
      [11.6697, 46.3975],
      [11.6633, 46.3775], // Moena igen
      // --- vidare ner i Fiemmedalen ---
      [11.6400, 46.3600],
      [11.6150, 46.3350],
      [11.5986, 46.3119], // Predazzo
      [11.5770, 46.3010],
      [11.5564, 46.2906], // Ziano di Fiemme
      [11.5386, 46.2944], // Panchià
      [11.5250, 46.2930],
      [11.5119, 46.2914], // Tesero
      [11.5200, 46.2850], // Lago di Tesero (längdstadion)
      [11.5000, 46.2820],
      [11.4800, 46.2790], // Masi di Cavalese
      [11.4550, 46.2720],
      [11.4333, 46.2667], // Molina di Fiemme (lägsta punkt)
      [11.4450, 46.2800],
      [11.4606, 46.2906], // Cavalese (mål)
    ],
  },
};

// Standard-hållpunkter som visas innan/utan Supabase (skrivskyddade).
// När Supabase är kopplat och har rader används dessa inte längre.
window.DEFAULT_WAYPOINTS = [
  { id: "d1", icon: "start",  title: "Start – Moena",            lng: 11.6633, lat: 46.3775, sort: 1,
    body: "Loppet startar i Moena och går först uppför Fassadalen mot Canazei." },
  { id: "d2", icon: "peak",   title: "Vändpunkt – Canazei",      lng: 11.7700, lat: 46.4767, sort: 2,
    body: "Banans högsta och nordligaste punkt, under Dolomiternas toppar. Här vänder spåret och går tillbaka nerför dalen." },
  { id: "d3", icon: "info",   title: "Predazzo",                 lng: 11.5986, lat: 46.3119, sort: 3,
    body: "Infart i Fiemmedalen efter nerfarten från Fassa." },
  { id: "d4", icon: "food",   title: "Lago di Tesero – stadion", lng: 11.5200, lat: 46.2850, sort: 4,
    body: "Längdskidstadion i Tesero, van vid världscup och VM." },
  { id: "d5", icon: "info",   title: "Molina di Fiemme",         lng: 11.4333, lat: 46.2667, sort: 5,
    body: "Banans lägsta punkt – härifrån väntar slutstigningen upp mot målet." },
  { id: "d6", icon: "finish", title: "Mål – Cavalese",           lng: 11.4606, lat: 46.2906, sort: 6,
    body: "Målgång i Cavalese efter 70 km." },
];
