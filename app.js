// Inventario · Farmacia y tienda — aplicación principal.
import * as U from "./utils.js";
import { ic } from "./icons.js";
import { cloudEnabled, LocalStore, CloudStore, loadFirebase } from "./store.js";
import { scanBarcode } from "./scanner.js";
import { openSheet, closeSheet, refreshSheets, toast, confirmBox, promptBox, sheetCount } from "./ui.js";

const { esc, money, qty, num } = U;
const VERSION = "1.0.0";
const METODOS = [
  { id: "Efectivo", icon: "cash" },
  { id: "QR", icon: "qr" },
  { id: "Tarjeta", icon: "card" },
];

// ───────────────────────── Estado ─────────────────────────
const S = {
  store: null,
  mode: cloudEnabled ? "cloud" : "local",
  fb: null,
  user: { uid: "", email: "", name: "" },
  negocio: { id: null, nombre: "Mi negocio", diasAviso: 30, owner: null, members: [] },
  unsubNegocio: null,
  view: "inicio",
  homePeriod: "hoy",
  salesPeriod: "semana",
  salesLimit: 60,
  q: "",
  filtro: "todos",
  orden: "nombre",
  limit: 50,
};
let D = null; // datos calculados
const cart = { items: new Map(), metodo: "Efectivo", paga: "", nota: "", fecha: null };
let installEvt = null;

const $ = (s, el = document) => el.querySelector(s);
const app = () => document.getElementById("app");

// ───────────────────────── Arranque ─────────────────────────
applyTheme();
boot();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").then((reg) => {
      reg.addEventListener("updatefound", () => {
        const nw = reg.installing;
        nw?.addEventListener("statechange", () => {
          if (nw.state === "installed" && navigator.serviceWorker.controller) {
            toast("Hay una versión nueva de la app", {
              action: "Actualizar", ms: 10000,
              onAction: () => nw.postMessage("skipWaiting"),
            });
          }
        });
      });
    }).catch(() => {});
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!reloaded) { reloaded = true; location.reload(); }
    });
  });
}
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvt = e; if (S.view === "mas") render(); });
window.addEventListener("online", () => S.store?.updateStatus?.());
window.addEventListener("offline", () => S.store?.updateStatus?.());

async function boot() {
  if (!cloudEnabled) {
    S.mode = "local";
    S.user.name = localStorage.getItem("inv-user") || "";
    Object.assign(S.negocio, JSON.parse(localStorage.getItem("inv-negocio") || "{}"));
    try {
      const st = new LocalStore();
      await st.init();
      startApp(st);
    } catch (e) {
      console.error(e);
      fatal("No se pudo abrir el almacenamiento del teléfono.", e.message);
    }
    return;
  }
  splash("Conectando…");
  try {
    S.fb = await loadFirebase();
  } catch (e) {
    console.error(e);
    return fatal("No se pudo conectar. Revisa tu internet y vuelve a intentarlo.", "", true);
  }
  const { A, auth } = S.fb;
  A.onAuthStateChanged(auth, async (u) => {
    stopApp();
    if (!u) return renderAuth();
    S.user = { uid: u.uid, email: (u.email || "").toLowerCase(), name: u.displayName || (u.email || "").split("@")[0] };
    enterNegocio();
  });
}

function splash(text) {
  app().innerHTML = `<div class="screen center"><div class="logo-badge">${ic("box")}</div><p class="muted">${esc(text)}</p></div>`;
}
function fatal(title, detail = "", retry = false) {
  app().innerHTML = `<div class="screen center">
    <div class="logo-badge danger">${ic("alert")}</div>
    <h2>${esc(title)}</h2>${detail ? `<p class="muted small">${esc(detail)}</p>` : ""}
    ${retry ? `<button class="btn primary" onclick="location.reload()">${ic("refresh")} Reintentar</button>` : ""}
  </div>`;
}
function stopApp() {
  S.store?.stop?.();
  S.store = null;
  S.unsubNegocio?.();
  S.unsubNegocio = null;
}

// ───────────────────────── Cuenta (modo compartido) ─────────────────────────
const AUTH_ERR = {
  "auth/invalid-credential": "Correo o contraseña incorrectos.",
  "auth/wrong-password": "Correo o contraseña incorrectos.",
  "auth/user-not-found": "No existe una cuenta con ese correo.",
  "auth/email-already-in-use": "Ya existe una cuenta con ese correo. Ingresa.",
  "auth/weak-password": "La contraseña debe tener al menos 6 caracteres.",
  "auth/invalid-email": "El correo no es válido.",
  "auth/network-request-failed": "Sin conexión a internet.",
  "auth/too-many-requests": "Demasiados intentos. Espera un momento.",
};

function renderAuth(mode = "login") {
  app().innerHTML = `
  <div class="screen auth">
    <div class="auth-brand"><div class="logo-badge">${ic("box")}</div><h1>Inventario</h1><p class="muted">Farmacia y tienda</p></div>
    <form class="card auth-card" novalidate>
      <div class="seg full" role="tablist">
        <button type="button" data-m="login" class="${mode === "login" ? "on" : ""}">Ingresar</button>
        <button type="button" data-m="signup" class="${mode === "signup" ? "on" : ""}">Crear cuenta</button>
      </div>
      ${mode === "signup" ? `<label class="field"><span>Tu nombre</span><input name="name" autocomplete="name" placeholder="Ej.: Ana" required></label>` : ""}
      <label class="field"><span>Correo</span><input name="email" type="email" inputmode="email" autocomplete="email" placeholder="tucorreo@gmail.com" required></label>
      <label class="field"><span>Contraseña</span><input name="pass" type="password" autocomplete="${mode === "login" ? "current-password" : "new-password"}" placeholder="Mínimo 6 caracteres" required></label>
      <p class="form-err" hidden></p>
      <button class="btn primary block lg">${mode === "login" ? "Ingresar" : "Crear cuenta"}</button>
      ${mode === "login" ? `<button type="button" class="link center" data-forgot>Olvidé mi contraseña</button>` : ""}
    </form>
  </div>`;
  const f = $("form", app());
  f.querySelectorAll("[data-m]").forEach((b) => (b.onclick = () => renderAuth(b.dataset.m)));
  const err = (m) => { const p = $(".form-err", f); p.textContent = m; p.hidden = !m; };
  $("[data-forgot]", f)?.addEventListener("click", async () => {
    const email = f.email.value.trim();
    if (!email) return err("Escribe tu correo primero.");
    try { await S.fb.A.sendPasswordResetEmail(S.fb.auth, email); toast("Te enviamos un correo para cambiar la contraseña"); }
    catch (e) { err(AUTH_ERR[e.code] || e.message); }
  });
  f.onsubmit = async (e) => {
    e.preventDefault();
    err("");
    const btn = $("button.primary", f);
    btn.disabled = true;
    const { A, auth } = S.fb;
    try {
      if (mode === "login") await A.signInWithEmailAndPassword(auth, f.email.value.trim(), f.pass.value);
      else {
        const name = f.name.value.trim();
        if (!name) throw { code: "x", message: "Escribe tu nombre." };
        const c = await A.createUserWithEmailAndPassword(auth, f.email.value.trim(), f.pass.value);
        await A.updateProfile(c.user, { displayName: name });
        S.user.name = name;
      }
    } catch (e2) {
      err(AUTH_ERR[e2.code] || e2.message || "No se pudo continuar.");
      btn.disabled = false;
    }
  };
}

async function enterNegocio() {
  const { F, db } = S.fb;
  splash("Cargando inventario…");
  const key = "inv-nid:" + S.user.uid;
  let nid = localStorage.getItem(key);
  if (!nid) {
    try {
      const u = await F.getDoc(F.doc(db, "usuarios", S.user.uid));
      nid = u.exists() ? u.data().negocioId : null;
    } catch (e) { console.warn(e); }
  }
  if (!nid) return renderSetup();
  try {
    await new Promise((resolve, reject) => {
      let first = true;
      S.unsubNegocio = F.onSnapshot(
        F.doc(db, "negocios", nid),
        (snap) => {
          if (!snap.exists()) { if (first) { first = false; reject(new Error("noexiste")); } return; }
          const d = snap.data();
          S.negocio = { id: nid, nombre: d.nombre || "Mi negocio", diasAviso: d.diasAviso || 30, owner: d.owner, members: d.members || [] };
          if (first) { first = false; resolve(); }
          else if (S.store) { derive(); render(); refreshSheets(); }
        },
        (e) => {
          if (first) { first = false; reject(e); }
          else if (e.code === "permission-denied") { localStorage.removeItem(key); stopApp(); renderSetup("Ya no tienes acceso a ese negocio."); }
        }
      );
    });
  } catch (e) {
    localStorage.removeItem(key);
    stopApp();
    return renderSetup(e.code === "permission-denied" ? "No tienes acceso a ese negocio. Pide al dueño que agregue tu correo." : "");
  }
  localStorage.setItem(key, nid);
  try {
    const st = new CloudStore(S.fb, nid);
    await st.init();
    startApp(st);
  } catch (e) {
    console.error(e);
    fatal("No se pudo cargar el inventario.", e.message, true);
  }
}

function renderSetup(msg = "") {
  const { F, db, A, auth } = S.fb;
  app().innerHTML = `
  <div class="screen auth">
    <div class="auth-brand"><div class="logo-badge">${ic("store")}</div><h1>Hola, ${esc(S.user.name)}</h1><p class="muted">${esc(S.user.email)}</p></div>
    ${msg ? `<p class="notice warn">${esc(msg)}</p>` : ""}
    <form class="card auth-card" data-create>
      <h3>Crear mi negocio</h3>
      <p class="muted small">Serás el dueño y podrás invitar a otras personas.</p>
      <label class="field"><span>Nombre del negocio</span><input name="nombre" placeholder="Ej.: Farmacia y tienda Ana" required></label>
      <button class="btn primary block">Crear</button>
    </form>
    <form class="card auth-card" data-join>
      <h3>Unirme a un negocio</h3>
      <p class="muted small">Pide al dueño que agregue tu correo <b>${esc(S.user.email)}</b> en <b>Más → Personas</b> y que te pase el código.</p>
      <label class="field"><span>Código del negocio</span><input name="code" autocomplete="off" autocapitalize="off" placeholder="Pega el código aquí" required></label>
      <p class="form-err" hidden></p>
      <button class="btn ghost block">Unirme</button>
    </form>
    <button class="link center" data-logout>${ic("logout")} Cerrar sesión</button>
  </div>`;
  const root = app();
  $("[data-logout]", root).onclick = () => A.signOut(auth);
  $("[data-create]", root).onsubmit = async (e) => {
    e.preventDefault();
    const nombre = e.target.nombre.value.trim();
    if (!nombre) return;
    e.target.querySelector("button").disabled = true;
    const nid = U.uid();
    try {
      await F.setDoc(F.doc(db, "negocios", nid), { nombre, owner: S.user.uid, members: [S.user.email], diasAviso: 30, creado: Date.now() });
      await F.setDoc(F.doc(db, "usuarios", S.user.uid), { negocioId: nid, email: S.user.email });
      localStorage.setItem("inv-nid:" + S.user.uid, nid);
      enterNegocio();
    } catch (err) {
      e.target.querySelector("button").disabled = false;
      toast("No se pudo crear: " + err.message, { type: "error" });
    }
  };
  $("[data-join]", root).onsubmit = async (e) => {
    e.preventDefault();
    const code = e.target.code.value.trim();
    const p = $(".form-err", e.target);
    if (!code) return;
    try {
      const snap = await F.getDoc(F.doc(db, "negocios", code));
      if (!snap.exists()) throw { code: "nf" };
      await F.setDoc(F.doc(db, "usuarios", S.user.uid), { negocioId: code, email: S.user.email });
      localStorage.setItem("inv-nid:" + S.user.uid, code);
      enterNegocio();
    } catch (err) {
      p.hidden = false;
      p.textContent = err.code === "permission-denied"
        ? "Tu correo aún no fue agregado a ese negocio."
        : err.code === "nf" ? "No existe un negocio con ese código." : "No se pudo unir: " + (err.message || "");
    }
  };
}

// ───────────────────────── App ─────────────────────────
function startApp(store) {
  S.store = store;
  app().innerHTML = `
    <main id="main" class="main"></main>
    <nav class="tabbar" aria-label="Secciones">
      <button data-tab="inicio">${ic("home")}<span>Inicio</span></button>
      <button data-tab="productos">${ic("box")}<span>Productos</span></button>
      <button class="tab-fab" data-act="vender" aria-label="Registrar venta">${ic("cart")}<em hidden></em></button>
      <button data-tab="ventas">${ic("receipt")}<span>Ventas</span></button>
      <button data-tab="mas">${ic("menu")}<span>Más</span></button>
    </nav>`;
  derive();
  render();
  let raf = 0, statusOnly = true;
  store.on((cols) => {
    if (!(cols.size === 1 && cols.has("_status"))) statusOnly = false;
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (statusOnly) { paintSync(); return; }
      statusOnly = true;
      derive();
      render(true);
      refreshSheets();
    });
  });
  // Accesos directos del ícono (mantener presionado): ?accion=vender | nuevo
  const accion = new URLSearchParams(location.search).get("accion");
  if (accion) {
    history.replaceState(history.state, "", location.pathname);
    setTimeout(() => (accion === "vender" ? openCart() : accion === "nuevo" ? openProductForm() : null), 200);
  }
}

document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-tab],[data-act],[data-open],[data-sale],[data-go]");
  if (!t || !S.store) return;
  if (t.dataset.tab) return go(t.dataset.tab);
  if (t.dataset.open) return openProduct(t.dataset.open);
  if (t.dataset.sale) return openSale(t.dataset.sale);
  if (t.dataset.go) {
    const [view, filtro] = t.dataset.go.split(":");
    if (filtro) { S.filtro = filtro; S.q = ""; }
    return go(view);
  }
  const a = t.dataset.act;
  if (a === "vender") openCart();
  else if (a === "nuevo") openProductForm();
  else if (a === "actividad") openActivity();
});

function go(view) {
  if (S.view === view) { window.scrollTo({ top: 0, behavior: "smooth" }); return; }
  S.view = view;
  S.limit = 50;
  render();
  window.scrollTo(0, 0);
}

function render(soft = false) {
  const main = document.getElementById("main");
  if (!main) return;
  document.querySelectorAll(".tabbar [data-tab]").forEach((b) => b.classList.toggle("on", b.dataset.tab === S.view));
  paintCartBadge();
  if (S.view === "productos") {
    if (!soft || !$("#plist", main)) main.innerHTML = viewProductos();
    paintProductList();
    bindProductos();
  } else {
    const y = window.scrollY;
    main.innerHTML = S.view === "inicio" ? viewInicio() : S.view === "ventas" ? viewVentas() : viewMas();
    if (soft) window.scrollTo(0, y);
    if (S.view === "mas") bindMas();
  }
  paintSync();
}

function paintSync() {
  const st = S.store?.status || "local";
  const map = {
    local: ["phone", "Guardado en este teléfono"],
    synced: ["cloud", "Sincronizado"],
    pending: ["cloudUp", "Guardando cambios…"],
    offline: ["cloudOff", "Sin conexión · se sincroniza al volver"],
  };
  const [icon, label] = map[st] || map.local;
  document.querySelectorAll("[data-sync]").forEach((b) => {
    b.innerHTML = ic(icon);
    b.title = label;
    b.dataset.state = st;
    b.onclick = () => toast(label);
  });
}
function paintCartBadge() {
  const em = document.querySelector(".tab-fab em");
  if (!em) return;
  const n = cart.items.size;
  em.hidden = !n;
  em.textContent = n;
}

// ───────────────────────── Datos calculados ─────────────────────────
const fefo = (a, b) => (a.vence || "9999-99-99").localeCompare(b.vence || "9999-99-99") || (a.creado || 0) - (b.creado || 0);

function derive() {
  const st = S.store;
  const dias = +S.negocio.diasAviso || 30;
  const lotesBy = new Map();
  for (const l of st.all("lotes")) {
    if (!lotesBy.has(l.productoId)) lotesBy.set(l.productoId, []);
    lotesBy.get(l.productoId).push(l);
  }
  const prods = st.all("productos");
  const info = new Map();
  const t = { unidades: 0, valor: 0, costo: 0, porVencer: 0, vencidos: 0, reponer: 0, agotados: 0, bajos: 0 };
  const alerts = [];
  const cats = new Set(), provs = new Set();
  for (const p of prods) {
    if (p.categoria) cats.add(p.categoria);
    if (p.proveedor) provs.add(p.proveedor);
    const ls = (lotesBy.get(p.id) || []).filter((l) => num(l.cantidad) > 0).sort(fefo);
    let stock = 0, vendible = 0, near = null, pv = 0, vc = 0;
    for (const l of ls) {
      const q = num(l.cantidad);
      const d = l.vence ? U.daysUntil(l.vence) : null;
      stock += q;
      if (d === null || d >= 0) vendible += q;
      if (d !== null) {
        if (near === null || d < near) near = d;
        if (d < 0) vc++; else if (d <= dias) pv++;
      }
    }
    const min = num(p.stockMin);
    const agotado = stock <= 0;
    const bajo = !agotado && min > 0 && stock <= min;
    const i = {
      stock, vendible, lotes: ls, near, agotado, bajo, reponer: agotado || bajo,
      porVencer: pv > 0, vencido: vc > 0, pv, vc,
      hay: U.norm([p.nombre, p.codigo, p.descripcion, p.presentacion, p.proveedor, p.categoria, p.tipo, p.ubicacion, p.notas, ...ls.map((l) => l.lote)].join(" ")),
    };
    info.set(p.id, i);
    t.unidades += stock;
    t.valor += stock * num(p.precio);
    t.costo += stock * num(p.costo);
    t.porVencer += pv;
    t.vencidos += vc;
    if (i.reponer) t.reponer++;
    if (agotado) t.agotados++;
    if (bajo) t.bajos++;
    if (vc) alerts.push({ p, kind: "danger", text: `${vc} lote${vc > 1 ? "s" : ""} vencido${vc > 1 ? "s" : ""}`, w: 0 });
    else if (pv) alerts.push({ p, kind: "warn", text: U.venceText(near), w: 1 + near / 1000 });
    if (agotado) alerts.push({ p, kind: "danger", text: "Agotado", w: 2 });
    else if (bajo) alerts.push({ p, kind: "warn", text: `Quedan ${qty(stock)}`, w: 3 });
  }
  alerts.sort((a, b) => a.w - b.w);

  const ventas = st.all("ventas").sort((a, b) => b.t - a.t);
  const sold30 = new Map();
  const since30 = Date.now() - 30 * 86400000;
  for (const v of ventas) {
    if (v.anulada || v.t < since30) continue;
    for (const it of v.items || []) sold30.set(it.productoId, (sold30.get(it.productoId) || 0) + num(it.cantidad));
  }
  D = { prods, info, t, alerts, ventas, sold30, cats: [...cats].sort(), provs: [...provs].sort(), byId: new Map(prods.map((p) => [p.id, p])) };
}

function periodRange(p) {
  const now = new Date();
  if (p === "hoy") return [U.startOfDay(now), Infinity];
  if (p === "semana") return [U.startOfWeek(now), Infinity];
  if (p === "mes") return [U.startOfMonth(now), Infinity];
  if (p === "30d") return [U.startOfDay(now) - 29 * 86400000, Infinity];
  return [0, Infinity];
}

function salesStats(p) {
  const [from, to] = periodRange(p);
  const r = { total: 0, unidades: 0, n: 0, ganancia: 0, conCosto: false, metodo: {}, prod: new Map(), list: [] };
  for (const v of D.ventas) {
    if (v.t < from || v.t >= to) continue;
    r.list.push(v);
    if (v.anulada) continue;
    r.n++;
    r.total += num(v.total);
    r.metodo[v.metodo || "Efectivo"] = (r.metodo[v.metodo || "Efectivo"] || 0) + num(v.total);
    for (const it of v.items || []) {
      const q = num(it.cantidad);
      r.unidades += q;
      if (num(it.costo) > 0) { r.conCosto = true; r.ganancia += (num(it.precio) - num(it.costo)) * q; }
      const k = it.productoId;
      const cur = r.prod.get(k) || { nombre: it.nombre, q: 0, total: 0, id: k };
      cur.q += q; cur.total += q * num(it.precio);
      r.prod.set(k, cur);
    }
  }
  r.top = [...r.prod.values()].sort((a, b) => b.total - a.total).slice(0, 5);
  r.buckets = buckets(p);
  return r;
}

function buckets(p) {
  const now = new Date();
  let b = [];
  if (p === "hoy") {
    const s = U.startOfDay(now);
    for (let h = 0; h < 24; h++) b.push({ from: s + h * 3600000, to: s + (h + 1) * 3600000, label: h % 6 === 0 ? `${h}h` : "", tip: `${h}:00–${h + 1}:00`, cur: h === now.getHours() });
  } else if (p === "semana") {
    const s = U.startOfWeek(now);
    for (let i = 0; i < 7; i++) {
      const d = new Date(s); d.setDate(d.getDate() + i);
      const e = new Date(d); e.setDate(e.getDate() + 1);
      b.push({ from: d.getTime(), to: e.getTime(), label: U.DIAS_C[i], tip: U.dayLabel(d.getTime()), cur: U.isoDay(d) === U.today() });
    }
  } else if (p === "mes" || p === "30d") {
    const days = p === "mes" ? new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() : 30;
    const s = p === "mes" ? U.startOfMonth(now) : U.startOfDay(now) - 29 * 86400000;
    for (let i = 0; i < days; i++) {
      const d = new Date(s); d.setDate(d.getDate() + i);
      const e = new Date(d); e.setDate(e.getDate() + 1);
      const n = d.getDate();
      b.push({ from: d.getTime(), to: e.getTime(), label: p === "mes" ? (n === 1 || n % 7 === 1 ? String(n) : "") : i % 7 === 0 ? String(n) : "", tip: U.dayLabel(d.getTime()), cur: U.isoDay(d) === U.today() });
    }
  } else {
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const e = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      const m = d.toLocaleDateString("es-BO", { month: "short" }).replace(".", "");
      b.push({ from: d.getTime(), to: e.getTime(), label: i % 2 === 0 ? m : "", tip: d.toLocaleDateString("es-BO", { month: "long", year: "numeric" }), cur: i === 0 });
    }
  }
  for (const x of b) x.v = 0;
  for (const v of D.ventas) {
    if (v.anulada) continue;
    const k = b.find((x) => v.t >= x.from && v.t < x.to);
    if (k) k.v += num(v.total);
  }
  return b;
}

function chartHtml(bs) {
  const max = Math.max(...bs.map((b) => b.v), 0);
  if (!max) return `<div class="chart empty"><p class="muted small">${ic("trend")} Sin ventas en este periodo todavía.</p></div>`;
  return `<div class="chart">
    <p class="chart-tip muted small">Toca una barra para ver el detalle</p>
    <div class="bars" style="--n:${bs.length}">${bs.map((b, i) => `<button class="bar ${b.cur ? "cur" : ""}" data-bar="${i}" data-tip="${esc(b.tip)}: ${esc(money(b.v))}" aria-label="${esc(b.tip)}: ${esc(money(b.v))}"><i style="height:${b.v ? Math.max(4, (b.v / max) * 100) : 0}%"></i></button>`).join("")}</div>
    <div class="axis" style="--n:${bs.length}">${bs.map((b) => `<span>${esc(b.label)}</span>`).join("")}</div>
  </div>`;
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-bar]");
  if (!b) return;
  const c = b.closest(".chart");
  c.querySelectorAll(".bar.sel").forEach((x) => x.classList.remove("sel"));
  b.classList.add("sel");
  c.querySelector(".chart-tip").textContent = b.dataset.tip;
});

// ───────────────────────── Vista: Inicio ─────────────────────────
function viewInicio() {
  const t = D.t;
  const st = salesStats(S.homePeriod);
  const empty = !D.prods.length;
  const recent = S.store.all("actividad").sort((a, b) => b.t - a.t).slice(0, 5);
  const subt = S.negocio.nombre ? ` · ${esc(S.negocio.nombre)}` : "";
  return `
  <section class="hero">
    <div class="hero-top">
      <div class="hero-logo">${ic("box")}</div>
      <div class="hero-txt"><small>${U.greeting()}${subt}</small><h1>Inventario</h1></div>
      <button class="icon-btn glass" data-sync aria-label="Estado"></button>
    </div>
    <div class="hero-date">${ic("calendar")} ${U.longDate()}</div>
    <div class="hero-actions">
      <button class="btn white lg" data-act="vender">${ic("cart")} Registrar venta</button>
      <button class="btn glass" data-act="nuevo">${ic("plus")} Nuevo producto</button>
    </div>
  </section>

  ${empty ? `
  <section class="card empty-card">
    <div class="empty-ico">${ic("box")}</div>
    <h3>Empieza con tu primer producto</h3>
    <p class="muted">Registra nombre, precio, foto, código de barras y el stock con su fecha de vencimiento.</p>
    <button class="btn primary" data-act="nuevo">${ic("plus")} Agregar producto</button>
  </section>` : ""}

  <div class="stats">
    <button class="stat" data-go="productos:todos">
      <span class="stat-ico teal">${ic("box")}</span>
      <span class="stat-txt"><small>Unidades</small><b>${qty(t.unidades)}</b><em>en ${D.prods.length} producto${D.prods.length === 1 ? "" : "s"}</em></span>
    </button>
    <button class="stat" data-go="productos:vencer">
      <span class="stat-ico amber">${ic("clock")}</span>
      <span class="stat-txt"><small>Por vencer</small><b>${t.porVencer}</b><em>${t.vencidos ? `<i class="red">${t.vencidos} vencido${t.vencidos > 1 ? "s" : ""}</i>` : `lotes · ${S.negocio.diasAviso} días`}</em></span>
    </button>
    <button class="stat" data-go="productos:reponer">
      <span class="stat-ico red">${ic("alert")}</span>
      <span class="stat-txt"><small>Reponer</small><b>${t.reponer}</b><em>${t.agotados} agotado${t.agotados === 1 ? "" : "s"} · ${t.bajos} bajo${t.bajos === 1 ? "" : "s"}</em></span>
    </button>
    <button class="stat" data-go="ventas">
      <span class="stat-ico green">${ic("wallet")}</span>
      <span class="stat-txt"><small>Valor en stock</small><b class="fit">${money(t.valor)}</b><em>${t.costo > 0 ? `costo ${money(t.costo)}` : "a precio de venta"}</em></span>
    </button>
  </div>

  <section class="card">
    <div class="card-head">
      <div><h3>Ventas</h3><p class="muted small">${periodLabel(S.homePeriod)}</p></div>
    </div>
    ${segHtml("home", [["hoy", "Hoy"], ["semana", "Semana"], ["mes", "Mes"]], S.homePeriod)}
    <div class="big-num">${money(st.total)}</div>
    <p class="muted">${qty(st.unidades)} unidades · ${st.n} venta${st.n === 1 ? "" : "s"}${st.conCosto ? ` · <b class="green-t">ganancia ${money(st.ganancia)}</b>` : ""}</p>
    ${chartHtml(st.buckets)}
    ${st.top.length ? `<h4 class="sub">Más vendidos</h4>${topHtml(st.top)}` : ""}
    <button class="link-row" data-tab="ventas">Ver todas las ventas ${ic("chev")}</button>
  </section>

  ${D.alerts.length ? `
  <section class="card">
    <div class="card-head"><h3>Necesita atención</h3><span class="pill">${D.alerts.length}</span></div>
    <div class="mini-list">${D.alerts.slice(0, 6).map((a) => `
      <button class="mini" data-open="${a.p.id}">
        ${thumb(a.p, "sm")}
        <span class="mini-txt"><b>${esc(a.p.nombre)}</b><small>${esc(a.p.presentacion || a.p.tipo || "")}</small></span>
        <span class="badge ${a.kind}">${esc(a.text)}</span>
      </button>`).join("")}</div>
    ${D.alerts.length > 6 ? `<button class="link-row" data-go="productos:reponer">Ver todos ${ic("chev")}</button>` : ""}
  </section>` : ""}

  ${recent.length ? `
  <section class="card">
    <div class="card-head"><h3>Actividad reciente</h3></div>
    <div class="act-list">${recent.map(actRow).join("")}</div>
    <button class="link-row" data-act="actividad">Ver todo el historial ${ic("chev")}</button>
  </section>` : ""}
  <div class="spacer"></div>`;
}

function periodLabel(p) {
  if (p === "hoy") return U.longDate();
  if (p === "semana") return "Desde el lunes " + U.fmtDay(U.isoDay(new Date(U.startOfWeek()))).replace(/ \d{4}$/, "");
  if (p === "mes") return "Desde el 1 de " + new Date().toLocaleDateString("es-BO", { month: "long" });
  if (p === "30d") return "Últimos 30 días";
  return "Últimos 12 meses";
}
function segHtml(name, opts, cur) {
  return `<div class="seg" data-seg="${name}">${opts.map(([v, l]) => `<button data-v="${v}" class="${v === cur ? "on" : ""}">${l}</button>`).join("")}</div>`;
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-seg] [data-v]");
  if (!b) return;
  const name = b.parentElement.dataset.seg;
  if (name === "home") { S.homePeriod = b.dataset.v; render(true); }
  else if (name === "sales") { S.salesPeriod = b.dataset.v; S.salesLimit = 60; render(true); }
});
function topHtml(top) {
  const max = top[0]?.total || 1;
  return `<div class="top-list">${top.map((x, i) => `
    <button class="top" ${D.byId.has(x.id) ? `data-open="${x.id}"` : ""}>
      <span class="top-n">${i + 1}</span>
      <span class="top-main"><b>${esc(x.nombre)}</b><span class="meter"><i style="width:${(x.total / max) * 100}%"></i></span></span>
      <span class="top-v"><b>${money(x.total)}</b><small>${qty(x.q)} u.</small></span>
    </button>`).join("")}</div>`;
}
function actRow(a) {
  return `<div class="act"><span class="act-dot k-${esc(a.tipo || "")}"></span><p><b>${esc(a.por || "Alguien")}</b> ${esc(a.texto)}<small>${U.ago(a.t)}</small></p></div>`;
}

function thumb(p, size = "") {
  if (p?.foto) return `<span class="thumb ${size}"><img src="${p.foto}" alt="" loading="lazy" decoding="async"></span>`;
  const icon = p?.tipo === "Tienda" ? "store" : "pill";
  return `<span class="thumb ${size} ph ${p?.tipo === "Tienda" ? "t" : "f"}">${ic(icon)}</span>`;
}

// ───────────────────────── Vista: Productos ─────────────────────────
const FILTROS = [
  ["todos", "Todos"], ["Farmacia", "Farmacia"], ["Tienda", "Tienda"],
  ["reponer", "Reponer"], ["vencer", "Por vencer"], ["vencidos", "Vencidos"], ["sinstock", "Agotados"],
];
function viewProductos() {
  return `
  <header class="page-head sticky">
    <div class="ph-row">
      <h1>Productos</h1>
      <button class="icon-btn" data-sync aria-label="Estado"></button>
      <button class="icon-btn solid" data-act="nuevo" aria-label="Nuevo producto">${ic("plus")}</button>
    </div>
    <div class="search">
      ${ic("search")}
      <input id="q" type="search" placeholder="Buscar producto, código, uso…" value="${esc(S.q)}" autocomplete="off" enterkeyhint="search">
      <button class="icon-btn sm" data-clear aria-label="Limpiar" ${S.q ? "" : "hidden"}>${ic("x")}</button>
      <button class="icon-btn sm accent" data-scan aria-label="Escanear código">${ic("scan")}</button>
    </div>
    <div class="chips" role="tablist">${FILTROS.map(([v, l]) => `<button data-f="${v}" class="chip ${S.filtro === v ? "on" : ""}">${l}<span data-fc="${v}"></span></button>`).join("")}</div>
  </header>
  <div class="list-tools">
    <span class="muted small" id="pcount"></span>
    <label class="sort">${ic("sort")}
      <select id="orden">
        ${[["nombre", "Nombre A–Z"], ["stock", "Menos stock"], ["vence", "Vence antes"], ["precio", "Mayor precio"], ["vendidos", "Más vendidos"], ["reciente", "Recién agregados"]]
          .map(([v, l]) => `<option value="${v}" ${S.orden === v ? "selected" : ""}>${l}</option>`).join("")}
      </select>
    </label>
  </div>
  <div id="plist" class="plist"></div>
  <div class="spacer"></div>`;
}

function filteredProducts() {
  const q = S.q.trim();
  let list = D.prods.filter((p) => {
    const i = D.info.get(p.id);
    switch (S.filtro) {
      case "Farmacia": case "Tienda": if (p.tipo !== S.filtro) return false; break;
      case "reponer": if (!i.reponer) return false; break;
      case "vencer": if (!i.porVencer) return false; break;
      case "vencidos": if (!i.vencido) return false; break;
      case "sinstock": if (!i.agotado) return false; break;
    }
    return !q || U.matches(i.hay, q);
  });
  const I = (p) => D.info.get(p.id);
  const byName = (a, b) => (a.nombre || "").localeCompare(b.nombre || "", "es", { sensitivity: "base" });
  const sorters = {
    nombre: byName,
    stock: (a, b) => I(a).stock - I(b).stock || byName(a, b),
    vence: (a, b) => (I(a).near ?? 1e9) - (I(b).near ?? 1e9) || byName(a, b),
    precio: (a, b) => num(b.precio) - num(a.precio) || byName(a, b),
    vendidos: (a, b) => (D.sold30.get(b.id) || 0) - (D.sold30.get(a.id) || 0) || byName(a, b),
    reciente: (a, b) => (b.creado || 0) - (a.creado || 0),
  };
  list.sort(sorters[S.orden] || byName);
  // Coincidencia exacta de código de barras arriba.
  if (q) {
    const exact = list.findIndex((p) => p.codigo && p.codigo === q);
    if (exact > 0) list.unshift(list.splice(exact, 1)[0]);
  }
  return list;
}

function paintProductList() {
  const box = $("#plist");
  if (!box) return;
  const list = filteredProducts();
  const cnt = { reponer: D.t.reponer, vencer: D.prods.filter((p) => D.info.get(p.id).porVencer).length, vencidos: D.prods.filter((p) => D.info.get(p.id).vencido).length, sinstock: D.t.agotados };
  document.querySelectorAll("[data-fc]").forEach((s) => { const n = cnt[s.dataset.fc]; s.textContent = n ? n : ""; });
  $("#pcount").textContent = `${list.length} producto${list.length === 1 ? "" : "s"}`;
  if (!list.length) {
    box.innerHTML = D.prods.length
      ? `<div class="empty-state">${ic("search")}<p>No hay productos que coincidan.</p>${S.q ? `<button class="btn ghost sm" data-newcode>${ic("plus")} Crear “${esc(S.q)}”</button>` : ""}</div>`
      : `<div class="empty-state">${ic("box")}<p>Todavía no hay productos.</p><button class="btn primary" data-act="nuevo">${ic("plus")} Agregar el primero</button></div>`;
    return;
  }
  const shown = list.slice(0, S.limit);
  box.innerHTML = shown.map(pcard).join("") + (list.length > S.limit ? `<div class="more" id="more">Cargando más…</div>` : "");
  const more = $("#more");
  if (more) {
    const io = new IntersectionObserver((en) => {
      if (en[0].isIntersecting) { io.disconnect(); S.limit += 50; paintProductList(); }
    }, { rootMargin: "400px" });
    io.observe(more);
  }
}

function pcard(p) {
  const i = D.info.get(p.id);
  const badges = [];
  if (i.vencido) badges.push(`<span class="badge danger">${i.vc} vencido${i.vc > 1 ? "s" : ""}</span>`);
  else if (i.porVencer) badges.push(`<span class="badge warn">${U.venceText(i.near)}</span>`);
  if (i.agotado) badges.push(`<span class="badge danger">Agotado</span>`);
  else if (i.bajo) badges.push(`<span class="badge warn">Stock bajo</span>`);
  const sub = [p.presentacion, p.categoria || p.tipo].filter(Boolean).join(" · ");
  return `<button class="pcard" data-open="${p.id}">
    ${thumb(p)}
    <span class="pmain">
      <b class="pname">${esc(p.nombre)}</b>
      ${sub ? `<small class="psub">${esc(sub)}</small>` : ""}
      ${badges.length ? `<span class="badges">${badges.join("")}</span>` : ""}
    </span>
    <span class="pside">
      <b class="price">${num(p.precio) ? money(p.precio) : `<i class="muted">Sin precio</i>`}</b>
      <small class="stock ${i.agotado ? "red" : i.bajo ? "amber" : ""}">${qty(i.stock)} u.</small>
    </span>
  </button>`;
}

function bindProductos() {
  const q = $("#q");
  if (!q || q.dataset.bound) return;
  q.dataset.bound = 1;
  const clear = $("[data-clear]");
  const run = U.debounce(() => { S.limit = 50; paintProductList(); }, 120);
  q.addEventListener("input", () => { S.q = q.value; clear.hidden = !S.q; run(); });
  q.addEventListener("keydown", (e) => { if (e.key === "Enter") q.blur(); });
  clear.onclick = () => { q.value = ""; S.q = ""; clear.hidden = true; paintProductList(); };
  $("[data-scan]").onclick = async () => {
    const code = await scanBarcode();
    if (!code) return;
    const p = D.prods.find((x) => x.codigo === code);
    if (p) return openProduct(p.id);
    q.value = S.q = code;
    clear.hidden = false;
    paintProductList();
    const ok = await confirmBox({ title: "Código nuevo", text: `No hay ningún producto con el código ${code}. ¿Quieres crearlo?`, ok: "Crear producto" });
    if (ok) openProductForm(null, { codigo: code });
  };
  document.querySelectorAll("[data-f]").forEach((b) => (b.onclick = () => {
    S.filtro = b.dataset.f; S.limit = 50;
    document.querySelectorAll("[data-f]").forEach((x) => x.classList.toggle("on", x === b));
    b.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
    paintProductList();
  }));
  $("#orden").onchange = (e) => { S.orden = e.target.value; paintProductList(); };
  $("#plist").addEventListener("click", (e) => {
    if (e.target.closest("[data-newcode]")) {
      const v = S.q.trim();
      openProductForm(null, /^\d{6,}$/.test(v) ? { codigo: v } : { nombre: v });
    }
  });
}

// ───────────────────────── Vista: Ventas ─────────────────────────
function viewVentas() {
  const st = salesStats(S.salesPeriod);
  const list = st.list.slice(0, S.salesLimit);
  const groups = [];
  for (const v of list) {
    const k = U.isoDay(new Date(v.t));
    let g = groups[groups.length - 1];
    if (!g || g.k !== k) groups.push((g = { k, t: v.t, items: [], total: 0 }));
    g.items.push(v);
    if (!v.anulada) g.total += num(v.total);
  }
  const met = Object.entries(st.metodo).sort((a, b) => b[1] - a[1]);
  return `
  <header class="page-head">
    <div class="ph-row"><h1>Ventas</h1><button class="icon-btn" data-sync aria-label="Estado"></button><button class="icon-btn solid" data-act="vender" aria-label="Nueva venta">${ic("plus")}</button></div>
    ${segHtml("sales", [["hoy", "Hoy"], ["semana", "Semana"], ["mes", "Mes"], ["30d", "30 días"], ["todo", "Año"]], S.salesPeriod)}
  </header>
  <section class="card">
    <p class="muted small">${periodLabel(S.salesPeriod)}</p>
    <div class="big-num">${money(st.total)}</div>
    <div class="kpi-row">
      <div><small>Ventas</small><b>${st.n}</b></div>
      <div><small>Unidades</small><b>${qty(st.unidades)}</b></div>
      <div><small>Promedio</small><b>${money(st.n ? st.total / st.n : 0)}</b></div>
      ${st.conCosto ? `<div><small>Ganancia</small><b class="green-t">${money(st.ganancia)}</b></div>` : ""}
    </div>
    ${chartHtml(st.buckets)}
    ${met.length ? `<div class="met-row">${met.map(([m, v]) => `<span class="met">${ic((METODOS.find((x) => x.id === m) || METODOS[0]).icon)} ${esc(m)} <b>${money(v)}</b></span>`).join("")}</div>` : ""}
  </section>
  ${st.top.length ? `<section class="card"><div class="card-head"><h3>Más vendidos</h3></div>${topHtml(st.top)}</section>` : ""}
  <section class="sales-list">
    ${groups.length ? groups.map((g) => `
      <div class="day-head"><span>${U.dayLabel(g.t)}</span><b>${money(g.total)}</b></div>
      <div class="card flush">${g.items.map(saleRow).join("")}</div>`).join("")
      : `<div class="empty-state">${ic("receipt")}<p>No hay ventas en este periodo.</p><button class="btn primary" data-act="vender">${ic("cart")} Registrar venta</button></div>`}
    ${st.list.length > S.salesLimit ? `<button class="btn ghost block" data-moresales>Ver más ventas</button>` : ""}
  </section>
  <div class="spacer"></div>`;
}
document.addEventListener("click", (e) => {
  if (e.target.closest("[data-moresales]")) { S.salesLimit += 60; render(true); }
});
function saleRow(v) {
  const items = v.items || [];
  const names = items.slice(0, 2).map((i) => `${qty(i.cantidad)}× ${i.nombre}`).join(", ") + (items.length > 2 ? ` +${items.length - 2}` : "");
  const m = METODOS.find((x) => x.id === v.metodo) || METODOS[0];
  return `<button class="sale ${v.anulada ? "void" : ""}" data-sale="${v.id}">
    <span class="sale-ico">${ic(m.icon)}</span>
    <span class="sale-main"><b>${esc(names)}</b><small>${[U.fmtTime(v.t), esc(v.por || ""), v.anulada ? "Anulada" : ""].filter(Boolean).join(" · ")}</small></span>
    <b class="sale-total">${money(v.total)}</b>
  </button>`;
}

// ───────────────────────── Vista: Más ─────────────────────────
function viewMas() {
  const theme = localStorage.getItem("inv-theme") || "auto";
  const isOwner = S.mode === "cloud" && S.negocio.owner === S.user.uid;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !navigator.standalone;
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  return `
  <header class="page-head"><div class="ph-row"><h1>Más</h1><button class="icon-btn" data-sync aria-label="Estado"></button></div></header>

  ${!standalone && (installEvt || ios) ? `
  <section class="card install">
    <div class="row gap"><span class="stat-ico teal">${ic("download")}</span><div class="grow"><b>Instalar la app</b><p class="muted small">${installEvt ? "Ábrela desde tu pantalla de inicio, a pantalla completa." : "En Safari toca Compartir y luego “Agregar a inicio”."}</p></div>
    ${installEvt ? `<button class="btn primary sm" data-install>Instalar</button>` : ""}</div>
  </section>` : ""}

  <h4 class="sec-title">Negocio</h4>
  <section class="card flush">
    <button class="set" data-set="nombre">${ic("store")}<span><b>Nombre</b><small>${esc(S.negocio.nombre || "Sin nombre")}</small></span>${ic("chev")}</button>
    <button class="set" data-set="dias">${ic("clock")}<span><b>Aviso de vencimiento</b><small>${S.negocio.diasAviso} días antes</small></span>${ic("chev")}</button>
    ${S.mode === "local" ? `<button class="set" data-set="yo">${ic("user")}<span><b>Tu nombre</b><small>${esc(S.user.name || "Sin nombre (aparece en el historial)")}</small></span>${ic("chev")}</button>` : ""}
  </section>

  <h4 class="sec-title">Personas</h4>
  <section class="card">
    ${S.mode === "cloud" ? `
      <div class="row gap"><span class="avatar">${esc((S.user.name || "?")[0].toUpperCase())}</span><div class="grow"><b>${esc(S.user.name)}</b><p class="muted small">${esc(S.user.email)}${isOwner ? " · Dueño" : ""}</p></div></div>
      <div class="members">${S.negocio.members.map((m) => `
        <div class="member"><span>${ic("user")}</span><p>${esc(m)}</p>${isOwner && m !== S.user.email ? `<button class="icon-btn sm" data-rm="${esc(m)}" aria-label="Quitar">${ic("x")}</button>` : ""}</div>`).join("")}</div>
      ${isOwner ? `<button class="btn ghost block" data-addmember>${ic("plus")} Agregar persona por correo</button>` : ""}
      <div class="code-box"><small class="muted">Código del negocio</small><code>${esc(S.negocio.id)}</code><button class="icon-btn sm" data-copy aria-label="Copiar">${ic("copy")}</button></div>
      <p class="muted small">Para invitar: agrega su correo arriba y pásale este código. Ella crea su cuenta en la app y elige “Unirme a un negocio”.</p>
    ` : `
      <div class="row gap"><span class="stat-ico amber">${ic("phone")}</span><div class="grow"><b>Modo local</b><p class="muted small">Los datos se guardan solo en este teléfono.</p></div></div>
      <p class="muted small mt">Para que otras personas vean y editen el mismo inventario desde su celular, conecta Firebase (gratis). Los pasos están en el archivo <b>README.md</b>.</p>
    `}
  </section>

  <h4 class="sec-title">Apariencia</h4>
  <section class="card">
    ${segHtml("theme", [["auto", "Automático"], ["light", "Claro"], ["dark", "Oscuro"]], theme).replace('class="seg"', 'class="seg full"')}
  </section>

  <h4 class="sec-title">Datos</h4>
  <section class="card flush">
    <button class="set" data-act="actividad">${ic("activity")}<span><b>Historial de cambios</b><small>Quién hizo qué y cuándo</small></span>${ic("chev")}</button>
    <button class="set" data-backup>${ic("download")}<span><b>Descargar respaldo</b><small>Archivo con productos, lotes y ventas</small></span>${ic("chev")}</button>
    <label class="set">${ic("upload")}<span><b>Restaurar respaldo</b><small>Agrega o actualiza datos desde un archivo</small></span>${ic("chev")}<input type="file" accept="application/json,.json" data-restore hidden></label>
    <button class="set" data-csv>${ic("receipt")}<span><b>Exportar ventas (Excel)</b><small>Archivo CSV de todas las ventas</small></span>${ic("chev")}</button>
  </section>

  ${S.mode === "cloud" ? `<button class="btn ghost block danger-t mt" data-logout>${ic("logout")} Cerrar sesión</button>` : ""}
  <p class="muted small center mt">Inventario v${VERSION} · ${D.prods.length} productos · ${D.ventas.length} ventas</p>
  <div class="spacer"></div>`;
}

function bindMas() {
  const main = $("#main");
  main.querySelector("[data-install]")?.addEventListener("click", async () => {
    installEvt.prompt();
    await installEvt.userChoice.catch(() => {});
    installEvt = null; render(true);
  });
  main.querySelectorAll("[data-seg='theme'] [data-v]").forEach((b) => (b.onclick = () => {
    localStorage.setItem("inv-theme", b.dataset.v); applyTheme(); render(true);
  }));
  main.querySelectorAll("[data-set]").forEach((b) => (b.onclick = async () => {
    const k = b.dataset.set;
    if (k === "nombre") {
      const v = await promptBox({ title: "Nombre del negocio", label: "Nombre", value: S.negocio.nombre });
      if (v !== null) saveNegocio({ nombre: v || "Mi negocio" });
    } else if (k === "dias") {
      const v = await promptBox({ title: "Aviso de vencimiento", label: "Avisar cuántos días antes", value: String(S.negocio.diasAviso), inputmode: "numeric" });
      if (v !== null && num(v) > 0) saveNegocio({ diasAviso: Math.round(num(v)) });
    } else if (k === "yo") {
      const v = await promptBox({ title: "Tu nombre", label: "Nombre", value: S.user.name, placeholder: "Ej.: Ana" });
      if (v !== null) { S.user.name = v; localStorage.setItem("inv-user", v); render(true); }
    }
  }));
  main.querySelector("[data-addmember]")?.addEventListener("click", async () => {
    const v = await promptBox({ title: "Agregar persona", label: "Correo de la persona", placeholder: "correo@gmail.com", ok: "Agregar", inputmode: "email" });
    const email = (v || "").trim().toLowerCase();
    if (!email) return;
    if (!/^\S+@\S+\.\S+$/.test(email)) return toast("Ese correo no es válido", { type: "error" });
    if (S.negocio.members.includes(email)) return toast("Ya está agregada");
    saveNegocio({ members: [...S.negocio.members, email] });
    toast("Persona agregada. Pásale el código del negocio.");
  });
  main.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = async () => {
    const email = b.dataset.rm;
    if (await confirmBox({ title: "Quitar persona", text: `${email} ya no podrá ver ni editar el inventario.`, ok: "Quitar", danger: true }))
      saveNegocio({ members: S.negocio.members.filter((m) => m !== email) });
  }));
  main.querySelector("[data-copy]")?.addEventListener("click", () => {
    navigator.clipboard?.writeText(S.negocio.id).then(() => toast("Código copiado"), () => toast(S.negocio.id));
  });
  main.querySelector("[data-logout]")?.addEventListener("click", async () => {
    if (!(await confirmBox({ title: "Cerrar sesión", text: "Tus datos quedan guardados en la nube.", ok: "Cerrar sesión" }))) return;
    localStorage.removeItem("inv-nid:" + S.user.uid);
    S.fb.A.signOut(S.fb.auth);
  });
  main.querySelector("[data-backup]").onclick = exportBackup;
  main.querySelector("[data-csv]").onclick = exportCsv;
  main.querySelector("[data-restore]").onchange = (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) importBackup(f); };
}

function saveNegocio(changes) {
  Object.assign(S.negocio, changes);
  if (S.mode === "local") {
    localStorage.setItem("inv-negocio", JSON.stringify({ nombre: S.negocio.nombre, diasAviso: S.negocio.diasAviso }));
  } else {
    const { F, db } = S.fb;
    F.updateDoc(F.doc(db, "negocios", S.negocio.id), changes).catch((e) => toast("No se pudo guardar: " + e.message, { type: "error" }));
  }
  derive(); render(true);
}

function applyTheme() {
  const t = localStorage.getItem("inv-theme") || "auto";
  const dark = t === "dark" || (t === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0f1716" : "#0f766e");
}
matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", applyTheme);

// ───────────────────────── Escrituras ─────────────────────────
function logOp(tipo, texto, extra = {}) {
  return { type: "set", col: "actividad", id: U.uid(), data: { t: Date.now(), por: S.user.name || "Yo", uid: S.user.uid || "", tipo, texto, ...extra } };
}
async function commit(ops) {
  if (S.mode === "local") {
    const acts = S.store.all("actividad");
    if (acts.length > 600) acts.sort((a, b) => a.t - b.t).slice(0, acts.length - 500).forEach((a) => ops.push({ type: "del", col: "actividad", id: a.id }));
  }
  try {
    const p = S.store.apply(ops);
    if (S.mode === "cloud") p.catch((e) => { console.error(e); toast("No se pudo guardar en la nube: " + (e.code || e.message), { type: "error", ms: 5000 }); });
    else await p;
    return true;
  } catch (e) {
    console.error(e);
    toast("No se pudo guardar: " + e.message, { type: "error" });
    return false;
  }
}
const stamp = () => ({ actualizado: Date.now(), por: S.user.name || "" });

// ───────────────────────── Hoja: Detalle de producto ─────────────────────────
function openProduct(id) {
  const p0 = D.byId.get(id);
  if (!p0) return;
  openSheet({
    title: p0.nombre,
    cls: "tall",
    body: productBody(id),
    refresh(el) {
      const p = D.byId.get(id);
      if (!p) return closeSheet();
      el.querySelector(".sheet-head h2").textContent = p.nombre;
      const b = el.querySelector(".sheet-body");
      const y = b.scrollTop;
      b.innerHTML = productBody(id);
      b.scrollTop = y;
    },
    mount(el) {
      el.querySelector(".sheet-body").addEventListener("click", (e) => {
        const t = e.target.closest("[data-pa]");
        if (!t) return;
        e.stopPropagation();
        const a = t.dataset.pa;
        if (a === "vender") { addToCart(id); openCart(); }
        else if (a === "lote") openLoteForm(id);
        else if (a === "editlote") openLoteForm(id, t.dataset.id);
        else if (a === "editar") openProductForm(id);
        else if (a === "foto") viewPhoto(D.byId.get(id));
      });
    },
  });
}

function productBody(id) {
  const p = D.byId.get(id);
  const i = D.info.get(id);
  const precio = num(p.precio), costo = num(p.costo);
  const margen = precio && costo ? ((precio - costo) / precio) * 100 : null;
  const ventasP = D.ventas.filter((v) => !v.anulada && (v.items || []).some((it) => it.productoId === id)).slice(0, 6);
  const rows = [
    ["scan", "Código de barras", p.codigo],
    ["box", "Presentación", p.presentacion],
    ["tag", "Categoría", p.categoria],
    ["truck", "Proveedor", p.proveedor],
    ["pin", "Ubicación", p.ubicacion],
    ["alert", "Avisar cuando queden", num(p.stockMin) ? `${qty(p.stockMin)} unidades` : ""],
  ].filter((r) => r[2]);
  return `
  <div class="pd-top">
    <button class="pd-photo ${p.foto ? "" : "ph " + (p.tipo === "Tienda" ? "t" : "f")}" ${p.foto ? 'data-pa="foto"' : ""} aria-label="Foto">
      ${p.foto ? `<img src="${p.foto}" alt="">` : ic(p.tipo === "Tienda" ? "store" : "pill")}
    </button>
    <div class="pd-head">
      <div class="chips-inline">${p.tipo ? `<span class="tag ${p.tipo === "Tienda" ? "t" : "f"}">${esc(p.tipo)}</span>` : ""}${p.categoria ? `<span class="tag">${esc(p.categoria)}</span>` : ""}</div>
      <div class="pd-price">${precio ? money(precio) : '<span class="muted">Sin precio</span>'}</div>
      ${costo ? `<small class="muted">Costo ${money(costo)}${margen !== null ? ` · margen ${Math.round(margen)}%` : ""}</small>` : ""}
    </div>
  </div>
  <div class="kpi-row boxed">
    <div><small>Stock</small><b class="${i.agotado ? "red" : i.bajo ? "amber" : ""}">${qty(i.stock)}</b></div>
    <div><small>Vendidos 30 d</small><b>${qty(D.sold30.get(id) || 0)}</b></div>
    <div><small>Vence</small><b class="${i.vencido ? "red" : i.porVencer ? "amber" : ""}">${i.near === null ? "—" : i.near < 0 ? "Vencido" : i.near <= 99 ? i.near + " d" : U.fmtDay(i.lotes.find((l) => l.vence)?.vence).replace(/^\d+ /, "")}</b></div>
  </div>
  <div class="pd-actions">
    <button class="btn primary" data-pa="vender" ${i.vendible > 0 ? "" : "disabled"}>${ic("cart")} Vender</button>
    <button class="btn ghost" data-pa="lote">${ic("plus")} Stock</button>
    <button class="btn ghost" data-pa="editar">${ic("edit")} Editar</button>
  </div>

  <h4 class="sub">Lotes y vencimientos</h4>
  ${i.lotes.length ? `<div class="card flush">${i.lotes.map((l) => {
    const d = l.vence ? U.daysUntil(l.vence) : null;
    const cls = d === null ? "" : d < 0 ? "danger" : d <= S.negocio.diasAviso ? "warn" : "ok";
    return `<button class="lote" data-pa="editlote" data-id="${l.id}">
      <span class="lote-q"><b>${qty(l.cantidad)}</b><small>u.</small></span>
      <span class="lote-main"><b>${l.vence ? U.fmtDay(l.vence) : "Sin vencimiento"}</b><small>${[l.lote ? "Lote " + esc(l.lote) : "", esc(l.nota || "")].filter(Boolean).join(" · ") || "&nbsp;"}</small></span>
      ${d !== null ? `<span class="badge ${cls}">${U.venceText(d)}</span>` : ""}
      ${ic("chev", "chev")}
    </button>`;
  }).join("")}</div>`
  : `<div class="empty-inline">${ic("box")} Sin stock. Toca <b>Stock</b> para agregar unidades.</div>`}

  ${rows.length || p.descripcion || p.notas ? `<h4 class="sub">Información</h4>
  <div class="card flush info">
    ${rows.map(([icn, l, v]) => `<div class="info-row">${ic(icn)}<span><small>${l}</small><b>${esc(v)}</b></span></div>`).join("")}
    ${p.descripcion ? `<div class="info-row">${ic("info")}<span><small>Uso o descripción</small><p>${esc(p.descripcion)}</p></span></div>` : ""}
    ${p.notas ? `<div class="info-row">${ic("edit")}<span><small>Notas</small><p>${esc(p.notas)}</p></span></div>` : ""}
  </div>` : ""}

  ${ventasP.length ? `<h4 class="sub">Últimas ventas</h4><div class="card flush">${ventasP.map((v) => {
    const it = v.items.filter((x) => x.productoId === id);
    const q = it.reduce((a, x) => a + num(x.cantidad), 0);
    const tot = it.reduce((a, x) => a + num(x.cantidad) * num(x.precio), 0);
    return `<button class="sale" data-sale="${v.id}"><span class="sale-main"><b>${qty(q)} u. · ${money(tot)}</b><small>${U.fmtDateTime(v.t)} · ${esc(v.por || "")}</small></span>${ic("chev", "chev")}</button>`;
  }).join("")}</div>` : ""}
  ${p.actualizado ? `<p class="muted small center mt">Actualizado ${U.ago(p.actualizado)}${p.por ? " por " + esc(p.por) : ""}</p>` : ""}`;
}

function viewPhoto(p) {
  if (!p?.foto) return;
  openSheet({ title: p.nombre, cls: "photo", body: `<img class="full-photo" src="${p.foto}" alt="">` });
}

// ───────────────────────── Hoja: Formulario de producto ─────────────────────────
function openProductForm(id = null, preset = {}) {
  const p = id ? { ...D.byId.get(id) } : { tipo: "Farmacia", ...preset };
  let foto = p.foto || "";
  const isNew = !id;
  const opt = (arr) => arr.map((x) => `<option value="${esc(x)}">`).join("");
  openSheet({
    title: isNew ? "Nuevo producto" : "Editar producto",
    cls: "tall form",
    body: `
    <form class="pform" novalidate autocomplete="off">
      <div class="photo-pick">
        <label class="photo-box ${foto ? "has" : ""}">
          <input type="file" accept="image/*" capture="environment" data-cam hidden>
          <span class="photo-img">${foto ? `<img src="${foto}" alt="">` : ic("camera")}</span>
        </label>
        <div class="photo-actions">
          <b>Foto del producto</b>
          <div class="row gap-s">
            <label class="btn ghost sm">${ic("camera")} Cámara<input type="file" accept="image/*" capture="environment" data-cam hidden></label>
            <label class="btn ghost sm">${ic("image")} Galería<input type="file" accept="image/*" data-cam hidden></label>
            <button type="button" class="btn ghost sm danger-t" data-nofoto ${foto ? "" : "hidden"}>${ic("trash")}</button>
          </div>
        </div>
      </div>

      <label class="field"><span>Nombre del producto *</span><input name="nombre" value="${esc(p.nombre)}" placeholder="Ej.: Paracetamol 500 mg" autocapitalize="sentences" required></label>
      <div class="field"><span>Tipo</span>
        <div class="seg full" data-tipo>${["Farmacia", "Tienda"].map((t) => `<button type="button" data-v="${t}" class="${p.tipo === t ? "on" : ""}">${ic(t === "Farmacia" ? "pill" : "store")} ${t}</button>`).join("")}</div>
      </div>
      <div class="grid2">
        <label class="field"><span>Precio de venta</span><div class="affix"><em>Bs.</em><input name="precio" inputmode="decimal" value="${esc(U.fieldNum(p.precio))}" placeholder="0,00"></div></label>
        <label class="field"><span>Costo <i>(opcional)</i></span><div class="affix"><em>Bs.</em><input name="costo" inputmode="decimal" value="${esc(U.fieldNum(p.costo))}" placeholder="0,00"></div></label>
      </div>
      <p class="hint" data-margin></p>
      <label class="field"><span>Código de barras</span>
        <div class="affix btn-in"><input name="codigo" value="${esc(p.codigo)}" inputmode="numeric" placeholder="Escanea o escribe"><button type="button" class="icon-btn sm accent" data-scanfield aria-label="Escanear">${ic("scan")}</button></div>
      </label>
      <p class="hint warn-t" data-dup hidden></p>
      <div class="grid2">
        <label class="field"><span>Presentación</span><input name="presentacion" value="${esc(p.presentacion)}" placeholder="Caja x 20, 120 ml…"></label>
        <label class="field"><span>Categoría</span><input name="categoria" value="${esc(p.categoria)}" list="dl-cat" placeholder="Analgésicos, bebidas…"></label>
      </div>
      <div class="grid2">
        <label class="field"><span>Avisar si quedan</span><input name="stockMin" inputmode="decimal" value="${esc(U.fieldNum(p.stockMin))}" placeholder="Ej.: 5"></label>
        <label class="field"><span>Ubicación</span><input name="ubicacion" value="${esc(p.ubicacion)}" placeholder="Estante A-2"></label>
      </div>

      ${isNew ? `
      <fieldset class="box">
        <legend>${ic("box")} Stock inicial</legend>
        <div class="grid2">
          <label class="field"><span>Cantidad</span><input name="cantidad" inputmode="decimal" placeholder="0"></label>
          <label class="field"><span>Vence</span><input name="vence" type="date"></label>
        </div>
        <label class="field"><span>N.º de lote <i>(opcional)</i></span><input name="lote" placeholder="Ej.: L2311"></label>
      </fieldset>` : ""}

      <details class="more-fields" ${p.proveedor || p.descripcion || p.notas ? "open" : ""}>
        <summary>Proveedor, uso y notas ${ic("down")}</summary>
        <label class="field"><span>Proveedor</span><input name="proveedor" value="${esc(p.proveedor)}" list="dl-prov" placeholder="Nombre del proveedor"></label>
        <label class="field"><span>Uso o descripción</span><textarea name="descripcion" rows="3" placeholder="¿Para qué sirve? Detalles útiles…">${esc(p.descripcion)}</textarea></label>
        <label class="field"><span>Notas</span><textarea name="notas" rows="2" placeholder="Opcional">${esc(p.notas)}</textarea></label>
      </details>
      ${!isNew ? `<button type="button" class="btn ghost block danger-t mt" data-del>${ic("trash")} Eliminar producto</button>` : ""}
      <datalist id="dl-cat">${opt(D.cats)}</datalist>
      <datalist id="dl-prov">${opt(D.provs)}</datalist>
    </form>`,
    footer: `<button class="btn primary block lg" data-save>${ic("check")} ${isNew ? "Guardar producto" : "Guardar cambios"}</button>`,
    mount(el) {
      const f = el.querySelector("form");
      let tipo = p.tipo || "Farmacia";
      el.querySelectorAll("[data-tipo] [data-v]").forEach((b) => (b.onclick = () => {
        tipo = b.dataset.v;
        el.querySelectorAll("[data-tipo] [data-v]").forEach((x) => x.classList.toggle("on", x === b));
      }));
      const setFoto = (src) => {
        foto = src;
        el.querySelector(".photo-img").innerHTML = src ? `<img src="${src}" alt="">` : ic("camera");
        el.querySelector(".photo-box").classList.toggle("has", !!src);
        el.querySelector("[data-nofoto]").hidden = !src;
      };
      el.querySelectorAll("[data-cam]").forEach((inp) => (inp.onchange = async () => {
        const file = inp.files[0];
        inp.value = "";
        if (!file) return;
        el.querySelector(".photo-box").classList.add("busy");
        try { setFoto(await U.shrinkImage(file)); } catch { toast("No se pudo leer la foto", { type: "error" }); }
        el.querySelector(".photo-box").classList.remove("busy");
      }));
      el.querySelector("[data-nofoto]").onclick = () => setFoto("");
      const margin = () => {
        const pr = num(f.precio.value), co = num(f.costo.value);
        const h = el.querySelector("[data-margin]");
        h.textContent = pr && co ? `Ganancia por unidad ${money(pr - co)} · margen ${Math.round(((pr - co) / pr) * 100)}%` : "";
        h.classList.toggle("red", pr && co && co > pr);
      };
      f.precio.oninput = f.costo.oninput = margin;
      margin();
      const dup = () => {
        const c = f.codigo.value.trim();
        const other = c && D.prods.find((x) => x.codigo === c && x.id !== id);
        const h = el.querySelector("[data-dup]");
        h.hidden = !other;
        if (other) h.textContent = `Este código ya es de “${other.nombre}”.`;
      };
      f.codigo.oninput = dup;
      dup();
      el.querySelector("[data-scanfield]").onclick = async () => {
        const c = await scanBarcode();
        if (c) { f.codigo.value = c; dup(); }
      };
      el.querySelector("[data-del]")?.addEventListener("click", async () => {
        const n = D.info.get(id)?.lotes.length || 0;
        const ok = await confirmBox({ title: "Eliminar producto", text: `Se eliminará “${p.nombre}”${n ? ` y sus ${n} lote${n > 1 ? "s" : ""}` : ""}. Las ventas registradas se conservan.`, ok: "Eliminar", danger: true });
        if (!ok) return;
        const ops = [{ type: "del", col: "productos", id }];
        for (const l of S.store.all("lotes")) if (l.productoId === id) ops.push({ type: "del", col: "lotes", id: l.id });
        ops.push(logOp("del", `eliminó ${p.nombre}`));
        await commit(ops);
        closeSheet(2);
        toast("Producto eliminado");
      });
      el.querySelector("[data-save]").onclick = async () => {
        const nombre = f.nombre.value.trim();
        if (!nombre) { f.nombre.focus(); f.nombre.closest(".field").classList.add("err"); toast("Escribe el nombre del producto", { type: "error" }); return; }
        const data = {
          nombre, tipo, foto,
          precio: num(f.precio.value), costo: num(f.costo.value),
          codigo: f.codigo.value.trim(), presentacion: f.presentacion.value.trim(),
          categoria: f.categoria.value.trim(), stockMin: num(f.stockMin.value),
          ubicacion: f.ubicacion.value.trim(), proveedor: f.proveedor.value.trim(),
          descripcion: f.descripcion.value.trim(), notas: f.notas.value.trim(),
          ...stamp(),
        };
        const ops = [];
        let pid = id;
        if (isNew) {
          pid = U.uid();
          ops.push({ type: "set", col: "productos", id: pid, data: { ...data, creado: Date.now() } });
          const cant = num(f.cantidad.value);
          let txt = `creó ${nombre}`;
          if (cant > 0) {
            ops.push({ type: "set", col: "lotes", id: U.uid(), data: { productoId: pid, cantidad: cant, vence: f.vence.value || "", lote: f.lote.value.trim(), nota: "", creado: Date.now(), ...stamp() } });
            txt += ` con ${qty(cant)} u.`;
          }
          ops.push(logOp("new", txt, { pid }));
        } else {
          ops.push({ type: "update", col: "productos", id, data });
          const changed = [];
          if (num(p.precio) !== data.precio) changed.push(`precio ${money(p.precio)} → ${money(data.precio)}`);
          ops.push(logOp("edit", `editó ${nombre}${changed.length ? " (" + changed.join(", ") + ")" : ""}`, { pid }));
        }
        if (await commit(ops)) {
          closeSheet();
          toast(isNew ? "Producto guardado" : "Cambios guardados");
          if (isNew) setTimeout(() => openProduct(pid), 280);
        }
      };
    },
  });
}

// ───────────────────────── Hoja: Lote ─────────────────────────
function openLoteForm(pid, loteId = null) {
  const p = D.byId.get(pid);
  const l = loteId ? S.store.get("lotes", loteId) : null;
  openSheet({
    title: l ? "Editar lote" : "Agregar stock",
    cls: "form",
    body: `
    <p class="muted small">${esc(p.nombre)}</p>
    <form novalidate autocomplete="off">
      <label class="field"><span>Cantidad disponible *</span>
        <div class="stepper big">
          <button type="button" data-st="-1" aria-label="Menos">${ic("minus")}</button>
          <input name="cantidad" inputmode="decimal" value="${l ? esc(U.fieldNum(l.cantidad)) : ""}" placeholder="0">
          <button type="button" data-st="1" aria-label="Más">${ic("plus")}</button>
        </div>
      </label>
      <div class="grid2">
        <label class="field"><span>Fecha de vencimiento</span><input name="vence" type="date" value="${esc(l?.vence || "")}"></label>
        <label class="field"><span>N.º de lote</span><input name="lote" value="${esc(l?.lote || "")}" placeholder="Opcional"></label>
      </div>
      <label class="field"><span>Nota</span><input name="nota" value="${esc(l?.nota || "")}" placeholder="Ej.: compra del proveedor X"></label>
      ${l ? `<button type="button" class="btn ghost block danger-t" data-del>${ic("trash")} Eliminar lote</button>` : `<p class="hint">Cada compra con distinta fecha de vencimiento es un lote. Al vender, se descuenta primero el que vence antes.</p>`}
    </form>`,
    footer: `<button class="btn primary block lg" data-save>${ic("check")} ${l ? "Guardar lote" : "Agregar stock"}</button>`,
    mount(el) {
      const f = el.querySelector("form");
      el.querySelectorAll("[data-st]").forEach((b) => (b.onclick = () => {
        f.cantidad.value = String(Math.max(0, num(f.cantidad.value) + +b.dataset.st)).replace(".", ",");
      }));
      if (!l) setTimeout(() => f.cantidad.focus(), 280);
      el.querySelector("[data-del]")?.addEventListener("click", async () => {
        if (!(await confirmBox({ title: "Eliminar lote", text: `Se quitarán ${qty(l.cantidad)} unidades del stock.`, ok: "Eliminar", danger: true }))) return;
        await commit([{ type: "del", col: "lotes", id: l.id }, logOp("lote", `eliminó un lote de ${p.nombre} (${qty(l.cantidad)} u.)`, { pid })]);
        closeSheet();
      });
      el.querySelector("[data-save]").onclick = async () => {
        const cantidad = num(f.cantidad.value);
        if (cantidad <= 0 && !l) { f.cantidad.focus(); toast("Escribe la cantidad", { type: "error" }); return; }
        const data = { cantidad, vence: f.vence.value || "", lote: f.lote.value.trim(), nota: f.nota.value.trim(), ...stamp() };
        const ops = [];
        if (l) {
          ops.push({ type: "update", col: "lotes", id: l.id, data });
          ops.push(logOp("lote", num(l.cantidad) !== cantidad ? `ajustó ${p.nombre}: ${qty(l.cantidad)} → ${qty(cantidad)} u.` : `editó un lote de ${p.nombre}`, { pid }));
        } else {
          ops.push({ type: "set", col: "lotes", id: U.uid(), data: { ...data, productoId: pid, creado: Date.now() } });
          ops.push(logOp("lote", `agregó ${qty(cantidad)} u. a ${p.nombre}${data.vence ? " (vence " + U.fmtDay(data.vence) + ")" : ""}`, { pid }));
        }
        if (await commit(ops)) { closeSheet(); toast(l ? "Lote actualizado" : `+${qty(cantidad)} u. agregadas`); }
      };
    },
  });
}

// ───────────────────────── Hoja: Venta (carrito) ─────────────────────────
function addToCart(pid, n = 1) {
  const p = D.byId.get(pid);
  if (!p) return;
  const cur = cart.items.get(pid);
  if (cur) cur.qty += n;
  else cart.items.set(pid, { qty: n, price: num(p.precio) });
  paintCartBadge();
}

function openCart() {
  let resultsOpen = false;
  openSheet({
    title: "Registrar venta",
    cls: "tall cart",
    headExtra: `<button class="link sm" data-empty>Vaciar</button>`,
    body: `
      <div class="search in-sheet">
        ${ic("search")}
        <input data-cq type="search" placeholder="Buscar o escanear producto" autocomplete="off" enterkeyhint="search">
        <button class="icon-btn sm accent" data-cscan aria-label="Escanear">${ic("scan")}</button>
      </div>
      <div class="results" data-results hidden></div>
      <div data-items></div>
      <div class="cart-extra" data-extra>
        <div class="field"><span>Forma de pago</span>
          <div class="seg full" data-met>${METODOS.map((m) => `<button type="button" data-v="${m.id}" class="${cart.metodo === m.id ? "on" : ""}">${ic(m.icon)} ${m.id}</button>`).join("")}</div>
        </div>
        <div class="grid2" data-cashrow>
          <label class="field"><span>Paga con</span><div class="affix"><em>Bs.</em><input data-paga inputmode="decimal" placeholder="0,00" value="${esc(cart.paga)}"></div></label>
          <div class="field"><span>Cambio</span><div class="change" data-change>—</div></div>
        </div>
        <label class="field"><span>Nota <i>(opcional)</i></span><input data-nota value="${esc(cart.nota)}" placeholder="Cliente, receta, etc."></label>
        <div class="field"><span>Fecha y hora</span>
          <div class="row gap-s"><button type="button" class="chip ${cart.fecha ? "" : "on"}" data-now>Ahora</button><input type="datetime-local" data-fecha value="${cart.fecha ? U.toLocalInput(cart.fecha) : ""}" class="${cart.fecha ? "" : "dim"}"></div>
        </div>
      </div>`,
    footer: `<div class="cart-foot"><div class="cart-total"><small data-tsub></small><b data-total></b></div><button class="btn primary lg" data-pay>${ic("check")} Cobrar</button></div>`,
    refresh(el) { paintItems(el); },
    mount(el) {
      const q = el.querySelector("[data-cq]");
      const res = el.querySelector("[data-results]");
      const showResults = () => {
        const v = q.value.trim();
        resultsOpen = !!v;
        res.hidden = !v;
        if (!v) return;
        const list = D.prods.filter((p) => U.matches(D.info.get(p.id).hay, v)).sort((a, b) => (a.codigo === v ? -1 : b.codigo === v ? 1 : (a.nombre || "").localeCompare(b.nombre || "", "es"))).slice(0, 25);
        res.innerHTML = list.length ? list.map((p) => {
          const i = D.info.get(p.id);
          return `<button class="res" data-add="${p.id}" ${i.vendible > 0 ? "" : "disabled"}>${thumb(p, "sm")}<span class="mini-txt"><b>${esc(p.nombre)}</b><small>${esc(p.presentacion || "")} · ${i.vendible > 0 ? qty(i.vendible) + " disp." : i.stock > 0 ? "solo vencido" : "agotado"}</small></span><b>${money(p.precio)}</b></button>`;
        }).join("") : `<p class="muted small pad">Sin resultados para “${esc(v)}”.</p>`;
      };
      q.addEventListener("input", U.debounce(showResults, 100));
      q.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        const first = res.querySelector("[data-add]:not([disabled])");
        if (first) first.click();
      });
      res.addEventListener("click", (e) => {
        const b = e.target.closest("[data-add]");
        if (!b) return;
        addToCart(b.dataset.add);
        q.value = ""; res.hidden = true; resultsOpen = false;
        paintItems(el);
        navigator.vibrate?.(15);
      });
      el.querySelector("[data-cscan]").onclick = async () => {
        const code = await scanBarcode();
        if (!code) return;
        const p = D.prods.find((x) => x.codigo === code);
        if (!p) { q.value = code; showResults(); toast("No hay producto con ese código", { type: "error" }); return; }
        if (D.info.get(p.id).vendible <= 0) { toast(`${p.nombre} no tiene stock disponible`, { type: "error" }); return; }
        addToCart(p.id); paintItems(el); toast(`+1 ${p.nombre}`);
      };
      el.querySelector("[data-empty]").onclick = () => { cart.items.clear(); paintItems(el); paintCartBadge(); };
      el.querySelectorAll("[data-met] [data-v]").forEach((b) => (b.onclick = () => {
        cart.metodo = b.dataset.v;
        el.querySelectorAll("[data-met] [data-v]").forEach((x) => x.classList.toggle("on", x === b));
        paintTotals(el);
      }));
      el.querySelector("[data-paga]").oninput = (e) => { cart.paga = e.target.value; paintTotals(el); };
      el.querySelector("[data-nota]").oninput = (e) => { cart.nota = e.target.value; };
      const fecha = el.querySelector("[data-fecha]"), now = el.querySelector("[data-now]");
      now.onclick = () => { cart.fecha = null; fecha.value = ""; fecha.classList.add("dim"); now.classList.add("on"); };
      fecha.onchange = () => {
        const t = fecha.value ? new Date(fecha.value).getTime() : null;
        cart.fecha = t; fecha.classList.toggle("dim", !t); now.classList.toggle("on", !t);
      };
      const items = el.querySelector("[data-items]");
      items.addEventListener("click", (e) => {
        const b = e.target.closest("[data-step],[data-rmitem]");
        if (!b) return;
        const id = b.closest("[data-item]").dataset.item;
        const it = cart.items.get(id);
        if (b.dataset.rmitem !== undefined) { cart.items.delete(id); paintCartBadge(); return paintItems(el); }
        it.qty = Math.max(1, it.qty + +b.dataset.step);
        b.closest("[data-item]").querySelector("[data-qty]").value = U.fieldNum(it.qty) || "1";
        paintRow(el, id); paintTotals(el);
      });
      items.addEventListener("input", (e) => {
        const row = e.target.closest("[data-item]");
        if (!row) return;
        const it = cart.items.get(row.dataset.item);
        if (e.target.matches("[data-qty]")) it.qty = num(e.target.value);
        if (e.target.matches("[data-price]")) it.price = num(e.target.value);
        paintRow(el, row.dataset.item); paintTotals(el);
      });
      el.querySelector("[data-pay]").onclick = () => checkout(el);
      paintItems(el);
      if (!cart.items.size) setTimeout(() => q.focus(), 300);
    },
  });
}

function paintItems(el) {
  const box = el.querySelector("[data-items]");
  for (const id of [...cart.items.keys()]) if (!D.byId.has(id)) cart.items.delete(id);
  if (!cart.items.size) {
    box.innerHTML = `<div class="empty-state small">${ic("cart")}<p>Busca o escanea productos para agregarlos a la venta.</p></div>`;
  } else {
    box.innerHTML = `<div class="cart-items">${[...cart.items.entries()].map(([id, it]) => {
      const p = D.byId.get(id);
      return `<div class="citem" data-item="${id}">
        ${thumb(p, "sm")}
        <div class="citem-main">
          <div class="row"><b class="grow">${esc(p.nombre)}</b><button class="icon-btn xs" data-rmitem aria-label="Quitar">${ic("x")}</button></div>
          <div class="citem-ctrl">
            <div class="stepper">
              <button type="button" data-step="-1" aria-label="Menos">${ic("minus")}</button>
              <input data-qty inputmode="decimal" value="${esc(U.fieldNum(it.qty) || "")}" aria-label="Cantidad">
              <button type="button" data-step="1" aria-label="Más">${ic("plus")}</button>
            </div>
            <div class="affix price-in"><em>Bs.</em><input data-price inputmode="decimal" value="${esc(U.fieldNum(it.price))}" placeholder="0,00" aria-label="Precio"></div>
          </div>
          <small class="citem-sub" data-sub></small>
        </div>
      </div>`;
    }).join("")}</div>`;
    for (const id of cart.items.keys()) paintRow(el, id);
  }
  el.querySelector("[data-extra]").hidden = !cart.items.size;
  el.querySelector("[data-empty]").hidden = !cart.items.size;
  paintTotals(el);
}
function paintRow(el, id) {
  const it = cart.items.get(id);
  const i = D.info.get(id);
  const row = el.querySelector(`[data-item="${id}"]`);
  if (!row || !i) return;
  const over = it.qty > i.vendible;
  const sub = row.querySelector("[data-sub]");
  sub.innerHTML = over
    ? `<span class="red">Solo hay ${qty(i.vendible)} disponible${i.vendible === 1 ? "" : "s"}</span>`
    : `${qty(i.vendible)} disp. · Subtotal <b>${money(it.qty * it.price)}</b>${!it.price ? ' · <span class="amber">sin precio</span>' : ""}`;
  row.classList.toggle("over", over);
}
function cartTotal() {
  let t = 0, u = 0;
  for (const it of cart.items.values()) { t += it.qty * it.price; u += it.qty; }
  return { t: Math.round(t * 100) / 100, u };
}
function paintTotals(el) {
  const { t, u } = cartTotal();
  el.querySelector("[data-total]").textContent = money(t);
  el.querySelector("[data-tsub]").textContent = cart.items.size ? `Total · ${qty(u)} u.` : "Total";
  el.querySelector("[data-pay]").disabled = !cart.items.size;
  const cash = cart.metodo === "Efectivo";
  el.querySelector("[data-cashrow]").hidden = !cash;
  const paga = num(cart.paga);
  const ch = el.querySelector("[data-change]");
  ch.textContent = cash && paga ? money(paga - t) : "—";
  ch.classList.toggle("red", cash && paga > 0 && paga < t);
}

async function checkout(el) {
  const items = [];
  const ops = [];
  for (const [pid, it] of cart.items) {
    const p = D.byId.get(pid);
    const i = D.info.get(pid);
    if (!(it.qty > 0)) return toast(`Revisa la cantidad de ${p.nombre}`, { type: "error" });
    if (it.qty > i.vendible + 1e-9) return toast(`No hay suficiente ${p.nombre} (disponible ${qty(i.vendible)})`, { type: "error" });
    // Descuenta primero del lote que vence antes (sin usar lotes vencidos).
    let left = it.qty;
    const alloc = [];
    for (const l of i.lotes) {
      if (left <= 0) break;
      if (l.vence && U.daysUntil(l.vence) < 0) continue;
      const take = Math.min(left, num(l.cantidad));
      if (take <= 0) continue;
      alloc.push({ loteId: l.id, cantidad: take, vence: l.vence || "", lote: l.lote || "" });
      ops.push({ type: "inc", col: "lotes", id: l.id, field: "cantidad", by: -take });
      left -= take;
    }
    items.push({ productoId: pid, nombre: p.nombre, cantidad: it.qty, precio: it.price, costo: num(p.costo), lotes: alloc });
  }
  const noPrice = items.filter((x) => !x.precio);
  if (noPrice.length && !(await confirmBox({ title: "Productos sin precio", text: `${noPrice.map((x) => x.nombre).join(", ")} ${noPrice.length > 1 ? "van" : "va"} a Bs. 0,00. ¿Continuar?`, ok: "Sí, continuar" }))) return;
  const { t, u } = cartTotal();
  const vid = U.uid();
  const venta = { t: cart.fecha || Date.now(), items, total: t, unidades: u, metodo: cart.metodo, nota: cart.nota.trim(), por: S.user.name || "", uid: S.user.uid || "", anulada: false };
  if (cart.metodo === "Efectivo" && num(cart.paga)) venta.paga = num(cart.paga);
  ops.push({ type: "set", col: "ventas", id: vid, data: venta });
  const desc = items.length === 1 ? `${qty(items[0].cantidad)}× ${items[0].nombre}` : `${items.length} productos`;
  ops.push(logOp("sale", `vendió ${desc} · ${money(t)}`, { vid }));
  el.querySelector("[data-pay]").disabled = true;
  if (!(await commit(ops))) { el.querySelector("[data-pay]").disabled = false; return; }
  cart.items.clear(); cart.paga = ""; cart.nota = ""; cart.fecha = null;
  paintCartBadge();
  navigator.vibrate?.([20, 40, 20]);
  closeSheet();
  toast(`Venta registrada · ${money(t)}`, { action: "Ver", onAction: () => openSale(vid) });
}

// ───────────────────────── Hoja: Detalle de venta ─────────────────────────
function openSale(id) {
  const body = () => {
    const v = S.store.get("ventas", id);
    if (!v) return `<p class="muted">Esta venta ya no existe.</p>`;
    const gan = (v.items || []).reduce((a, it) => a + (num(it.costo) ? (num(it.precio) - num(it.costo)) * num(it.cantidad) : 0), 0);
    return `
    ${v.anulada ? `<p class="notice danger">${ic("undo")} Venta anulada${v.anuladaPor ? " por " + esc(v.anuladaPor) : ""}${v.anuladaT ? " · " + U.fmtDateTime(v.anuladaT) : ""}. El stock fue devuelto.</p>` : ""}
    <div class="sale-hero ${v.anulada ? "void" : ""}"><small class="muted">${U.dayLabel(v.t)} · ${U.fmtTime(v.t)}</small><div class="big-num">${money(v.total)}</div>
      <p class="muted small">${esc(v.metodo || "Efectivo")}${v.paga ? ` · pagó ${money(v.paga)} · cambio ${money(v.paga - v.total)}` : ""}${v.por ? " · " + esc(v.por) : ""}</p></div>
    <div class="card flush">${(v.items || []).map((it) => `
      <button class="sale" ${D.byId.has(it.productoId) ? `data-open="${it.productoId}"` : ""}>
        ${thumb(D.byId.get(it.productoId) || { tipo: "" }, "sm")}
        <span class="sale-main"><b>${esc(it.nombre)}</b><small>${qty(it.cantidad)} × ${money(it.precio)}${(it.lotes || []).filter((l) => l.lote || l.vence).length ? " · " + it.lotes.map((l) => l.lote ? "lote " + esc(l.lote) : U.fmtDay(l.vence)).join(", ") : ""}</small></span>
        <b class="sale-total">${money(num(it.cantidad) * num(it.precio))}</b>
      </button>`).join("")}</div>
    ${gan ? `<p class="muted small mt">Ganancia estimada <b class="green-t">${money(gan)}</b></p>` : ""}
    ${v.nota ? `<p class="mt"><small class="muted">Nota</small><br>${esc(v.nota)}</p>` : ""}
    ${!v.anulada ? `<button class="btn ghost block danger-t mt" data-anular>${ic("undo")} Anular venta</button>` : ""}`;
  };
  openSheet({
    title: "Detalle de venta",
    body: body(),
    refresh(el) { el.querySelector(".sheet-body").innerHTML = body(); },
    mount(el) {
      el.querySelector(".sheet-body").addEventListener("click", async (e) => {
        if (!e.target.closest("[data-anular]")) return;
        const v = S.store.get("ventas", id);
        if (!(await confirmBox({ title: "Anular venta", text: `Se devolverán las unidades al stock y la venta de ${money(v.total)} no contará en los totales.`, ok: "Anular", danger: true }))) return;
        const ops = [];
        for (const it of v.items || []) {
          for (const a of it.lotes || []) {
            if (S.store.get("lotes", a.loteId)) ops.push({ type: "inc", col: "lotes", id: a.loteId, field: "cantidad", by: num(a.cantidad) });
            else if (D.byId.has(it.productoId)) ops.push({ type: "set", col: "lotes", id: a.loteId, data: { productoId: it.productoId, cantidad: num(a.cantidad), vence: a.vence || "", lote: a.lote || "", nota: "Devuelto por venta anulada", creado: Date.now(), ...stamp() } });
          }
        }
        ops.push({ type: "update", col: "ventas", id, data: { anulada: true, anuladaPor: S.user.name || "", anuladaT: Date.now() } });
        ops.push(logOp("void", `anuló una venta de ${money(v.total)}`, { vid: id }));
        if (await commit(ops)) toast("Venta anulada · stock devuelto");
      });
    },
  });
}

// ───────────────────────── Hoja: Historial ─────────────────────────
function openActivity() {
  const body = () => {
    const list = S.store.all("actividad").sort((a, b) => b.t - a.t);
    if (!list.length) return `<div class="empty-state small">${ic("activity")}<p>Aún no hay movimientos.</p></div>`;
    let last = "";
    return list.map((a) => {
      const k = U.isoDay(new Date(a.t));
      const h = k !== last ? `<div class="day-head"><span>${U.dayLabel(a.t)}</span></div>` : "";
      last = k;
      return h + `<div class="act"><span class="act-dot k-${esc(a.tipo || "")}"></span><p><b>${esc(a.por || "Alguien")}</b> ${esc(a.texto)}<small>${U.fmtTime(a.t)}</small></p></div>`;
    }).join("");
  };
  openSheet({ title: "Historial de cambios", cls: "tall", body: `<div class="act-list">${body()}</div>`, refresh(el) { el.querySelector(".act-list").innerHTML = body(); } });
}

// ───────────────────────── Respaldo ─────────────────────────
function exportBackup() {
  const data = {
    app: "inventario-farmacia-tienda", version: 1, exportado: new Date().toISOString(),
    negocio: { nombre: S.negocio.nombre, diasAviso: S.negocio.diasAviso },
    productos: S.store.all("productos"), lotes: S.store.all("lotes"), ventas: S.store.all("ventas"),
  };
  U.download(`inventario-respaldo-${U.today()}.json`, JSON.stringify(data));
  toast("Respaldo descargado");
}
async function importBackup(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { return toast("El archivo no es un respaldo válido", { type: "error" }); }
  if (!Array.isArray(data.productos)) return toast("El archivo no es un respaldo de esta app", { type: "error" });
  const n = data.productos.length, l = (data.lotes || []).length, v = (data.ventas || []).length;
  if (!(await confirmBox({ title: "Restaurar respaldo", text: `Se agregarán o actualizarán ${n} productos, ${l} lotes y ${v} ventas. Los datos que no estén en el archivo se conservan.`, ok: "Restaurar" }))) return;
  const ops = [];
  for (const col of ["productos", "lotes", "ventas"])
    for (const d of data[col] || []) if (d && d.id) { const { id, ...rest } = d; ops.push({ type: "set", col, id: String(id), data: rest }); }
  ops.push(logOp("edit", `restauró un respaldo (${n} productos)`));
  if (await commit(ops)) toast("Respaldo restaurado");
}
function exportCsv() {
  const rows = [["Fecha", "Hora", "Producto", "Cantidad", "Precio unitario", "Subtotal", "Costo unitario", "Forma de pago", "Vendedor", "Estado", "Nota"]];
  const ventas = S.store.all("ventas").sort((a, b) => a.t - b.t);
  for (const v of ventas) for (const it of v.items || [])
    rows.push([U.isoDay(new Date(v.t)), U.fmtTime(v.t), it.nombre, String(it.cantidad).replace(".", ","), String(it.precio).replace(".", ","), String(Math.round(num(it.cantidad) * num(it.precio) * 100) / 100).replace(".", ","), String(it.costo || "").replace(".", ","), v.metodo || "", v.por || "", v.anulada ? "Anulada" : "Válida", v.nota || ""]);
  const csv = "﻿" + rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n");
  U.download(`ventas-${U.today()}.csv`, csv, "text/csv;charset=utf-8");
  toast("Ventas exportadas");
}
