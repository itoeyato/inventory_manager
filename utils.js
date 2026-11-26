// Utilidades: formato, fechas, texto.

const nf = new Intl.NumberFormat("es-BO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nfq = new Intl.NumberFormat("es-BO", { maximumFractionDigits: 2 });

export const money = (n) => "Bs. " + nf.format(+n || 0);
export const qty = (n) => nfq.format(+n || 0);

/** Convierte "12,50" o "12.50" o "1.234,5" en número. */
export function num(v) {
  if (typeof v === "number") return isFinite(v) ? v : 0;
  let s = String(v ?? "").trim().replace(/\s|Bs\.?/gi, "");
  if (!s) return 0;
  if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(",", ".");
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}
/** Número para mostrar dentro de un campo (con coma decimal). */
export const fieldNum = (n) => (n === "" || n == null || +n === 0 ? "" : String(+n).replace(".", ","));

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 6);

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

export const norm = (s) =>
  String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

/** Coincide si todas las palabras de la búsqueda están en el texto. */
export function matches(hay, q) {
  const words = norm(q).split(/\s+/).filter(Boolean);
  return words.every((w) => hay.includes(w));
}

// ── Fechas ──
const pad = (n) => String(n).padStart(2, "0");
export const isoDay = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => isoDay();
export function parseDay(s) {
  const [y, m, d] = String(s).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
export function daysUntil(s) {
  if (!s) return null;
  const a = parseDay(isoDay()), b = parseDay(s);
  return Math.round((b - a) / 86400000);
}
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MESES_L = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
export const DIAS_C = ["L", "M", "M", "J", "V", "S", "D"];
export const fmtDay = (s) => {
  if (!s) return "";
  const d = parseDay(s);
  return `${d.getDate()} ${MESES[d.getMonth()]} ${d.getFullYear()}`;
};
export const longDate = (d = new Date()) => {
  const s = `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES_L[d.getMonth()]} de ${d.getFullYear()}`;
  return s[0].toUpperCase() + s.slice(1);
};
export const fmtTime = (t) => {
  const d = new Date(t);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const fmtDateTime = (t) => {
  const d = new Date(t);
  return `${d.getDate()} ${MESES[d.getMonth()]} · ${fmtTime(t)}`;
};
export function dayLabel(t) {
  const d = new Date(t);
  const k = isoDay(d);
  const diff = -daysUntil(k);
  if (diff === 0) return "Hoy";
  if (diff === 1) return "Ayer";
  const s = `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES_L[d.getMonth()]}`;
  return s[0].toUpperCase() + s.slice(1);
}
export function ago(t) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return "ahora";
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  if (d < 7) return `hace ${d} d`;
  return fmtDateTime(t);
}
export function venceText(days) {
  if (days === null) return "";
  if (days < 0) return days === -1 ? "Venció ayer" : `Venció hace ${-days} d`;
  if (days === 0) return "Vence hoy";
  if (days === 1) return "Vence mañana";
  if (days < 60) return `Vence en ${days} d`;
  const m = Math.round(days / 30);
  return m < 24 ? `Vence en ${m} meses` : `Vence en ${Math.round(days / 365)} años`;
}
export const startOfDay = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
export const startOfWeek = (d = new Date()) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x.getTime();
};
export const startOfMonth = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), 1).getTime();
export const toLocalInput = (t) => {
  const d = new Date(t);
  return `${isoDay(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Buenos días" : h < 19 ? "Buenas tardes" : "Buenas noches";
};

/** Reduce una foto a JPEG pequeño (data URL) sin congelar la pantalla. */
export async function shrinkImage(file, max = 560, quality = 0.74) {
  let src;
  try {
    src = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    src = await new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = URL.createObjectURL(file);
    });
  }
  const w = src.width, h = src.height;
  const k = Math.min(1, max / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.round(w * k);
  c.height = Math.round(h * k);
  c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
  src.close?.();
  return c.toDataURL("image/jpeg", quality);
}

export function download(name, text, type = "application/json") {
  const blob = new Blob([text], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export const debounce = (fn, ms) => {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};
