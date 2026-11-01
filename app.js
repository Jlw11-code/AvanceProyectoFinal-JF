/* NetworkSentry AI v3 · Plataforma multisitio con roles, SLA, terminal IA y perfil */
"use strict";

/* ================= Configuración ================= */
const STORE = "nsai_v3", SESS = "nsai_sess_v3", IDLE_MIN = 15, SLA_META = 99.5;
const AUTH = { userMin: 4, userMax: 12, passMin: 8, passMax: 16, maxAttempts: 3, lockSeconds: 30 };
const ROLES = {
  admin: { label: "Super Admin", icon: "👑" },
  operador: { label: "Técnico SOC", icon: "🛠️" },
  cliente: { label: "Cliente", icon: "👁️" }
};
const PERMISOS = {
  admin: ["*"],
  operador: ["zonas.ver", "logs.ver", "terminal.usar", "scripts.ejecutar", "estado.cambiar", "reiniciar", "incidencias.documentar", "vivo.ver", "grabaciones.ver", "sla.ver"],
  cliente: ["vivo.ver", "grabaciones.ver", "sla.ver"]
};
const TABS = [
  { id: "resumen", label: "Resumen" },
  { id: "dispositivos", label: "Dispositivos" },
  { id: "zonas", label: "Zonas", perm: "zonas.ver" },
  { id: "vivo", label: "🔴 En vivo", perm: "vivo.ver" },
  { id: "grabaciones", label: "🎞️ Grabaciones", perm: "grabaciones.ver" },
  { id: "sla", label: "📈 Rendimiento / SLA", perm: "sla.ver" },
  { id: "terminal", label: "🤖 Terminal IA", perm: "terminal.usar" },
  { id: "incidencias", label: "📝 Incidencias", perm: "incidencias.documentar" }
];
const TIPOS_SITIO = {
  Casa: { icon: "🏠", zonas: ["Entrada principal", "Sala", "Comedor", "Cocina", "Cuarto principal", "Cuarto 1", "Cuarto 2", "Baño principal", "Baño de visitas", "Lavandería", "Garaje", "Patio"] },
  Empresa: { icon: "🏢", zonas: ["Recepción", "Oficinas", "Sala de reuniones", "Zona de estar", "Comedor", "Baños", "Sala de servidores", "Almacén", "Garaje", "Galpón"] },
  Negocio: { icon: "🏪", zonas: ["Entrada", "Salón de ventas", "Caja", "Bodega", "Oficina administrativa", "Estacionamiento"] }
};
const ICONOS = [
  [/sala de serv/i, "🖥️"], [/cocina/i, "🍳"], [/comedor/i, "🍽️"], [/ba[ñn]o/i, "🚿"],
  [/cuarto|habitaci|dormitor/i, "🛏️"], [/garaje|estacion|parque/i, "🚗"], [/oficina/i, "💼"],
  [/galp|bodega|almac/i, "📦"], [/recep|entrada|acceso/i, "🚪"], [/patio|jard|terraza/i, "🌳"],
  [/caja|venta|sal[oó]n/i, "🛒"], [/lavander/i, "🧺"], [/reuni/i, "👥"], [/sala|estar/i, "🛋️"]
];
const FALLBACK = { // Solo si data.json no se puede leer (p. ej. abierto con file://)
  usuarios: [{ id: 1, usuario: "admin", password: "Sentry#2026", rol: "admin", activo: true, nombre: "Administrador", sitiosIds: [], social: {} }],
  sitios: [], dispositivos: [], logsIA: [], incidencias: [], auditoria: [], config: {}
};
const IPV4 = /^(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)){3}$/;
const PASS_RE = /^(?=.*[A-Za-z])(?=.*\d).{8,16}$/;

/* ================= Estado ================= */
let db = { usuarios: [], sitios: [], dispositivos: [], logsIA: [], incidencias: [], auditoria: [], config: {} };
let sesionId = null, modoRespaldo = false, intentos = 0, bloqueadoHasta = 0, raf = 0, toastTimer, idleT;
const ui = { vista: "landing", sitio: null, tab: "resumen", atab: "usuarios", portal: "cliente" };
const recMap = {}, play = { rec: null, pos: 0, playing: false, t: null };
const term = { sitio: null, timer: null, q: [], busy: false };

/* ================= Utilidades ================= */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ahora = () => new Date().toLocaleString("sv-SE");
const ts = () => new Date().toLocaleTimeString("es-ES", { hour12: false });
const maxId = arr => Math.max(0, ...arr.map(x => Number(x.id) || 0));
const fmt = s => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const iconoZona = n => (ICONOS.find(([re]) => re.test(n)) || [0, "📍"])[1];
const esAlmacen = d => d.tipo === "DVR" || d.tipo === "NVR";
const esLive = d => d.tipo === "Cámara IP" || esAlmacen(d);
const umbral = () => Number(db.config.umbralDisco) || 90;
const esCritico = d => esAlmacen(d) && (d.usoDiscoPorcentaje ?? 0) > umbral();
const siteActual = () => db.sitios.find(s => s.id === ui.sitio);
const devsDe = id => db.dispositivos.filter(d => d.sitioId === id);
const zonaNombre = (s, zid) => (s.zonas.find(z => z.id === zid) || {}).nombre || "Sin zona";
const rng = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
function fillSel(id, html) { const el = $(id), prev = el.value; el.innerHTML = html; if ([...el.options].some(o => o.value === prev)) el.value = prev; }
function toast(t) { const el = $("toast"); el.textContent = t; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => el.hidden = true, 3800); }
const deny = () => toast("⛔ No tiene permisos para esta acción");

/* ================= Seguridad ================= */
// Hash didáctico (cyrb53). En producción: bcrypt/argon2 en el servidor.
function hash(s) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57; const str = "nsai$" + s;
  for (let i = 0, ch; i < str.length; i++) { ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}
const yo = () => db.usuarios.find(u => u.id === sesionId && u.activo !== false) || null;
function can(p) { const u = yo(); if (!u) return false; const ps = PERMISOS[u.rol] || []; return ps.includes("*") || ps.includes(p); }
const adminsActivos = () => db.usuarios.filter(u => u.rol === "admin" && u.activo !== false);
function sitiosVisibles() { const u = yo(); if (!u) return []; return u.rol === "cliente" ? db.sitios.filter(s => (u.sitiosIds || []).includes(s.id)) : db.sitios; }
function audit(accion, quien) {
  const u = yo();
  db.auditoria.unshift({ fecha: ahora(), usuario: quien || (u ? u.usuario : "—"), rol: u ? u.rol : "—", accion });
  if (db.auditoria.length > 200) db.auditoria.length = 200;
  save();
}
function resetIdle() { clearTimeout(idleT); if (sesionId) idleT = setTimeout(() => { if (sesionId) logout(`Sesión cerrada por inactividad (${IDLE_MIN} min)`); }, IDLE_MIN * 60000); }

/* ================= Persistencia y carga ================= */
function save() { if (modoRespaldo) return true; try { localStorage.setItem(STORE, JSON.stringify(db)); return true; } catch (e) { return false; } }

async function init() {
  let ok = false;
  try {
    const s = JSON.parse(localStorage.getItem(STORE) || "null");
    if (s && ["usuarios", "sitios", "dispositivos", "logsIA"].every(k => Array.isArray(s[k]))) { db = s; ok = true; }
  } catch (e) { /* datos corruptos: se recargan */ }
  if (!ok) {
    try {
      const r = await fetch("data.json"); if (!r.ok) throw new Error(r.status);
      db = await r.json();
    } catch (e) {
      console.warn("No se pudo leer data.json:", e);
      db = structuredClone(FALLBACK); modoRespaldo = true;
      toast("⚠ Use un servidor local para cargar data.json (modo respaldo: admin / Sentry#2026)");
    }
  }
  db.incidencias = db.incidencias || []; db.auditoria = db.auditoria || [];
  db.config = Object.assign({ umbralDisco: 90, canales: { telegram: { activo: false, chatId: "" }, correo: { activo: false, destino: "" } }, reglas: [] }, db.config || {});
  db.usuarios.forEach(u => { // migración: contraseña en claro de data.json → hash
    if (u.password) { u.hash = hash(u.id + ":" + u.password); delete u.password; }
    u.social = u.social || {}; u.sitiosIds = u.sitiosIds || [];
  });
  db.dispositivos.forEach(d => reglas(d));
  save();
  try { const sid = Number(sessionStorage.getItem(SESS)); if (sid && db.usuarios.some(u => u.id === sid && u.activo !== false)) { sesionId = sid; ui.vista = "hub"; resetIdle(); } } catch (e) { /* sin sessionStorage */ }
  render();
}

/* ================= Reglas de negocio e IA ================= */
function canalesActivos() { const c = db.config.canales || {}; return [c.telegram?.activo && "Telegram", c.correo?.activo && "Correo"].filter(Boolean); }

function reglas(d, notificar = false) {
  if (esCritico(d) && d.estado === "Online") d.estado = "Warning";
  if (!notificar) return;
  const ch = canalesActivos(), extra = ch.length ? ` · alerta enviada por ${ch.join(" y ")}` : "";
  if (esCritico(d)) {
    agregarLog(d, `Disco crítico: ${d.usoDiscoPorcentaje}% de uso en ${d.tipo}`, "Critica", "find /mnt/hdd/rec -type f -mtime +30 -delete");
    toast(`🚨 ${d.nombre}: disco al ${d.usoDiscoPorcentaje}% (límite ${umbral()}%)${extra}`);
  }
  if (d.estado === "Offline") {
    agregarLog(d, "Equipo registrado como Offline: sin respuesta ICMP", "Alta", `ping -c 4 ${d.ip} && traceroute ${d.ip}`);
    toast(`🔴 ${d.nombre} está OFFLINE${extra}`);
  }
}
function agregarLog(d, evento, severidad, script) {
  db.logsIA.unshift({ id: Date.now() + Math.floor(Math.random() * 1000), dispositivoId: d.id, fecha: ahora(), evento, severidad, scriptSugerido: script });
}
function analizar(d) {
  if (d.estado === "Mantenimiento") return { evento: "IA: equipo en mantenimiento, monitoreo suspendido.", sev: "Baja", script: "" };
  if (d.estado === "Offline") return { evento: "IA: sin respuesta. Posible falla de energía, cable o puerto de switch.", sev: "Alta", script: `ping -c 4 ${d.ip} && arp -a | grep ${d.ip}` };
  if (esCritico(d)) return { evento: `IA: disco al ${d.usoDiscoPorcentaje}%. Riesgo de pérdida de grabaciones.`, sev: "Critica", script: "find /mnt/hdd/rec -type f -mtime +30 -delete" };
  if (d.latenciaMs > 100) return { evento: `IA: latencia elevada (${d.latenciaMs} ms). Posible congestión.`, sev: "Media", script: `mtr -r -c 10 ${d.ip}` };
  return { evento: "IA: equipo estable, sin anomalías detectadas.", sev: "Baja", script: "" };
}
function stats(devs) {
  const alm = devs.filter(d => d.usoDiscoPorcentaje != null);
  return {
    total: devs.length, on: devs.filter(d => d.estado === "Online").length, off: devs.filter(d => d.estado === "Offline").length,
    mant: devs.filter(d => d.estado === "Mantenimiento").length, crit: devs.filter(esCritico).length,
    prom: alm.length ? Math.round(alm.reduce((a, d) => a + d.usoDiscoPorcentaje, 0) / alm.length) : 0
  };
}
const alertasDe = ds => ds.filter(d => d.estado === "Offline" || esCritico(d)).length;
function historial(d) { // 24 h simuladas y deterministas
  const r = rng(d.id * 7919 + 13), h = [];
  for (let i = 0; i < 24; i++) {
    let v = 100; const x = r();
    if (x < 0.08) v = 90 + Math.floor(r() * 9); else if (x < 0.12) v = 60 + Math.floor(r() * 30);
    if (d.estado === "Warning" && i >= 18 && r() < 0.5) v = Math.min(v, 92 - Math.floor(r() * 10));
    if (d.estado === "Offline" && i >= 20) v = 0;
    h.push(v);
  }
  return h;
}

/* ================= Render principal ================= */
const kpi = (l, v, s, c = "", live = "") => `<article class="kpi ${c ? "kpi-" + c : ""}"><span>${live ? `<i class="pdot ${live}"></i>` : ""}${l}</span><strong>${v}</strong><small>${s}</small></article>`;
const cap = s => s[0].toUpperCase() + s.slice(1);

function render() {
  const u = yo();
  if (!u && ui.vista !== "landing") ui.vista = "landing";
  if (u && ui.vista === "landing") ui.vista = "hub";
  if (ui.vista === "admin" && !can("usuarios.gestionar")) ui.vista = "hub";
  if (ui.vista === "site") { const s = siteActual(); if (!s || !sitiosVisibles().includes(s)) { ui.vista = "hub"; ui.sitio = null; } }
  ["landing", "hub", "site", "perfil", "admin"].forEach(v => $("view" + cap(v)).hidden = ui.vista !== v);
  renderNav();
  if (ui.vista === "hub") renderHub();
  else if (ui.vista === "site") renderSite();
  else if (ui.vista === "perfil") { perfilHead(); perfilForm(); }
  else if (ui.vista === "admin") renderAdmin();
  if (!(ui.vista === "site" && ui.tab === "terminal")) stopTerminal();
  syncFeeds();
}

function renderNav() {
  const u = yo();
  $("mainNav").hidden = !u; $("userChip").hidden = !u;
  $("navAdmin").hidden = !can("usuarios.gestionar");
  $("btnSession").textContent = u ? "⏏ Cerrar sesión" : "🔒 Iniciar sesión";
  $("navHub").classList.toggle("active", ui.vista === "hub" || ui.vista === "site");
  $("navPerfil").classList.toggle("active", ui.vista === "perfil");
  $("navAdmin").classList.toggle("active", ui.vista === "admin");
  if (u) { pintarAvatar($("chipAvatar"), u); $("chipName").textContent = u.nombre || u.usuario; $("chipRole").textContent = `${ROLES[u.rol].icon} ${ROLES[u.rol].label}`; }
}

/* ---------- Hub ---------- */
function renderHub() {
  const u = yo(), vis = sitiosVisibles(), ids = new Set(vis.map(s => s.id));
  const devs = db.dispositivos.filter(d => ids.has(d.sitioId)), st = stats(devs);
  $("hubTitle").textContent = u.rol === "cliente" ? "Mis sitios" : "Sitios gestionados";
  $("hubWelcome").textContent = `// Bienvenido, ${u.nombre || u.usuario} · ${ROLES[u.rol].label}`;
  $("btnNewSite").hidden = !can("sitios.gestionar");
  $("hubKpis").innerHTML = kpi("Sitios", vis.length, "bajo su gestión")
    + kpi("Equipos en línea", st.on, `de ${st.total} equipos`, "", "ok")
    + kpi("Alertas offline", st.off, "Requieren atención", "danger", st.off ? "bad" : "")
    + kpi("Discos críticos", st.crit, `Más de ${umbral()}% de uso`, "warn");
  const q = $("hubFiltro").value.trim().toLowerCase(), f = $("hubTipo").value;
  const lista = vis.filter(si => {
    const ds = devsDe(si.id), a = alertasDe(ds);
    const txt = `${si.nombre} ${si.tipo} ${si.direccion || ""} ${ds.map(d => d.ip + " " + d.nombre).join(" ")}`.toLowerCase();
    if (q && !txt.includes(q)) return false;
    if (f === "criticos") return a > 0;
    return f === "todos" || si.tipo === f;
  });
  $("siteGrid").innerHTML = lista.map(si => {
    const ds = devsDe(si.id), a = alertasDe(ds), ico = (TIPOS_SITIO[si.tipo] || {}).icon || "📍";
    return `<article class="site-card ${a ? "alert" : ""}">
      <div class="site-top"><div class="site-icon">${ico}</div><div><h3>${esc(si.nombre)}</h3><span class="chip">${esc(si.tipo)}</span></div>
        <span class="pdot push ${a ? "bad" : "ok"}" title="${a ? "Con alertas" : "Operativo"}"></span></div>
      <p class="muted small">📍 ${esc(si.direccion || "Sin dirección")}</p>
      <div class="site-stats"><div><b>${si.zonas.length}</b><small>Zonas</small></div><div><b>${ds.length}</b><small>Equipos</small></div>
        <div class="${a ? "bad" : ""}"><b>${a}</b><small>Alertas</small></div></div>
      <div class="site-actions"><button class="btn btn-primary" data-act="abrir" data-id="${si.id}">Abrir panel</button>
        ${can("sitios.gestionar") ? `<button class="btn btn-danger" data-act="delsitio" data-id="${si.id}" title="Eliminar sitio">✕</button>` : ""}</div></article>`;
  }).join("") || `<div class="empty">${vis.length ? "Ningún sitio coincide con la búsqueda." : "No hay sitios disponibles para su cuenta."}</div>`;
}

/* ---------- Modal de acciones rápidas ---------- */
function discoCard(d) {
  const p = d.usoDiscoPorcentaje ?? 0, cap = Number(d.capacidadTB) || 2, total = cap * 1000;
  const usado = Math.round(total * p / 100), libre = total - usado, dias = Math.floor(libre / (Number(d.gbDia) || 50));
  const col = p > umbral() ? "var(--red)" : p > 75 ? "var(--amber)" : "var(--green)";
  return `<div class="disk ${p > umbral() ? "crit" : ""}">
    <div class="disk-top"><strong>💽 ${esc(d.nombre)} <small>(${esc(d.tipo)} · ${esc(d.ip)})</small></strong><span class="badge b-${d.estado.toLowerCase()}">${esc(d.estado)}</span></div>
    <div class="disk-pct">${p}% <small>usado</small></div>
    <div class="bar"><div style="width:${p}%;background:${col}"></div></div>
    <div class="disk-meta"><span>Capacidad: <b>${cap} TB</b></span><span>Usado: <b>${usado} GB</b></span><span>Libre: <b>${libre} GB</b></span><span>Retención estimada: <b>≈ ${dias} días</b></span></div>
    ${p > umbral() ? `<small style="color:var(--red)">⚠ Supera el umbral crítico (${umbral()}%). Riesgo de sobrescritura de grabaciones.</small>` : ""}</div>`;
}
function tile(d, s) {
  const off = d.estado === "Offline" ? 1 : d.estado === "Mantenimiento" ? 2 : 0;
  const media = d.streamUrl && !off
    ? `<video src="${esc(d.streamUrl)}" muted autoplay loop playsinline></video>`
    : `<canvas class="feed" width="320" height="180" data-seed="${d.id}" data-off="${off}" data-label="${esc(d.nombre)}"></canvas>`;
  return `<figure class="tile">${media}<figcaption><div><strong>${esc(d.nombre)}</strong><span>${esc(zonaNombre(s, d.zonaId))} · ${esc(d.ip)}</span></div>
    <span class="badge b-${d.estado.toLowerCase()}">${esc(d.estado)}</span><button class="btn btn-outline btn-sm" data-act="full" title="Pantalla completa">⛶</button></figcaption></figure>`;
}
function abrirQuick(id) {
  const s = db.sitios.find(x => x.id === id); if (!s || !sitiosVisibles().includes(s)) return;
  const devs = devsDe(id), st = stats(devs), alm = devs.filter(esAlmacen), cams = devs.filter(d => d.tipo === "Cámara IP");
  $("quickBody").innerHTML = `
    <div class="quick-head"><div><h3>${(TIPOS_SITIO[s.tipo] || {}).icon || "📍"} ${esc(s.nombre)}</h3>
      <p class="muted small">${esc(s.tipo)} · ${esc(s.direccion || "Sin dirección")} · ${s.zonas.length} zonas</p></div>
      <button class="btn btn-outline btn-sm" data-close="quickModal">✕</button></div>
    <div class="kpis">${kpi("En línea", st.on, `de ${st.total}`, "", "ok")}${kpi("Offline", st.off, "alertas", "danger", st.off ? "bad" : "")}${kpi("Mantenimiento", st.mant, "equipos", "info")}${kpi("Discos críticos", st.crit, `> ${umbral()}%`, "warn")}</div>
    <h4>💽 Estado del disco duro (DVR / NVR)</h4>
    ${alm.map(discoCard).join("") || `<p class="muted small">Este sitio no tiene DVR/NVR registrados.</p>`}
    <h4>📹 Cámaras del sitio (${cams.length})</h4>
    <div class="live-grid small">${cams.map(d => tile(d, s)).join("") || `<p class="muted small">Sin cámaras registradas.</p>`}</div>
    <div class="modal-actions"><button class="btn btn-outline" data-close="quickModal">Cerrar</button><button class="btn btn-primary" data-act="entrar" data-id="${id}">Entrar al panel completo →</button></div>`;
  $("quickModal").hidden = false; syncFeeds();
}

/* ---------- Panel de sitio ---------- */
function abrirSitio(id) {
  const s = db.sitios.find(x => x.id === id); if (!s || !sitiosVisibles().includes(s)) return deny();
  ui.sitio = id; ui.vista = "site"; ui.tab = "resumen"; render(); window.scrollTo(0, 0);
}

function renderSite() {
  const s = siteActual(), devs = devsDe(s.id), st = stats(devs);
  $("siteName").textContent = `${(TIPOS_SITIO[s.tipo] || {}).icon || "📍"} ${s.nombre}`;
  $("siteMeta").textContent = `${s.tipo} · ${s.direccion || "Sin dirección"} · ${s.zonas.length} zonas · ${st.total} equipos`;
  $("btnAuditar").hidden = !can("terminal.usar");
  const tabs = TABS.filter(t => !t.perm || can(t.perm));
  if (!tabs.some(t => t.id === ui.tab)) ui.tab = "resumen";
  $("tabs").innerHTML = tabs.map(t => `<button data-tab="${t.id}" class="${t.id === ui.tab ? "active" : ""}">${t.label}</button>`).join("");
  document.querySelectorAll(".tabpane").forEach(p => p.hidden = p.id !== "tab-" + ui.tab);
  if (ui.tab !== "vivo") $("liveGrid").innerHTML = "";
  switch (ui.tab) {
    case "resumen": renderResumen(s, devs, st); break;
    case "dispositivos": renderDispositivos(s); break;
    case "zonas": renderZonas(s, devs); break;
    case "vivo": renderLive(s); break;
    case "grabaciones": renderRec(s); break;
    case "sla": renderSLA(s, devs); break;
    case "terminal": renderTerminal(s); break;
    case "incidencias": renderInc(s, devs); break;
  }
}

function renderResumen(s, devs, st) {
  const col = st.prom > umbral() ? "var(--red)" : st.prom > 75 ? "var(--amber)" : "var(--green)";
  $("siteKpis").innerHTML = kpi("Dispositivos en línea", st.on, `de ${st.total} equipos`, "", "ok")
    + kpi("Alertas offline", st.off, "Requieren atención", "danger", st.off ? "bad" : "")
    + `<article class="kpi"><span>Disco libre (prom. DVR/NVR)</span><strong>${100 - st.prom}%</strong><div class="bar"><div style="width:${st.prom}%;background:${col}"></div></div></article>`
    + kpi("Discos críticos", st.crit, `Más de ${umbral()}% de uso`, "warn")
    + kpi("En mantenimiento", st.mant, "Intervención técnica", "info");
  const al = devs.filter(d => d.estado === "Offline" || esCritico(d) || d.estado === "Warning");
  $("alarmList").innerHTML = al.map(d => {
    const crit = d.estado === "Offline" || esCritico(d);
    const msg = d.estado === "Offline" ? "Sin conexión" : esCritico(d) ? `Disco al ${d.usoDiscoPorcentaje}%` : "Advertencia";
    return `<li class="${crit ? "" : "w"}"><span class="badge b-${d.estado.toLowerCase()}">${esc(d.estado)}</span><strong>${esc(d.nombre)}</strong> · ${msg}<small>${esc(zonaNombre(s, d.zonaId))} · ${esc(d.ip)}</small></li>`;
  }).join("") || `<li class="ok">✔ Sin alarmas críticas. Todos los sistemas operan con normalidad.</li>`;
  $("zoneOverview").innerHTML = zonasHTML(s, devs, false);
}

function zonasHTML(s, devs, gestion) {
  const grupos = s.zonas.map(z => ({ z, list: devs.filter(d => d.zonaId === z.id) }));
  const libres = devs.filter(d => !s.zonas.some(z => z.id === d.zonaId));
  if (libres.length) grupos.push({ z: { id: null, nombre: "Sin zona" }, list: libres });
  return grupos.map(({ z, list }) => {
    const bad = list.some(d => d.estado === "Offline"), warn = list.some(d => esCritico(d) || d.estado === "Warning");
    return `<div class="zone ${bad ? "bad" : warn ? "warn" : ""}">
      <div class="zone-top"><strong>${iconoZona(z.nombre)} ${esc(z.nombre)}</strong>
        ${gestion && z.id != null ? `<button class="btn btn-danger btn-sm" data-act="delzona" data-id="${z.id}">✕</button>` : `<span class="chip">${list.length} eq.</span>`}</div>
      ${gestion ? `<span class="muted small">${list.length} equipo(s)</span>` : ""}
      <ul>${list.map(d => `<li><span>${esc(d.nombre)}</span><span class="badge b-${d.estado.toLowerCase()}">${esc(d.estado)}</span></li>`).join("") || "<li>Sin equipos</li>"}</ul></div>`;
  }).join("");
}

/* ---------- Dispositivos ---------- */
const optZonas = (s, sel) => `<option value="">Sin zona</option>` + s.zonas.map(z => `<option value="${z.id}" ${z.id === sel ? "selected" : ""}>${esc(z.nombre)}</option>`).join("");

function renderDispositivos(s) {
  $("devFormPanel").hidden = !can("dispositivos.gestionar");
  fillSel("zona", optZonas(s));
  renderTabla();
}
function renderTabla() {
  const s = siteActual(); if (!s) return;
  const q = $("filtro").value.trim().toLowerCase(), f = $("devEstado").value, adm = can("dispositivos.gestionar");
  const lista = devsDe(s.id).filter(d => {
    if (q && !`${d.nombre} ${d.ip} ${d.tipo} ${zonaNombre(s, d.zonaId)}`.toLowerCase().includes(q)) return false;
    if (f === "critico") return esCritico(d);
    return f === "todos" || d.estado === f;
  });
  $("deviceBody").innerHTML = lista.map(d => {
    const cls = d.estado === "Offline" ? "row-offline" : esCritico(d) ? "row-critical" : d.estado === "Mantenimiento" ? "row-mant" : "";
    const disco = d.usoDiscoPorcentaje == null ? "—"
      : `<span class="mini-bar ${d.usoDiscoPorcentaje > umbral() ? "high" : ""}"><i style="width:${d.usoDiscoPorcentaje}%"></i></span>${d.usoDiscoPorcentaje}%`;
    const zona = adm ? `<select data-move="${d.id}" aria-label="Zona">${optZonas(s, d.zonaId)}</select>` : esc(zonaNombre(s, d.zonaId));
    const btns = [
      can("terminal.usar") ? `<button class="btn btn-outline btn-sm" data-act="ia" data-id="${d.id}" title="Diagnóstico IA">🤖</button>` : "",
      can("reiniciar") ? `<button class="btn btn-outline btn-sm" data-act="reiniciar" data-id="${d.id}" title="Reiniciar">⟳</button>` : "",
      can("estado.cambiar") ? `<button class="btn btn-outline btn-sm" data-act="mant" data-id="${d.id}" title="Mantenimiento">${d.estado === "Mantenimiento" ? "✔ Reactivar" : "🔧 Mant."}</button>` : "",
      adm ? `<button class="btn btn-outline btn-sm" data-act="editdev" data-id="${d.id}" title="Editar">✎</button><button class="btn btn-danger btn-sm" data-act="deldev" data-id="${d.id}" title="Eliminar">✕</button>` : ""
    ].join("");
    return `<tr class="${cls}"><td><strong>${esc(d.nombre)}</strong><small>${esc(d.firmware || "fw n/d")}</small></td>
      <td>${esc(d.ip)}</td><td>${esc(d.tipo)}</td><td>${zona}</td>
      <td><span class="badge b-${d.estado.toLowerCase()}">${esc(d.estado)}</span></td><td>${disco}</td>
      <td>${d.estado === "Offline" || d.latenciaMs == null ? "—" : d.latenciaMs + " ms"}</td>
      <td class="actions">${btns || '<small>Solo lectura</small>'}</td></tr>`;
  }).join("") || `<tr><td colspan="8">Sin resultados.</td></tr>`;
}

function validarDev(v, sitioId, ignoreId) {
  if (v.nombre.length < 3) return ["nombre", "El nombre debe tener al menos 3 caracteres."];
  if (!IPV4.test(v.ip)) return ["ip", "IP inválida. Use formato IPv4, ej: 192.168.1.50 (octetos 0-255)."];
  if (/^(0\.|127\.|255\.)/.test(v.ip)) return ["ip", "Dirección IP reservada, use una IP de red válida."];
  if (devsDe(sitioId).some(d => d.ip === v.ip && d.id !== ignoreId)) return ["ip", "Ya existe un equipo con esa IP en este sitio."];
  if (esAlmacen(v)) { const n = v.disco === "" ? 0 : Number(v.disco); if (!Number.isFinite(n) || n < 0 || n > 100) return ["disco", "El uso de disco debe estar entre 0 y 100."]; }
  return null;
}
const esPrivada = ip => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);

$("deviceForm").addEventListener("submit", e => {
  e.preventDefault();
  if (!can("dispositivos.gestionar")) return deny();
  const s = siteActual(), msg = $("formMsg");
  const v = { nombre: $("nombre").value.trim(), ip: $("ip").value.trim(), tipo: $("tipo").value, estado: $("estado").value, zona: $("zona").value, disco: $("disco").value.trim() };
  ["nombre", "ip", "disco"].forEach(i => $(i).classList.remove("invalid"));
  const err = validarDev(v, s.id, null);
  if (err) { $(err[0]).classList.add("invalid"); msg.className = "form-msg"; msg.textContent = err[1]; return; }
  const nuevo = { id: maxId(db.dispositivos) + 1, sitioId: s.id, zonaId: v.zona === "" ? null : Number(v.zona), nombre: v.nombre, ip: v.ip, tipo: v.tipo, estado: v.estado,
    usoDiscoPorcentaje: esAlmacen(v) ? (v.disco === "" ? 0 : Number(v.disco)) : null, latenciaMs: v.estado === "Offline" ? null : 0, firmware: "n/d", ultimaConexion: ahora() };
  if (esAlmacen(nuevo)) { nuevo.capacidadTB = 2; nuevo.gbDia = 45; }
  db.dispositivos.push(nuevo);
  reglas(nuevo, true); audit(`Agregó el equipo ${nuevo.nombre} (${nuevo.ip}) en ${s.nombre}`); render();
  e.target.reset();
  msg.className = "form-msg ok";
  msg.textContent = esPrivada(v.ip) ? `✔ "${v.nombre}" agregado a la red.` : `✔ "${v.nombre}" agregado (aviso: IP pública, verifique segmentación).`;
});

function abrirEdit(id) {
  if (!can("dispositivos.gestionar")) return deny();
  const d = db.dispositivos.find(x => x.id === id), s = siteActual(); if (!d || !s) return;
  $("eId").value = d.id; $("eNombre").value = d.nombre; $("eIp").value = d.ip; $("eTipo").value = d.tipo;
  $("eZona").innerHTML = optZonas(s, d.zonaId); $("eDisco").value = d.usoDiscoPorcentaje ?? "";
  $("editMsg").textContent = ""; $("editModal").hidden = false;
}
$("editForm").addEventListener("submit", e => {
  e.preventDefault();
  if (!can("dispositivos.gestionar")) return deny();
  const d = db.dispositivos.find(x => x.id === Number($("eId").value)); if (!d) return;
  const v = { nombre: $("eNombre").value.trim(), ip: $("eIp").value.trim(), tipo: $("eTipo").value, disco: $("eDisco").value.trim() };
  const err = validarDev(v, d.sitioId, d.id);
  if (err) return $("editMsg").textContent = err[1];
  d.nombre = v.nombre; d.ip = v.ip; d.tipo = v.tipo; d.zonaId = $("eZona").value === "" ? null : Number($("eZona").value);
  if (esAlmacen(d)) { d.usoDiscoPorcentaje = v.disco === "" ? 0 : Number(v.disco); d.capacidadTB = d.capacidadTB || 2; d.gbDia = d.gbDia || 45; } else d.usoDiscoPorcentaje = null;
  reglas(d, true); audit(`Editó el equipo ${d.nombre} (${d.ip})`); $("editModal").hidden = true; render(); toast("✔ Equipo actualizado");
});

function eliminarDispositivo(id) {
  if (!can("dispositivos.gestionar")) return deny();
  const d = db.dispositivos.find(x => x.id === id); if (!d) return;
  if (!confirm(`¿Eliminar "${d.nombre}" de la red?`)) return;
  db.dispositivos = db.dispositivos.filter(x => x.id !== id);
  db.logsIA = db.logsIA.filter(l => l.dispositivoId !== id);
  db.incidencias = db.incidencias.filter(i => i.dispositivoId !== id);
  audit(`Eliminó el equipo ${d.nombre}`); render(); toast("Equipo eliminado");
}
function reiniciar(id) {
  if (!can("reiniciar")) return deny();
  const d = db.dispositivos.find(x => x.id === id); if (!d) return;
  d.estado = "Online"; d.latenciaMs = 2; d.ultimaConexion = ahora();
  reglas(d); agregarLog(d, `Reinicio manual ejecutado por ${yo().usuario}`, "Baja", "");
  audit(`Reinició ${d.nombre}`); render(); toast(`⟳ ${d.nombre} reiniciado`);
}
function toggleMant(id) {
  if (!can("estado.cambiar")) return deny();
  const d = db.dispositivos.find(x => x.id === id); if (!d) return;
  const antes = d.estado;
  if (antes === "Mantenimiento") { d.estado = "Online"; reglas(d); } else d.estado = "Mantenimiento";
  agregarLog(d, `Estado cambiado de ${antes} a ${d.estado} por ${yo().usuario}`, "Baja", "");
  audit(`Cambió ${d.nombre}: ${antes} → ${d.estado}`); render(); toast(`🔧 ${d.nombre}: ${d.estado}`);
}

/* ---------- Zonas ---------- */
function renderZonas(s, devs) {
  const adm = can("zonas.gestionar");
  $("zoneFormPanel").hidden = !adm;
  $("zSug").innerHTML = (TIPOS_SITIO[s.tipo] ? TIPOS_SITIO[s.tipo].zonas : []).map(n => `<option value="${esc(n)}">`).join("");
  $("zoneList").innerHTML = zonasHTML(s, devs, adm) || `<div class="empty">No hay zonas. Agregue la primera arriba.</div>`;
}
$("zoneForm").addEventListener("submit", e => {
  e.preventDefault();
  if (!can("zonas.gestionar")) return deny();
  const s = siteActual(), n = $("zNombre").value.trim(), msg = $("zoneMsg"); msg.className = "form-msg";
  if (n.length < 2) return msg.textContent = "El nombre de la zona debe tener al menos 2 caracteres.";
  if (s.zonas.some(z => z.nombre.toLowerCase() === n.toLowerCase())) return msg.textContent = "Ya existe una zona con ese nombre en este sitio.";
  s.zonas.push({ id: Math.max(0, ...db.sitios.flatMap(x => x.zonas.map(z => z.id))) + 1, nombre: n });
  audit(`Agregó la zona ${n} en ${s.nombre}`); e.target.reset(); render();
  msg.className = "form-msg ok"; msg.textContent = `✔ Zona "${n}" agregada.`;
});
function eliminarZona(id) {
  if (!can("zonas.gestionar")) return deny();
  const s = siteActual(), z = s.zonas.find(x => x.id === id); if (!z) return;
  const n = devsDe(s.id).filter(d => d.zonaId === id).length;
  if (!confirm(`¿Eliminar la zona "${z.nombre}"?${n ? ` Sus ${n} equipo(s) quedarán "Sin zona".` : ""}`)) return;
  db.dispositivos.forEach(d => { if (d.zonaId === id) d.zonaId = null; });
  s.zonas = s.zonas.filter(x => x.id !== id);
  audit(`Eliminó la zona ${z.nombre}`); render(); toast("Zona eliminada");
}

/* ---------- Sitios ---------- */
function abrirModalSitio() { if (!can("sitios.gestionar")) return deny(); $("siteForm").reset(); $("siteMsg").textContent = ""; $("siteModal").hidden = false; $("sNombre").focus(); }
$("siteForm").addEventListener("submit", e => {
  e.preventDefault();
  if (!can("sitios.gestionar")) return deny();
  const nombre = $("sNombre").value.trim(), tipo = $("sTipo").value, dir = $("sDir").value.trim(), msg = $("siteMsg");
  if (nombre.length < 3) return msg.textContent = "El nombre debe tener al menos 3 caracteres.";
  if (db.sitios.some(s => s.nombre.toLowerCase() === nombre.toLowerCase())) return msg.textContent = "Ya existe un sitio con ese nombre.";
  let zid = Math.max(0, ...db.sitios.flatMap(s => s.zonas.map(z => z.id)));
  const zonas = $("sPlantilla").checked ? TIPOS_SITIO[tipo].zonas.map(n => ({ id: ++zid, nombre: n })) : [];
  db.sitios.push({ id: maxId(db.sitios) + 1, nombre, tipo, direccion: dir, zonas });
  audit(`Creó el sitio ${nombre}`); cerrarModal("siteModal"); render(); toast(`✔ Sitio "${nombre}" creado`);
});
function eliminarSitio(id) {
  if (!can("sitios.gestionar")) return deny();
  const s = db.sitios.find(x => x.id === id); if (!s) return;
  if (!confirm(`¿Eliminar "${s.nombre}" junto con sus equipos, logs e incidencias? No se puede deshacer.`)) return;
  const ids = new Set(devsDe(id).map(d => d.id));
  db.dispositivos = db.dispositivos.filter(d => d.sitioId !== id);
  db.logsIA = db.logsIA.filter(l => !ids.has(l.dispositivoId));
  db.incidencias = db.incidencias.filter(i => i.sitioId !== id);
  db.usuarios.forEach(u => u.sitiosIds = (u.sitiosIds || []).filter(x => x !== id));
  db.sitios = db.sitios.filter(x => x.id !== id);
  audit(`Eliminó el sitio ${s.nombre}`); render(); toast("Sitio eliminado");
}

/* ---------- En vivo (simulado) ---------- */
function renderLive(s) {
  fillSel("liveZona", `<option value="all">Todas las zonas</option>` + s.zonas.map(z => `<option value="${z.id}">${esc(z.nombre)}</option>`).join(""));
  const zf = $("liveZona").value;
  const lista = devsDe(s.id).filter(esLive).filter(d => zf === "all" || String(d.zonaId) === zf);
  $("liveGrid").innerHTML = lista.map(d => tile(d, s)).join("") || `<div class="empty">No hay cámaras ni DVR/NVR en esta selección.</div>`;
}
function loop(t) { document.querySelectorAll("canvas.feed").forEach(c => { if (c.getClientRects().length) dibujar(c, t); }); raf = requestAnimationFrame(loop); }
function syncFeeds() {
  const vis = [...document.querySelectorAll("canvas.feed")].some(c => c.getClientRects().length);
  if (vis && !raf) raf = requestAnimationFrame(loop);
  if (!vis && raf) { cancelAnimationFrame(raf); raf = 0; }
}
function dibujar(c, t) {
  const g = c.getContext("2d"), w = c.width, h = c.height, seed = Number(c.dataset.seed) || 1, fs = Math.max(11, Math.round(w / 28));
  const off = c.dataset.off;
  if (off === "1" || off === "2") {
    g.fillStyle = "#0a0d12"; g.fillRect(0, 0, w, h);
    g.fillStyle = off === "1" ? "#ff3b4e" : "#5aa9ff"; g.textAlign = "center"; g.font = `bold ${fs + 5}px monospace`;
    g.fillText(off === "1" ? "SIN SEÑAL" : "EN MANTENIMIENTO", w / 2, h / 2);
    g.font = `${fs}px monospace`; g.fillText(off === "1" ? "Verifique alimentación y red" : "Monitoreo suspendido", w / 2, h / 2 + fs * 2); g.textAlign = "left";
    return;
  }
  g.fillStyle = `hsl(${190 + (seed * 17) % 50},14%,${11 + Math.sin(t / 2500 + seed) * 2}%)`; g.fillRect(0, 0, w, h);
  g.fillStyle = "rgba(255,255,255,.05)"; g.fillRect(0, h * 0.68, w, h * 0.32);
  for (let i = 0; i < 3; i++) { g.fillStyle = "rgba(255,255,255,.07)"; g.fillRect((seed * 37 + i * 97) % (w - 70), h * 0.5 + (i % 2) * 14, 40 + i * 12, 40); }
  const x = ((t / 38 + seed * 83) % (w + 60)) - 30;
  g.fillStyle = "rgba(190,200,215,.55)"; g.beginPath(); g.arc(x, h * 0.5, 7, 0, 7); g.fill(); g.fillRect(x - 7, h * 0.5 + 9, 14, 34);
  for (let i = 0; i < 28; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.09})`; g.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 14, 1); }
  g.fillStyle = "rgba(0,0,0,.14)"; for (let y = 0; y < h; y += 3) g.fillRect(0, y, w, 1);
  g.font = `${fs}px monospace`; g.fillStyle = "#e8eef5";
  g.fillText(c.dataset.label || "", 10, fs + 6);
  g.fillText(c.dataset.stamp || new Date().toLocaleString("sv-SE"), 10, h - 10);
  const tag = c.dataset.tag || "REC";
  if (Math.floor(t / 600) % 2 === 0) { g.fillStyle = tag === "REC" ? "#ff3b4e" : "#2ecc8f"; g.beginPath(); g.arc(w - fs * 4.2, fs, 4, 0, 7); g.fill(); }
  g.fillStyle = tag === "REC" ? "#ff3b4e" : "#2ecc8f"; g.fillText(tag, w - fs * 3.4, fs + 5);
}

/* ---------- Grabaciones guardadas ---------- */
function renderRec(s) {
  fillSel("recZona", `<option value="all">Todas las zonas</option>` + s.zonas.map(z => `<option value="${z.id}">${esc(z.nombre)}</option>`).join(""));
  const zf = $("recZona").value, tf = $("recTipo").value, base = Math.floor(Date.now() / 3600000) * 3600000, recs = [];
  devsDe(s.id).filter(esLive).filter(d => zf === "all" || String(d.zonaId) === zf).forEach(d => {
    const r = rng(d.id * 131 + 7);
    for (let i = 0; i < 6; i++) {
      const t0 = base - (i * 6 + 1 + Math.floor(r() * 5)) * 3600000 - Math.floor(r() * 3000) * 1000;
      const dur = 30 + Math.floor(r() * 570), tipo = ["Movimiento", "Continua", "Alarma"][Math.floor(r() * 3)];
      const rec = { key: `${d.id}-${i}`, devId: d.id, ts: t0, fecha: new Date(t0).toLocaleString("sv-SE"), dur, tipo, mb: Math.round(dur * (esAlmacen(d) ? 2.4 : 1.6)), n: i };
      recMap[rec.key] = rec; if (tf === "all" || tf === tipo) recs.push(rec);
    }
  });
  recs.sort((a, b) => b.ts - a.ts);
  const cls = { Alarma: "b-offline", Movimiento: "b-warning", Continua: "b-online" };
  $("recBody").innerHTML = recs.slice(0, 80).map(r => {
    const d = db.dispositivos.find(x => x.id === r.devId);
    return `<tr><td><strong>${esc(d.nombre)}</strong><small>${esc(d.tipo)}</small></td><td>${esc(zonaNombre(s, d.zonaId))}</td><td>${esc(r.fecha)}</td><td>${fmt(r.dur)}</td>
      <td><span class="badge ${cls[r.tipo]}">${r.tipo}</span></td><td>${r.mb} MB</td>
      <td><button class="btn btn-outline btn-sm" data-act="play" data-key="${r.key}">▶ Reproducir</button></td></tr>`;
  }).join("") || `<tr><td colspan="7">Sin grabaciones para este filtro.</td></tr>`;
}
function abrirPlay(key) {
  const r = recMap[key]; if (!r) return;
  const d = db.dispositivos.find(x => x.id === r.devId); if (!d) return;
  play.rec = r; play.pos = 0; play.playing = true;
  $("playTitle").textContent = `▶ ${d.nombre} · ${r.tipo}`;
  $("playMeta").textContent = `${r.fecha} · duración ${fmt(r.dur)} · ${r.mb} MB (reproducción simulada)`;
  const c = $("playCanvas"); Object.assign(c.dataset, { label: d.nombre, seed: String(d.id * 10 + r.n), off: "0", tag: "REPLAY", stamp: r.fecha });
  $("playRange").max = r.dur; $("playRange").value = 0; $("playBtn").textContent = "⏸";
  $("playModal").hidden = false; clearInterval(play.t); play.t = setInterval(playTick, 200); updPlay(); syncFeeds();
}
function updPlay() {
  if (!play.rec) return;
  $("playRange").value = play.pos; $("playTime").textContent = `${fmt(play.pos)} / ${fmt(play.rec.dur)}`;
  $("playCanvas").dataset.stamp = new Date(play.rec.ts + play.pos * 1000).toLocaleString("sv-SE");
}
function playTick() {
  if (!play.playing || !play.rec) return;
  play.pos = Math.min(play.rec.dur, play.pos + 0.2 * Number($("playSpeed").value));
  if (play.pos >= play.rec.dur) { play.playing = false; $("playBtn").textContent = "↻"; }
  updPlay();
}
$("playBtn").addEventListener("click", () => {
  if (!play.rec) return;
  if (play.pos >= play.rec.dur) play.pos = 0;
  play.playing = !play.playing; $("playBtn").textContent = play.playing ? "⏸" : "▶"; updPlay();
});
$("playRange").addEventListener("input", () => { play.pos = Number($("playRange").value); updPlay(); });

/* ---------- Rendimiento / SLA ---------- */
function renderSLA(s, devs) {
  const data = devs.map(d => { const h = historial(d); return { d, h, sla: h.reduce((a, b) => a + b, 0) / 24 }; })
    .sort((a, b) => (esAlmacen(b.d) - esAlmacen(a.d)) || a.sla - b.sla);
  const avg = data.length ? data.reduce((a, x) => a + x.sla, 0) / data.length : 100;
  const bajo = data.filter(x => x.sla < SLA_META).length, peor = data.length ? [...data].sort((a, b) => a.sla - b.sla)[0] : null;
  $("slaKpis").innerHTML = kpi("SLA global (24 h)", avg.toFixed(2) + "%", `Meta ${SLA_META}%`, avg >= SLA_META ? "" : "warn", avg >= SLA_META ? "ok" : "")
    + kpi("Equipos bajo la meta", bajo, "Requieren revisión", bajo ? "danger" : "")
    + kpi("Equipo menos estable", peor ? esc(peor.d.nombre) : "—", peor ? peor.sla.toFixed(2) + "% de disponibilidad" : "Sin datos", "info");
  const pts = [...Array(24)].map((_, i) => data.length ? data.reduce((a, x) => a + x.h[i], 0) / data.length : 100);
  const X = i => 34 + i * (546 / 23), Y = v => 10 + (100 - Math.min(100, Math.max(80, v))) / 20 * 100;
  const line = pts.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");
  const grid = [100, 95, 90, 85, 80].map(v => `<line x1="34" x2="580" y1="${Y(v)}" y2="${Y(v)}"/><text x="2" y="${Y(v) + 3}">${v}%</text>`).join("");
  $("slaChart").innerHTML = `<svg class="chart" viewBox="0 0 600 140" role="img" aria-label="Disponibilidad promedio por hora">${grid}
    <polygon class="ar" points="${X(0)},${Y(80)} ${line} ${X(23)},${Y(80)}"/><polyline class="ln" points="${line}"/>
    <line class="meta" x1="34" x2="580" y1="${Y(SLA_META)}" y2="${Y(SLA_META)}"/>
    <text x="34" y="132">hace 24 h</text><text x="290" y="132">hace 12 h</text><text x="545" y="132">ahora</text></svg>`;
  $("slaGrid").innerHTML = data.map(({ d, h, sla }) => `<div class="sla-card ${sla < SLA_META ? "low" : ""}">
    <div class="zone-top"><strong>${esc(d.nombre)}</strong><span class="chip">${esc(d.tipo)}</span></div>
    <div class="sla-val">${sla.toFixed(2)}%</div>
    <div class="bars">${h.map((v, i) => `<i class="${v >= 99 ? "g" : v >= 95 ? "a" : "r"}" style="height:${Math.max(6, v)}%" title="Hace ${23 - i} h: ${v}%"></i>`).join("")}</div>
    <small>24 h · ${esc(d.ip)} · ${esc(zonaNombre(s, d.zonaId))}</small></div>`).join("") || `<div class="empty">Sin equipos para graficar.</div>`;
}

/* ---------- Terminal IA ---------- */
function tPrint(text, cls = "") { term.q.push({ text, cls }); if (!term.busy) tDrain(); }
function tDrain() {
  const el = $("termBody");
  if (!term.q.length) { term.busy = false; return; }
  term.busy = true; const { text, cls } = term.q.shift();
  const p = document.createElement("div"); p.className = "tl " + cls; p.textContent = text; el.appendChild(p);
  while (el.children.length > 300) el.removeChild(el.firstChild);
  el.scrollTop = el.scrollHeight; setTimeout(tDrain, 130);
}
function printAlertas(s) {
  const hall = devsDe(s.id).map(d => ({ d, r: analizar(d) })).filter(x => x.r.sev !== "Baja");
  if (!hall.length) tPrint("✔ Sin alertas activas en el sitio.", "ok");
  hall.forEach(({ d, r }) => { tPrint(`[${r.sev.toUpperCase()}] ${d.nombre} (${d.ip}) → ${r.evento}`, r.sev === "Media" ? "warn" : "err"); if (r.script) tPrint(`   ↳ script sugerido: ${r.script}`, "muted"); });
  return hall.length;
}
function bootTerm(s) {
  tPrint(`NetworkSentry AI v3 · agente SOC conectado a "${s.nombre}"`, "info");
  tPrint("Escriba 'help' para ver los comandos disponibles.", "muted");
  tPrint("[IA] Escaneando equipos del sitio...", "info");
  const n = printAlertas(s), st = stats(devsDe(s.id));
  tPrint(`Resumen: ${n} alerta(s) · ${st.on}/${st.total} equipos en línea · ${st.mant} en mantenimiento`, "info");
}
function renderTerminal(s) {
  $("btnFix").hidden = !can("scripts.ejecutar");
  renderLogs(s);
  if (term.sitio !== s.id) { term.sitio = s.id; term.q = []; $("termBody").innerHTML = ""; bootTerm(s); }
  if (!term.timer) term.timer = setInterval(heartbeat, 9000);
}
function stopTerminal() { clearInterval(term.timer); term.timer = null; }
function heartbeat() {
  const s = siteActual(); if (!s || ui.vista !== "site" || ui.tab !== "terminal") return;
  const devs = devsDe(s.id); if (!devs.length) return;
  const d = devs[Math.floor(Math.random() * devs.length)];
  if (d.estado === "Offline") tPrint(`[${ts()}] ⚠ ${d.nombre} (${d.ip}) sin respuesta ICMP`, "err");
  else if (esCritico(d)) tPrint(`[${ts()}] 💽 ${d.nombre}: disco al ${d.usoDiscoPorcentaje}% (umbral ${umbral()}%)`, "warn");
  else if (d.estado === "Mantenimiento") tPrint(`[${ts()}] 🔧 ${d.nombre} en mantenimiento`, "muted");
  else tPrint(`[${ts()}] ✔ ${d.nombre} responde · ${(d.latenciaMs || 1) + Math.floor(Math.random() * 4)} ms`, "ok");
}
function renderLogs(s) {
  const ids = new Set(devsDe(s.id).map(d => d.id)), run = can("scripts.ejecutar");
  $("logList").innerHTML = db.logsIA.filter(l => ids.has(l.dispositivoId)).slice(0, 40).map(l => {
    const d = db.dispositivos.find(x => x.id === l.dispositivoId);
    return `<li class="sev-${esc(String(l.severidad).toLowerCase())}"><strong>${esc(d ? d.nombre : "Equipo #" + l.dispositivoId)}</strong> · ${esc(l.severidad)}<br>
      ${esc(l.evento)}<br><time>${esc(l.fecha)}</time>
      ${l.scriptSugerido ? `<code>$ ${esc(l.scriptSugerido)}</code>${run ? `<button class="btn btn-outline btn-sm" data-act="script" data-log="${l.id}" style="margin-top:6px">▶ Ejecutar script</button>` : ""}` : ""}</li>`;
  }).join("") || "<li>Sin registros para este sitio.</li>";
}
function ocupadoIA(on) { const st = $("agentStatus"); st.classList.toggle("busy", on); st.querySelector("b").textContent = on ? "Analizando..." : "Activo"; }

function ejecutarScript(logId) {
  if (!can("scripts.ejecutar")) return deny();
  const l = db.logsIA.find(x => String(x.id) === String(logId)); if (!l || !l.scriptSugerido) return false;
  const d = db.dispositivos.find(x => x.id === l.dispositivoId), script = l.scriptSugerido, quien = yo().usuario;
  l.scriptSugerido = ""; ocupadoIA(true);
  tPrint(`$ ${script}`, "cmd"); tPrint(`[IA] Ejecutando autocorrección en ${d ? d.nombre : "equipo"}...`, "info");
  setTimeout(() => {
    if (d) {
      if (/delete|rm /.test(script) && d.usoDiscoPorcentaje != null) d.usoDiscoPorcentaje = 62;
      if (d.estado === "Offline" || d.estado === "Warning") d.estado = "Online";
      reglas(d);
    }
    l.severidad = "Baja"; l.evento += ` ✔ Remediado por ${quien}`;
    ocupadoIA(false); tPrint(`✔ ${d ? d.nombre : "Equipo"} remediado correctamente.`, "ok");
    if (sesionId) audit(`Ejecutó script de autocorrección en ${d ? d.nombre : "equipo"}`, quien);
    render(); toast("▶ Script ejecutado correctamente");
  }, 1200);
  return true;
}
function runNextScript() {
  const s = siteActual(); if (!s) return;
  if (!can("scripts.ejecutar")) return deny();
  const ids = new Set(devsDe(s.id).map(d => d.id)), rank = { Critica: 0, Alta: 1, Media: 2, Baja: 3 };
  const pend = db.logsIA.filter(l => ids.has(l.dispositivoId) && l.scriptSugerido).sort((a, b) => rank[a.severidad] - rank[b.severidad]);
  if (!pend.length) return tPrint("✔ No hay scripts de autocorrección pendientes.", "ok");
  ejecutarScript(pend[0].id);
}
function runCmd(raw) {
  const s = siteActual(); if (!s || !raw.trim()) return;
  if (!can("terminal.usar")) return deny();
  const [c, ...a] = raw.trim().split(/\s+/), arg = a.join(" "), devs = devsDe(s.id);
  const buscar = q => devs.find(d => d.ip === q || d.nombre.toLowerCase() === q.toLowerCase());
  tPrint(`ns-ai@sentry:~$ ${raw}`, "cmd");
  switch (c.toLowerCase()) {
    case "help": ["help      → muestra esta ayuda", "status    → resumen del sitio", "alerts    → alertas activas", "scan      → nuevo escaneo IA", "ping <ip> → prueba de conectividad", "diag <ip|nombre> → diagnóstico IA de un equipo", "fix       → ejecuta el siguiente script de autocorrección", "run <id>  → ejecuta el script de un log", "clear     → limpia la consola"].forEach(t => tPrint(t, "muted")); break;
    case "clear": term.q = []; $("termBody").innerHTML = ""; break;
    case "status": { const st = stats(devs); tPrint(`${s.nombre}: ${st.on}/${st.total} en línea · ${st.off} offline · ${st.mant} mantenimiento · ${st.crit} discos críticos`, "info"); break; }
    case "alerts": printAlertas(s); break;
    case "scan": tPrint("[IA] Escaneando...", "info"); printAlertas(s); break;
    case "ping": {
      const d = buscar(arg); if (!d) { tPrint(`ping: host ${arg || "(vacío)"} no encontrado en este sitio`, "err"); break; }
      if (d.estado === "Offline") for (let i = 0; i < 3; i++) tPrint(`Tiempo de espera agotado para ${d.ip}`, "err");
      else for (let i = 0; i < 3; i++) tPrint(`Respuesta desde ${d.ip}: tiempo=${(d.latenciaMs || 1) + Math.floor(Math.random() * 3)}ms TTL=64`, "ok");
      break;
    }
    case "diag": {
      const d = buscar(arg); if (!d) { tPrint(`diag: equipo ${arg || "(vacío)"} no encontrado`, "err"); break; }
      const r = analizar(d); agregarLog(d, r.evento, r.sev, r.script); save();
      tPrint(`[${r.sev.toUpperCase()}] ${r.evento}`, r.sev === "Baja" ? "ok" : r.sev === "Media" ? "warn" : "err");
      if (r.script) tPrint(`   ↳ script sugerido: ${r.script}`, "muted");
      renderLogs(s); break;
    }
    case "fix": runNextScript(); break;
    case "run": if (!ejecutarScript(arg)) tPrint(`run: log ${arg || "(vacío)"} sin script pendiente`, "err"); break;
    default: tPrint(`comando no reconocido: ${c} (escriba 'help')`, "err");
  }
}
$("termForm").addEventListener("submit", e => { e.preventDefault(); const v = $("termInput").value; $("termInput").value = ""; runCmd(v); });

function diagnosticarIA(id) {
  if (!can("terminal.usar")) return deny();
  const d = db.dispositivos.find(x => x.id === id); if (!d) return; ocupadoIA(true);
  setTimeout(() => { const r = analizar(d); agregarLog(d, r.evento, r.sev, r.script); audit(`Diagnóstico IA de ${d.nombre}`); ocupadoIA(false); render(); toast(`🤖 Diagnóstico completado: ${d.nombre}`); }, 900);
}
function auditarSitio() {
  if (!can("terminal.usar")) return deny();
  const s = siteActual(); if (!s) return; ocupadoIA(true);
  setTimeout(() => {
    let n = 0;
    devsDe(s.id).forEach(d => {
      const r = analizar(d);
      if (r.sev !== "Baja" && !db.logsIA.some(l => l.dispositivoId === d.id && l.evento === r.evento && l.scriptSugerido)) { agregarLog(d, r.evento, r.sev, r.script); n++; }
    });
    audit(`Auditoría IA del sitio ${s.nombre}: ${n} hallazgo(s)`); ocupadoIA(false);
    ui.tab = "terminal"; term.sitio = null; render();
    toast(n ? `🤖 Auditoría completada: ${n} hallazgo(s) nuevos` : "🤖 Auditoría completada: sin hallazgos nuevos");
  }, 1300);
}

/* ---------- Incidencias ---------- */
function renderInc(s, devs) {
  fillSel("incDev", `<option value="">General del sitio</option>` + devs.map(d => `<option value="${d.id}">${esc(d.nombre)} (${esc(d.ip)})</option>`).join(""));
  const lista = db.incidencias.filter(i => i.sitioId === s.id).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  $("incList").innerHTML = lista.map(i => {
    const d = db.dispositivos.find(x => x.id === i.dispositivoId);
    return `<div class="inc ${i.estado === "Resuelta" ? "res" : ""}"><div class="inc-top"><strong>${esc(i.titulo)}</strong>
      <span class="badge ${i.estado === "Resuelta" ? "b-online" : "b-warning"}">${esc(i.estado)}</span></div>
      <span>${esc(i.descripcion)}</span><small>${esc(i.fecha)} · ${esc(d ? d.nombre : "General")} · por ${esc(i.autor)}</small>
      ${i.estado === "Abierta" ? `<div><button class="btn btn-outline btn-sm" data-act="resolver" data-id="${i.id}">✔ Marcar resuelta</button></div>` : ""}</div>`;
  }).join("") || `<p class="muted">Aún no hay incidencias documentadas.</p>`;
}
$("incForm").addEventListener("submit", e => {
  e.preventDefault();
  if (!can("incidencias.documentar")) return deny();
  const s = siteActual(), msg = $("incMsg"), t = $("incTitulo").value.trim(), desc = $("incDesc").value.trim(); msg.className = "form-msg";
  if (t.length < 5) return msg.textContent = "El título debe tener al menos 5 caracteres.";
  if (desc.length < 10) return msg.textContent = "La descripción debe tener al menos 10 caracteres.";
  db.incidencias.unshift({ id: maxId(db.incidencias) + 1, sitioId: s.id, dispositivoId: $("incDev").value === "" ? null : Number($("incDev").value),
    fecha: ahora(), titulo: t, descripcion: desc, estado: $("incEstado").value, autor: yo().usuario });
  audit(`Documentó la incidencia "${t}" en ${s.nombre}`); e.target.reset(); render();
  msg.className = "form-msg ok"; msg.textContent = "✔ Incidencia guardada.";
});

/* ---------- Perfil ---------- */
const iniciales = u => (u.nombre || u.usuario).split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase();
function pintarAvatar(el, u) { const ok = u.foto && /^data:image\//.test(u.foto); el.style.backgroundImage = ok ? `url("${u.foto}")` : ""; el.textContent = ok ? "" : iniciales(u); }

function perfilHead() {
  const u = yo(); if (!u) return;
  pintarAvatar($("pAvatar"), u);
  $("pBanner").style.backgroundImage = u.banner && /^data:image\//.test(u.banner) ? `url("${u.banner}")` : "";
  $("pHeadName").innerHTML = `${esc(u.nombre || u.usuario)} <span class="rolebadge">${ROLES[u.rol].icon} ${ROLES[u.rol].label}</span>`;
  $("pHeadMeta").textContent = `@${u.usuario}${u.cargo ? " · " + u.cargo : ""}${u.empresa ? " · " + u.empresa : ""} · Último acceso: ${u.ultimoAcceso || "—"}`;
}
function perfilForm() {
  const u = yo(); if (!u) return;
  const sc = u.social || {};
  $("pUsuario").value = u.usuario; $("pRol").value = ROLES[u.rol].label; $("pNombre").value = u.nombre || "";
  $("pEmail").value = u.email || ""; $("pTel").value = u.telefono || ""; $("pCargo").value = u.cargo || "";
  $("pEmpresa").value = u.empresa || ""; $("pCiudad").value = u.ciudad || ""; $("pBio").value = u.bio || "";
  $("socTelegram").value = sc.telegram || ""; $("socInstagram").value = sc.instagram || ""; $("socWhatsapp").value = sc.whatsapp || "";
  $("socLinkedin").value = sc.linkedin || ""; $("socFacebook").value = sc.facebook || ""; $("socWeb").value = sc.web || "";
}
function validarPerfil(v, u) {
  const tel = /^\+?[0-9\s-]{7,18}$/, handle = /^@?[A-Za-z0-9_.]{3,32}$/, url = /^https?:\/\/[^\s]+\.[^\s]+$/;
  if (v.usuario.length < AUTH.userMin || v.usuario.length > AUTH.userMax) return `El usuario debe tener entre ${AUTH.userMin} y ${AUTH.userMax} caracteres.`;
  if (!/^[a-zA-Z0-9]+$/.test(v.usuario)) return "El usuario solo admite letras y números.";
  if (db.usuarios.some(x => x.id !== u.id && x.usuario.toLowerCase() === v.usuario.toLowerCase())) return "Ese nombre de usuario ya está en uso.";
  if (v.nombre.length < 3 || v.nombre.length > 60) return "El nombre debe tener entre 3 y 60 caracteres.";
  if (v.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.email)) return "Correo electrónico inválido.";
  if (v.telefono && !tel.test(v.telefono)) return "Teléfono inválido (7-18 dígitos, puede iniciar con +).";
  if (v.bio.length > 200) return "La biografía no puede superar 200 caracteres.";
  if (v.social.telegram && !handle.test(v.social.telegram)) return "Telegram inválido (ej: @usuario).";
  if (v.social.instagram && !handle.test(v.social.instagram)) return "Instagram inválido (ej: @usuario).";
  if (v.social.whatsapp && !tel.test(v.social.whatsapp)) return "WhatsApp inválido (ej: +1 305 555 0101).";
  for (const k of ["linkedin", "facebook", "web"]) if (v.social[k] && !url.test(v.social[k])) return `La URL de ${k} debe comenzar con http:// o https://`;
  return null;
}
$("profileForm").addEventListener("submit", e => {
  e.preventDefault();
  const u = yo(); if (!u) return; const m = $("profMsg"); m.className = "form-msg";
  const v = { usuario: $("pUsuario").value.trim(), nombre: $("pNombre").value.trim(), email: $("pEmail").value.trim(), telefono: $("pTel").value.trim(),
    cargo: $("pCargo").value.trim(), empresa: $("pEmpresa").value.trim(), ciudad: $("pCiudad").value.trim(), bio: $("pBio").value.trim(),
    social: { telegram: $("socTelegram").value.trim(), instagram: $("socInstagram").value.trim(), whatsapp: $("socWhatsapp").value.trim(),
      linkedin: $("socLinkedin").value.trim(), facebook: $("socFacebook").value.trim(), web: $("socWeb").value.trim() } };
  const err = validarPerfil(v, u); if (err) return m.textContent = err;
  const anterior = u.usuario; Object.assign(u, v);
  audit(anterior !== u.usuario ? `Actualizó su perfil (usuario ${anterior} → ${u.usuario})` : "Actualizó su perfil");
  renderNav(); perfilHead(); m.className = "form-msg ok"; m.textContent = "✔ Perfil actualizado correctamente.";
});
$("pwForm").addEventListener("submit", e => {
  e.preventDefault();
  const u = yo(); if (!u) return; const m = $("pwMsg"); m.className = "form-msg";
  const a = $("pwActual").value, n = $("pwNueva").value, c = $("pwConfirm").value;
  if (u.hash !== hash(u.id + ":" + a)) return m.textContent = "La contraseña actual es incorrecta.";
  if (!PASS_RE.test(n)) return m.textContent = `La nueva contraseña debe tener entre ${AUTH.passMin} y ${AUTH.passMax} caracteres e incluir letras y números.`;
  if (n === a) return m.textContent = "La nueva contraseña debe ser distinta de la actual.";
  if (n !== c) return m.textContent = "La confirmación no coincide.";
  u.hash = hash(u.id + ":" + n); audit("Cambió su contraseña"); e.target.reset();
  m.className = "form-msg ok"; m.textContent = "✔ Contraseña actualizada.";
});

function imgData(file, w, h) {
  return new Promise((ok, ko) => {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return ko(new Error("Formato no permitido (use PNG, JPG o WEBP)."));
    if (file.size > 4 * 1024 * 1024) return ko(new Error("La imagen supera los 4 MB."));
    const fr = new FileReader();
    fr.onerror = () => ko(new Error("No se pudo leer el archivo."));
    fr.onload = () => {
      const im = new Image();
      im.onerror = () => ko(new Error("La imagen no es válida."));
      im.onload = () => {
        const c = document.createElement("canvas"); c.width = w; c.height = h; const g = c.getContext("2d");
        const k = Math.max(w / im.width, h / im.height), dw = im.width * k, dh = im.height * k;
        g.drawImage(im, (w - dw) / 2, (h - dh) / 2, dw, dh); ok(c.toDataURL("image/jpeg", 0.82));
      };
      im.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}
async function subirImagen(input, campo, w, h) {
  const u = yo(), f = input.files[0]; input.value = ""; if (!u || !f) return;
  try {
    u[campo] = await imgData(f, w, h);
    if (!save()) { u[campo] = ""; return toast("⚠ No se pudo guardar: almacenamiento del navegador lleno"); }
    audit(`Actualizó su ${campo === "foto" ? "foto de perfil" : "banner"}`); renderNav(); perfilHead(); toast("✔ Imagen actualizada");
  } catch (err) { toast("⚠ " + err.message); }
}
$("fileAvatar").addEventListener("change", e => subirImagen(e.target, "foto", 256, 256));
$("fileBanner").addEventListener("change", e => subirImagen(e.target, "banner", 1200, 300));

/* ---------- Administración ---------- */
function renderAdmin() {
  document.querySelectorAll("[data-atab]").forEach(b => b.classList.toggle("active", b.dataset.atab === ui.atab));
  document.querySelectorAll(".apane").forEach(p => p.hidden = p.id !== "adm-" + ui.atab);
  if (ui.atab === "usuarios") renderUsuarios();
  else if (ui.atab === "alertas") renderCanales();
  else if (ui.atab === "reglas") renderReglas();
  else renderAud();
}
function renderUsuarios() {
  $("uSitios").innerHTML = db.sitios.map(s => `<label class="check"><input type="checkbox" value="${s.id}"> ${esc(s.nombre)}</label>`).join("") || "<small>No hay sitios creados.</small>";
  $("uSitiosWrap").hidden = $("uRol").value !== "cliente";
  $("userBody").innerHTML = db.usuarios.map(u => {
    const self = u.id === sesionId;
    const sitios = u.rol === "cliente" ? (u.sitiosIds || []).map(id => (db.sitios.find(s => s.id === id) || {}).nombre).filter(Boolean).join(", ") || "—" : "Todos";
    return `<tr><td><strong>${esc(u.usuario)}</strong><small>${esc(u.email || "")}</small></td><td>${esc(u.nombre || "")}</td>
      <td><select data-urol="${u.id}" ${self ? "disabled" : ""}>${Object.keys(ROLES).map(r => `<option value="${r}" ${r === u.rol ? "selected" : ""}>${ROLES[r].label}</option>`).join("")}</select></td>
      <td>${esc(sitios)}</td><td>${esc(u.ultimoAcceso || "—")}</td>
      <td><span class="badge ${u.activo === false ? "b-offline" : "b-online"}">${u.activo === false ? "Suspendido" : "Activo"}</span></td>
      <td class="actions">${self ? "<small>(usted)</small>" : `<button class="btn btn-outline btn-sm" data-act="utoggle" data-id="${u.id}">${u.activo === false ? "Activar" : "Suspender"}</button><button class="btn btn-danger btn-sm" data-act="udel" data-id="${u.id}">✕</button>`}</td></tr>`;
  }).join("");
}
$("userForm").addEventListener("submit", e => {
  e.preventDefault();
  if (!can("usuarios.gestionar")) return deny();
  const m = $("userMsg"); m.className = "form-msg";
  const usuario = $("uUsuario").value.trim(), nombre = $("uNombre").value.trim(), pass = $("uPass").value, rol = $("uRol").value;
  const sitios = [...$("uSitios").querySelectorAll("input:checked")].map(i => Number(i.value));
  if (usuario.length < AUTH.userMin || usuario.length > AUTH.userMax || !/^[a-zA-Z0-9]+$/.test(usuario)) return m.textContent = `El usuario debe tener ${AUTH.userMin}-${AUTH.userMax} caracteres alfanuméricos.`;
  if (db.usuarios.some(u => u.usuario.toLowerCase() === usuario.toLowerCase())) return m.textContent = "Ese usuario ya existe.";
  if (nombre.length < 3) return m.textContent = "Ingrese el nombre completo (mín. 3 caracteres).";
  if (!PASS_RE.test(pass)) return m.textContent = `La contraseña debe tener ${AUTH.passMin}-${AUTH.passMax} caracteres con letras y números.`;
  if (rol === "cliente" && !sitios.length) return m.textContent = "Asigne al menos un sitio al cliente.";
  const id = maxId(db.usuarios) + 1;
  db.usuarios.push({ id, usuario, nombre, rol, activo: true, hash: hash(id + ":" + pass), email: "", telefono: "", cargo: "", empresa: "", ciudad: "", bio: "", foto: "", banner: "", social: {}, sitiosIds: rol === "cliente" ? sitios : [], ultimoAcceso: "—" });
  audit(`Creó el usuario ${usuario} (${ROLES[rol].label})`); e.target.reset(); render();
  m.className = "form-msg ok"; m.textContent = `✔ Usuario "${usuario}" creado.`;
});
function toggleUsuario(id) {
  if (!can("usuarios.gestionar")) return deny();
  const u = db.usuarios.find(x => x.id === id); if (!u || u.id === sesionId) return;
  if (u.rol === "admin" && u.activo !== false && adminsActivos().length <= 1) return toast("⛔ Debe existir al menos un Super Admin activo");
  u.activo = u.activo === false; audit(`${u.activo ? "Activó" : "Suspendió"} al usuario ${u.usuario}`); render();
}
function eliminarUsuario(id) {
  if (!can("usuarios.gestionar")) return deny();
  const u = db.usuarios.find(x => x.id === id); if (!u || u.id === sesionId) return;
  if (u.rol === "admin" && u.activo !== false && adminsActivos().length <= 1) return toast("⛔ Debe existir al menos un Super Admin activo");
  if (!confirm(`¿Eliminar al usuario "${u.usuario}"?`)) return;
  db.usuarios = db.usuarios.filter(x => x.id !== id); audit(`Eliminó al usuario ${u.usuario}`); render();
}
function cambiarRol(id, rol) {
  if (!can("usuarios.gestionar")) return deny();
  const u = db.usuarios.find(x => x.id === id); if (!u || u.id === sesionId || !ROLES[rol]) return;
  if (u.rol === "admin" && rol !== "admin" && u.activo !== false && adminsActivos().length <= 1) { toast("⛔ Debe existir al menos un Super Admin activo"); return render(); }
  audit(`Cambió el rol de ${u.usuario}: ${ROLES[u.rol].label} → ${ROLES[rol].label}`); u.rol = rol; render();
  if (rol === "cliente" && !(u.sitiosIds || []).length) toast("ℹ Este cliente no tiene sitios asignados (cree un cliente nuevo para asignarlos).");
}

function renderCanales() {
  const c = db.config.canales;
  $("chTgActivo").checked = !!c.telegram?.activo; $("chTgChat").value = c.telegram?.chatId || "";
  $("chMailActivo").checked = !!c.correo?.activo; $("chMailDest").value = c.correo?.destino || ""; $("chUmbral").value = umbral();
}
$("chForm").addEventListener("submit", e => {
  e.preventDefault();
  if (!can("config.global")) return deny();
  const m = $("chMsg"); m.className = "form-msg";
  const tg = $("chTgActivo").checked, chat = $("chTgChat").value.trim(), mail = $("chMailActivo").checked, dest = $("chMailDest").value.trim(), um = Number($("chUmbral").value);
  if (tg && !/^-?\d{5,15}$/.test(chat)) return m.textContent = "Chat ID de Telegram inválido (solo números, puede iniciar con -).";
  if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(dest)) return m.textContent = "Correo de destino inválido.";
  if (!Number.isInteger(um) || um < 50 || um > 99) return m.textContent = "El umbral de disco debe ser un entero entre 50 y 99.";
  db.config.canales = { telegram: { activo: tg, chatId: chat }, correo: { activo: mail, destino: dest } }; db.config.umbralDisco = um;
  db.dispositivos.forEach(d => reglas(d)); audit(`Actualizó canales de alerta y umbral de disco (${um}%)`); render();
  m.className = "form-msg ok"; m.textContent = "✔ Configuración guardada.";
});
function testCanal(canal) {
  if (!can("config.global")) return deny();
  const c = db.config.canales[canal];
  if (!c || !c.activo) return toast("Active y guarde el canal antes de enviar una prueba.");
  audit(`Envió mensaje de prueba por ${canal}`); toast(`📨 Mensaje de prueba enviado por ${canal === "telegram" ? "Telegram" : "correo"} (simulado)`);
}
function renderReglas() {
  $("ruleList").innerHTML = (db.config.reglas || []).map(r => `<div class="rule">
    <div class="rule-info"><strong>${esc(r.nombre)}</strong> <span class="badge ${r.estado === "Aprobada" ? "b-online" : "b-warning"}">${esc(r.estado)}</span><span>${esc(r.descripcion)}</span></div>
    ${r.valor != null ? `<div><label>Valor (${esc(r.unidad || "")})</label><input type="number" min="1" max="999" value="${Number(r.valor)}" data-rulev="${r.id}"></div>` : ""}
    <div class="actions">${r.estado !== "Aprobada" ? `<button class="btn btn-outline btn-sm" data-act="rapr" data-id="${r.id}">✔ Aprobar</button>` : ""}
      <button class="btn ${r.activa ? "btn-danger" : "btn-primary"} btn-sm" data-act="rtog" data-id="${r.id}">${r.activa ? "Desactivar" : "Activar"}</button></div></div>`).join("") || `<p class="muted">No hay reglas definidas.</p>`;
}
function renderAud() {
  $("audBody").innerHTML = db.auditoria.map(a => `<tr><td>${esc(a.fecha)}</td><td>${esc(a.usuario)}</td><td>${esc(ROLES[a.rol] ? ROLES[a.rol].label : a.rol)}</td><td>${esc(a.accion)}</td></tr>`).join("") || `<tr><td colspan="4">Sin eventos registrados.</td></tr>`;
}

/* ================= Sesión (login por portal) ================= */
function setPortal(p) {
  ui.portal = p;
  document.querySelectorAll("#portalSeg button").forEach(b => b.classList.toggle("active", b.dataset.portal === p));
  $("portalHint").textContent = p === "cliente"
    ? "Portal Cliente: consulta el estado de sus equipos, cámaras en vivo y grabaciones (solo lectura)."
    : "Portal Personal: acceso para Super Admin y Técnicos SOC.";
}
function abrirLogin(portal) { setPortal(portal || ui.portal); $("loginMsg").textContent = ""; $("loginModal").hidden = false; $("user").focus(); }

$("loginForm").addEventListener("submit", e => {
  e.preventDefault();
  const msg = $("loginMsg"), u = $("user").value.trim(), p = $("pass").value; msg.className = "form-msg";
  if (Date.now() < bloqueadoHasta) return msg.textContent = `Acceso bloqueado. Espere ${Math.ceil((bloqueadoHasta - Date.now()) / 1000)} s.`;
  if (u.length < AUTH.userMin || u.length > AUTH.userMax) return msg.textContent = `El usuario debe tener entre ${AUTH.userMin} y ${AUTH.userMax} caracteres.`;
  if (!/^[a-zA-Z0-9]+$/.test(u)) return msg.textContent = "El usuario solo admite letras y números.";
  if (p.length < AUTH.passMin || p.length > AUTH.passMax) return msg.textContent = `La contraseña debe tener entre ${AUTH.passMin} y ${AUTH.passMax} caracteres.`;
  const usr = db.usuarios.find(x => x.usuario.toLowerCase() === u.toLowerCase());
  const portalOk = usr && (ui.portal === "cliente" ? usr.rol === "cliente" : usr.rol !== "cliente");
  if (usr && portalOk && usr.activo !== false && usr.hash === hash(usr.id + ":" + p)) {
    sesionId = usr.id; intentos = 0; usr.ultimoAcceso = ahora();
    try { sessionStorage.setItem(SESS, String(usr.id)); } catch (er) { /* sin sessionStorage */ }
    audit(`Inicio de sesión (portal ${ui.portal})`); resetIdle();
    $("loginModal").hidden = true; $("loginForm").reset();
    ui.vista = "hub"; ui.sitio = null; render(); window.scrollTo(0, 0);
    toast(`✔ Bienvenido, ${usr.nombre || usr.usuario} · ${ROLES[usr.rol].label}`);
  } else {
    audit(`Intento de acceso fallido (portal ${ui.portal}) con usuario "${u}"`, u);
    intentos++;
    if (intentos >= AUTH.maxAttempts) { bloqueadoHasta = Date.now() + AUTH.lockSeconds * 1000; intentos = 0; msg.textContent = `Demasiados intentos. Bloqueado ${AUTH.lockSeconds} s.`; }
    else msg.textContent = `Credenciales incorrectas o cuenta no autorizada para este portal. Intentos restantes: ${AUTH.maxAttempts - intentos}.`;
  }
});
function logout(motivo) {
  if (yo()) audit(motivo ? "Sesión cerrada por inactividad" : "Cierre de sesión");
  sesionId = null; clearTimeout(idleT);
  try { sessionStorage.removeItem(SESS); } catch (er) { /* nada */ }
  ui.vista = "landing"; ui.sitio = null; term.sitio = null; stopTerminal();
  ["quickModal", "playModal", "editModal", "siteModal"].forEach(cerrarModal);
  render(); window.scrollTo(0, 0); toast(motivo || "Sesión cerrada");
}
function cerrarModal(id) {
  $(id).hidden = true;
  if (id === "loginModal") $("loginForm").reset();
  if (id === "quickModal") $("quickBody").innerHTML = "";
  if (id === "playModal") { clearInterval(play.t); play.rec = null; }
  syncFeeds();
}
function irA(v) {
  if (!yo()) return abrirLogin();
  if (v === "admin" && !can("usuarios.gestionar")) return deny();
  ui.vista = v; if (v !== "site") ui.sitio = null;
  ["profMsg", "pwMsg"].forEach(i => $(i).textContent = "");
  render(); window.scrollTo(0, 0);
}

/* ================= Eventos globales ================= */
document.addEventListener("click", e => {
  resetIdle();
  const t = e.target;
  if (t.classList && t.classList.contains("modal")) return cerrarModal(t.id);
  const nav = t.closest("[data-nav]"); if (nav) return irA(nav.dataset.nav);
  const lg = t.closest("[data-login]"); if (lg) return abrirLogin(lg.dataset.login);
  const por = t.closest("[data-portal]"); if (por) return setPortal(por.dataset.portal);
  const tab = t.closest("[data-tab]"); if (tab) { ui.tab = tab.dataset.tab; return render(); }
  const at = t.closest("[data-atab]"); if (at) { ui.atab = at.dataset.atab; return render(); }
  const cl = t.closest("[data-close]"); if (cl) return cerrarModal(cl.dataset.close);
  const b = t.closest("[data-act]"); if (!b) return;
  const id = Number(b.dataset.id);
  switch (b.dataset.act) {
    case "abrir": return abrirQuick(id);
    case "entrar": cerrarModal("quickModal"); return abrirSitio(id);
    case "volver": ui.vista = "hub"; ui.sitio = null; render(); return window.scrollTo(0, 0);
    case "nuevositio": return abrirModalSitio();
    case "delsitio": return eliminarSitio(id);
    case "delzona": return eliminarZona(id);
    case "ia": return diagnosticarIA(id);
    case "auditar": return auditarSitio();
    case "reiniciar": return reiniciar(id);
    case "mant": return toggleMant(id);
    case "editdev": return abrirEdit(id);
    case "deldev": return eliminarDispositivo(id);
    case "script": return ejecutarScript(b.dataset.log);
    case "fix": return runNextScript();
    case "scan": return runCmd("scan");
    case "clear": return runCmd("clear");
    case "play": return abrirPlay(b.dataset.key);
    case "resolver": {
      if (!can("incidencias.documentar")) return deny();
      const i = db.incidencias.find(x => x.id === id); if (!i) return;
      i.estado = "Resuelta"; audit(`Marcó como resuelta la incidencia "${i.titulo}"`); return render();
    }
    case "quitarfoto": { const u = yo(); if (u) { u.foto = ""; audit("Quitó su foto de perfil"); renderNav(); perfilHead(); } return; }
    case "quitarbanner": { const u = yo(); if (u) { u.banner = ""; audit("Quitó su banner"); perfilHead(); } return; }
    case "utoggle": return toggleUsuario(id);
    case "udel": return eliminarUsuario(id);
    case "testcanal": return testCanal(b.dataset.canal);
    case "rtog": { if (!can("reglas.gestionar")) return deny(); const r = db.config.reglas.find(x => x.id === id); if (r) { r.activa = !r.activa; audit(`${r.activa ? "Activó" : "Desactivó"} la regla "${r.nombre}"`); render(); } return; }
    case "rapr": { if (!can("reglas.gestionar")) return deny(); const r = db.config.reglas.find(x => x.id === id); if (r) { r.estado = "Aprobada"; audit(`Aprobó la regla "${r.nombre}"`); render(); } return; }
    case "full": { const el = b.closest(".tile").querySelector("canvas,video"); if (el && el.requestFullscreen) el.requestFullscreen().catch(() => {}); }
  }
});

document.addEventListener("change", e => {
  const t = e.target;
  const mv = t.closest("[data-move]");
  if (mv) {
    if (!can("dispositivos.gestionar")) return deny();
    const d = db.dispositivos.find(x => x.id === Number(mv.dataset.move));
    if (d) { d.zonaId = mv.value === "" ? null : Number(mv.value); audit(`Movió ${d.nombre} a ${zonaNombre(siteActual(), d.zonaId)}`); render(); toast(`📍 ${d.nombre} movido a ${zonaNombre(siteActual(), d.zonaId)}`); }
    return;
  }
  const ur = t.closest("[data-urol]"); if (ur) return cambiarRol(Number(ur.dataset.urol), ur.value);
  const rv = t.closest("[data-rulev]");
  if (rv) {
    if (!can("reglas.gestionar")) return deny();
    const r = db.config.reglas.find(x => x.id === Number(rv.dataset.rulev)), n = Number(rv.value);
    if (r && Number.isFinite(n) && n >= 1 && n <= 999) { r.valor = n; audit(`Modificó la regla "${r.nombre}" a ${n} ${r.unidad || ""}`); toast("✔ Regla actualizada"); } else render();
    return;
  }
  if (t.id === "liveZona") renderLive(siteActual());
  if (t.id === "recZona" || t.id === "recTipo") renderRec(siteActual());
  if (t.id === "devEstado") renderTabla();
  if (t.id === "hubTipo") renderHub();
  if (t.id === "uRol") $("uSitiosWrap").hidden = t.value !== "cliente";
  if (t.id === "playSpeed") updPlay();
});

$("filtro").addEventListener("input", renderTabla);
$("hubFiltro").addEventListener("input", renderHub);
$("showPass").addEventListener("change", e => $("pass").type = e.target.checked ? "text" : "password");
$("logoHome").addEventListener("click", e => { e.preventDefault(); if (yo()) { ui.vista = "hub"; ui.sitio = null; } render(); window.scrollTo(0, 0); });
$("btnSession").addEventListener("click", () => yo() ? logout() : abrirLogin());
document.addEventListener("keydown", e => { resetIdle(); if (e.key === "Escape") ["siteModal", "loginModal", "editModal", "quickModal", "playModal"].forEach(cerrarModal); });
window.addEventListener("scroll", () => $("topbar").classList.toggle("scrolled", window.scrollY > 8), { passive: true });

setPortal("cliente");
init();