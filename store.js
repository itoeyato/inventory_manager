// Capa de datos. Dos modos con la misma interfaz:
//   LocalStore → guarda en el teléfono (IndexedDB). Sin cuenta.
//   CloudStore → Firebase Firestore: varias personas comparten el inventario
//                en tiempo real y funciona sin internet (se sincroniza al volver).

import { FIREBASE_CONFIG } from "./config.js";

const FB = "https://www.gstatic.com/firebasejs/11.0.2/";
export const cloudEnabled = !!(FIREBASE_CONFIG && FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.projectId);
export const COLS = ["productos", "lotes", "ventas", "actividad"];

class Base {
  constructor() {
    this.data = Object.fromEntries(COLS.map((c) => [c, new Map()]));
    this.subs = new Set();
    this.status = "local"; // local | synced | pending | offline
  }
  on(fn) { this.subs.add(fn); return () => this.subs.delete(fn); }
  emit(cols) { for (const f of this.subs) f(cols); }
  all(col) { return [...this.data[col].values()]; }
  get(col, id) { return this.data[col].get(id); }
}

// ───────────────────────── Local ─────────────────────────
export class LocalStore extends Base {
  async init() {
    this.db = await new Promise((res, rej) => {
      const r = indexedDB.open("inventario-pwa", 1);
      r.onupgradeneeded = () => {
        for (const c of COLS) if (!r.result.objectStoreNames.contains(c)) r.result.createObjectStore(c, { keyPath: "id" });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const tx = this.db.transaction(COLS, "readonly");
    await Promise.all(
      COLS.map((c) => new Promise((res, rej) => {
        const q = tx.objectStore(c).getAll();
        q.onsuccess = () => { for (const d of q.result) this.data[c].set(d.id, d); res(); };
        q.onerror = () => rej(q.error);
      }))
    );
    navigator.storage?.persist?.().catch(() => {});
  }
  /** ops: [{type:'set'|'update'|'inc'|'del', col, id, data?, field?, by?}] */
  apply(ops) {
    const touched = new Set();
    const tx = this.db.transaction(COLS, "readwrite");
    for (const op of ops) {
      const m = this.data[op.col];
      const st = tx.objectStore(op.col);
      touched.add(op.col);
      if (op.type === "set") {
        const d = { ...op.data, id: op.id };
        m.set(op.id, d); st.put(d);
      } else if (op.type === "update" || op.type === "inc") {
        const cur = m.get(op.id);
        if (!cur) continue;
        const d = op.type === "update" ? { ...cur, ...op.data } : { ...cur, [op.field]: (+cur[op.field] || 0) + op.by };
        m.set(op.id, d); st.put(d);
      } else if (op.type === "del") {
        m.delete(op.id); st.delete(op.id);
      }
    }
    this.emit(touched);
    return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  }
}

// ───────────────────────── Firebase ─────────────────────────
let fbCache = null;
export async function loadFirebase() {
  if (fbCache) return fbCache;
  const [appM, A, F] = await Promise.all([
    import(FB + "firebase-app.js"),
    import(FB + "firebase-auth.js"),
    import(FB + "firebase-firestore.js"),
  ]);
  const app = appM.initializeApp(FIREBASE_CONFIG);
  const auth = A.getAuth(app);
  let db;
  try {
    db = F.initializeFirestore(app, {
      localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }),
    });
  } catch {
    db = F.getFirestore(app);
  }
  fbCache = { app, auth, db, A, F };
  return fbCache;
}

export class CloudStore extends Base {
  constructor(fb, negocioId) {
    super();
    this.fb = fb;
    this.nid = negocioId;
    this.unsubs = [];
    this.pending = {};
    this.fromCache = {};
    this.status = "synced";
  }
  ref(col, id) { return this.fb.F.doc(this.fb.db, "negocios", this.nid, col, id); }
  init() {
    const { F, db } = this.fb;
    // Ventas de los últimos ~13 meses; actividad: los 300 movimientos más recientes.
    const since = Date.now() - 400 * 86400000;
    return Promise.all(
      COLS.map((col) => new Promise((resolve, reject) => {
        let q = F.collection(db, "negocios", this.nid, col);
        if (col === "ventas") q = F.query(q, F.where("t", ">=", since));
        if (col === "actividad") q = F.query(q, F.orderBy("t", "desc"), F.limit(300));
        let first = true;
        const un = F.onSnapshot(
          q,
          { includeMetadataChanges: true },
          (snap) => {
            const m = this.data[col];
            const changes = snap.docChanges();
            for (const ch of changes) {
              if (ch.type === "removed") m.delete(ch.doc.id);
              else m.set(ch.doc.id, { ...ch.doc.data(), id: ch.doc.id });
            }
            this.pending[col] = snap.metadata.hasPendingWrites;
            this.fromCache[col] = snap.metadata.fromCache;
            this.updateStatus();
            if (changes.length || first) this.emit(new Set([col]));
            if (first) { first = false; resolve(); }
          },
          (err) => { if (first) reject(err); else console.error(err); }
        );
        this.unsubs.push(un);
      }))
    );
  }
  updateStatus() {
    const pend = Object.values(this.pending).some(Boolean);
    const s = !navigator.onLine ? "offline" : pend ? "pending" : "synced";
    if (s !== this.status) { this.status = s; this.emit(new Set(["_status"])); }
  }
  apply(ops) {
    const { F, db } = this.fb;
    // Firestore admite hasta 500 escrituras por lote.
    const chunks = [];
    for (let i = 0; i < ops.length; i += 450) chunks.push(ops.slice(i, i + 450));
    const commits = chunks.map((chunk) => {
      const b = F.writeBatch(db);
      for (const op of chunk) {
        const r = this.ref(op.col, op.id);
        if (op.type === "set") b.set(r, op.data);
        else if (op.type === "update") b.update(r, op.data);
        else if (op.type === "inc") b.update(r, { [op.field]: F.increment(op.by) });
        else if (op.type === "del") b.delete(r);
      }
      return b.commit();
    });
    // No esperamos al servidor: los cambios se ven al instante y se suben solos.
    return Promise.all(commits);
  }
  stop() { this.unsubs.forEach((u) => u()); }
}
