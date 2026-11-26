// Capas (hojas, escáner) conectadas al botón "atrás" del teléfono.
const stack = [];

export function pushLayer(onClose) {
  stack.push(onClose);
  history.pushState({ layer: stack.length }, "");
}
/** Cierra las n capas superiores (vía historial, para que "atrás" quede coherente). */
export function popLayers(n = 1) {
  n = Math.min(n, stack.length);
  if (n > 0) history.go(-n);
}
export const layerCount = () => stack.length;

window.addEventListener("popstate", (e) => {
  const depth = e.state?.layer || 0;
  while (stack.length > depth) stack.pop()();
});
