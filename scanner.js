// Escáner de códigos de barras con la cámara (BarcodeDetector del navegador).
// En teléfonos sin soporte se ofrece escribir el código a mano.

import { ic } from "./icons.js";
import { pushLayer, popLayers } from "./layers.js";

const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "code_93", "itf", "codabar", "qr_code", "data_matrix"];

export const canScan = () => "BarcodeDetector" in window && !!navigator.mediaDevices?.getUserMedia;

export function scanBarcode() {
  return new Promise((resolve) => {
    const el = document.createElement("div");
    el.className = "scanner";
    el.innerHTML = `
      <video playsinline muted autoplay></video>
      <div class="scan-frame"><span></span></div>
      <div class="scan-top">
        <button class="icon-btn glass" data-close aria-label="Cerrar">${ic("x")}</button>
        <span class="scan-title">Apunta al código de barras</span>
        <button class="icon-btn glass" data-torch aria-label="Linterna" hidden>${ic("flash")}</button>
      </div>
      <form class="scan-manual">
        <input name="code" inputmode="numeric" autocomplete="off" placeholder="O escribe el código" enterkeyhint="done">
        <button class="btn primary sm">Usar</button>
      </form>
      <p class="scan-msg" hidden></p>`;
    document.body.append(el);
    requestAnimationFrame(() => el.classList.add("open"));

    const video = el.querySelector("video");
    let stream = null, timer = null, done = false;

    const finish = (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
      el.classList.remove("open");
      setTimeout(() => el.remove(), 200);
      if (code) popLayers(1);
      resolve(code || null);
    };
    pushLayer(() => finish(null));

    el.querySelector("[data-close]").onclick = () => popLayers(1);
    el.querySelector(".scan-manual").onsubmit = (e) => {
      e.preventDefault();
      const v = e.target.code.value.trim();
      if (v) finish(v);
    };
    const msg = (t) => { const p = el.querySelector(".scan-msg"); p.textContent = t; p.hidden = false; };

    if (!canScan()) {
      msg("Este navegador no puede leer códigos con la cámara. Escríbelo abajo.");
      el.classList.add("no-cam");
      setTimeout(() => el.querySelector("input").focus(), 250);
      return;
    }

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (done) { stream.getTracks().forEach((t) => t.stop()); return; }
        video.srcObject = stream;
        await video.play().catch(() => {});
        const track = stream.getVideoTracks()[0];
        const caps = track.getCapabilities?.() || {};
        if (caps.torch) {
          const b = el.querySelector("[data-torch]");
          let on = false;
          b.hidden = false;
          b.onclick = () => { on = !on; track.applyConstraints({ advanced: [{ torch: on }] }).catch(() => {}); b.classList.toggle("on", on); };
        }
        let formats = FORMATS;
        try { const sup = await BarcodeDetector.getSupportedFormats(); formats = FORMATS.filter((f) => sup.includes(f)); } catch {}
        const det = new BarcodeDetector({ formats });
        const loop = async () => {
          if (done) return;
          try {
            if (video.readyState >= 2) {
              const r = await det.detect(video);
              if (r.length && r[0].rawValue) {
                navigator.vibrate?.(60);
                return finish(r[0].rawValue.trim());
              }
            }
          } catch {}
          timer = setTimeout(loop, 160);
        };
        loop();
      } catch (e) {
        msg("No se pudo abrir la cámara. Revisa el permiso o escribe el código.");
        el.classList.add("no-cam");
      }
    })();
  });
}
