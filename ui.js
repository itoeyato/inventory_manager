// Hojas inferiores, avisos y confirmaciones.
import { ic } from "./icons.js";
import { esc } from "./utils.js";
import { pushLayer, popLayers } from "./layers.js";

const root = () => document.getElementById("sheets");
const open = [];

/**
 * openSheet({ title, body, footer, cls, mount(el), refresh(el), onClose })
 * Devuelve el elemento de la hoja.
 */
export function openSheet(o) {
  const el = document.createElement("div");
  el.className = "sheet-wrap " + (o.cls || "");
  el.innerHTML = `
    <div class="backdrop"></div>
    <section class="sheet" role="dialog" aria-modal="true" aria-label="${esc(o.title || "")}">
      <header class="sheet-head">
        <span class="grip"></span>
        <h2>${esc(o.title || "")}</h2>
        ${o.headExtra || ""}
        <button class="icon-btn" data-x aria-label="Cerrar">${ic("x")}</button>
      </header>
      <div class="sheet-body"></div>
      ${o.footer !== undefined ? `<footer class="sheet-foot"></footer>` : ""}
    </section>`;
  const body = el.querySelector(".sheet-body");
  body.innerHTML = o.body || "";
  if (o.footer !== undefined) el.querySelector(".sheet-foot").innerHTML = o.footer;
  root().append(el);
  const entry = { el, o };
  open.push(entry);
  document.documentElement.classList.add("locked");
  pushLayer(() => dismiss(entry));
  el.querySelector(".backdrop").onclick = () => closeSheet();
  el.querySelector("[data-x]").onclick = () => closeSheet();
  enableDrag(el);
  o.mount?.(el);
  el.getBoundingClientRect();
  requestAnimationFrame(() => el.classList.add("open"));
  return el;
}

function dismiss(entry) {
  const i = open.indexOf(entry);
  if (i >= 0) open.splice(i, 1);
  if (entry.el.contains(document.activeElement)) document.activeElement.blur();
  entry.el.classList.remove("open");
  entry.el.classList.add("closing");
  setTimeout(() => entry.el.remove(), 230);
  entry.o.onClose?.();
  if (!open.length) document.documentElement.classList.remove("locked");
}

export const closeSheet = (n = 1) => popLayers(n);
export const sheetCount = () => open.length;
/** Vuelve a pintar las hojas abiertas que lo permiten (cuando cambian los datos). */
export function refreshSheets() {
  for (const { el, o } of open) o.refresh?.(el);
}

// Deslizar hacia abajo desde la cabecera para cerrar.
function enableDrag(el) {
  const sheet = el.querySelector(".sheet");
  const head = el.querySelector(".sheet-head");
  let y0 = null, dy = 0, t0 = 0;
  head.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button")) return;
    y0 = e.clientY; dy = 0; t0 = Date.now();
    head.setPointerCapture(e.pointerId);
    sheet.style.transition = "none";
  });
  head.addEventListener("pointermove", (e) => {
    if (y0 === null) return;
    dy = Math.max(0, e.clientY - y0);
    sheet.style.transform = `translateY(${dy}px)`;
  });
  const end = () => {
    if (y0 === null) return;
    y0 = null;
    sheet.style.transition = "";
    sheet.style.transform = "";
    const fast = dy > 40 && Date.now() - t0 < 250;
    if (dy > 110 || fast) closeSheet();
  };
  head.addEventListener("pointerup", end);
  head.addEventListener("pointercancel", end);
}

// ── Avisos ──
let toastTimer;
export function toast(msg, opts = {}) {
  const t = document.getElementById("toast");
  t.innerHTML = `<span>${esc(msg)}</span>${opts.action ? `<button>${esc(opts.action)}</button>` : ""}`;
  t.className = "toast show " + (opts.type || "");
  if (opts.action) t.querySelector("button").onclick = () => { t.classList.remove("show"); opts.onAction?.(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), opts.ms || 2600);
}

export function confirmBox({ title, text = "", ok = "Aceptar", danger = false, cancel = "Cancelar" }) {
  return new Promise((resolve) => {
    let result = false;
    openSheet({
      title,
      cls: "dialog",
      body: `<p class="dialog-text">${esc(text)}</p>`,
      footer: `<div class="row gap"><button class="btn ghost grow" data-no>${esc(cancel)}</button><button class="btn grow ${danger ? "danger" : "primary"}" data-ok>${esc(ok)}</button></div>`,
      mount(el) {
        el.querySelector("[data-no]").onclick = () => closeSheet();
        el.querySelector("[data-ok]").onclick = () => { result = true; closeSheet(); };
      },
      onClose: () => resolve(result),
    });
  });
}

/** Campo de texto en una hoja pequeña. */
export function promptBox({ title, label, value = "", placeholder = "", ok = "Guardar", inputmode = "text" }) {
  return new Promise((resolve) => {
    let result = null;
    openSheet({
      title,
      cls: "dialog",
      body: `<label class="field"><span>${esc(label)}</span><input data-v value="${esc(value)}" placeholder="${esc(placeholder)}" inputmode="${inputmode}" autocomplete="off"></label>`,
      footer: `<button class="btn primary block" data-ok>${esc(ok)}</button>`,
      mount(el) {
        const inp = el.querySelector("[data-v]");
        const go = () => { result = inp.value.trim(); closeSheet(); };
        el.querySelector("[data-ok]").onclick = go;
        inp.onkeydown = (e) => { if (e.key === "Enter") go(); };
        setTimeout(() => inp.focus(), 260);
      },
      onClose: () => resolve(result),
    });
  });
}
