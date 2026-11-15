/* Original little mission emblems: one stroke weight and a friendly silhouette.
   Decorative SVGs stay out of the accessibility tree; controls keep text labels. */
const Icons = (() => {
  const paths = {
    help: '<circle cx="16" cy="16" r="13"/><path class="icon-ink" d="M11 11a5 5 0 0 1 10 0c0 4-5 4-5 8m0 5v.1"/>',
    keyboard: '<rect x="2" y="7" width="28" height="19" rx="4"/><path class="icon-ink" d="M7 12h.1m6 0h.1m6 0h.1m6 0h.1M7 17h.1m6 0h.1m6 0h.1m6 0h.1M9 22h14"/>',
    search: '<circle cx="13" cy="13" r="9"/><path class="icon-ink" d="m20 20 9 9"/>',
    ghost: '<path d="M6 27V15a10 10 0 0 1 20 0v16l-5-3-5 3-5-3-5 3z"/><path class="icon-ink" d="M12 14v3m8-3v3m-7 5q3 3 6 0"/>',
    star: '<path d="m16 3 4 8 9 1-6.5 6.5L24 28l-8-4.5L8 28l1.5-9.5L3 12l9-1z"/>',
    clock: '<circle cx="16" cy="18" r="12"/><path class="icon-ink" d="M16 11v8l5 3M12 2h8m-4 0v4m9 1 2-2"/>',
    pause: '<rect x="7" y="5" width="6" height="22" rx="2"/><rect x="19" y="5" width="6" height="22" rx="2"/>',
    center: '<circle cx="16" cy="16" r="8"/><path class="icon-ink" d="M16 2v7m0 14v7M2 16h7m14 0h7"/>',
    back: '<path d="m14 6-10 10 10 10V20h14v-8H14z"/>',
    play: '<path d="M9 5v22l19-11z"/>',
    book: '<path d="M5 5h18a4 4 0 0 1 4 4v19H8a4 4 0 0 1-4-4V8a3 3 0 0 1 3-3z"/><path class="icon-ink" d="M10 5v18M5 23h22"/><path class="icon-cutout" d="m19 10 1.5 3 3.5.5-2.5 2.5.5 3.5-3-1.5-3 1.5.5-3.5-2.5-2.5 3.5-.5z"/>',
    sound: '<path d="M3 12h6l8-7v22l-8-7H3z"/><path class="icon-ink" d="M22 11q5 5 0 10m4-14q9 9 0 18"/>',
    soundOff: '<path d="M3 12h6l8-7v22l-8-7H3z"/><path class="icon-ink" d="m23 12 7 8m0-8-7 8"/>',
    controller: '<path d="M10 8h12q5 0 7 8l1 8q0 5-4 3l-5-5H11l-5 5q-4 2-4-3l1-8q2-8 7-8z"/><path class="icon-ink" d="M10 12v8m-4-4h8m9-3v.1m3 3v.1m-6 0v.1m3 3v.1"/>',
    moon: '<circle cx="16" cy="16" r="13"/><circle class="icon-cutout" cx="11" cy="11" r="4"/><circle class="icon-cutout" cx="22" cy="19" r="3"/><circle class="icon-cutout" cx="12" cy="23" r="2"/>',
    mars: '<circle cx="16" cy="16" r="13"/><path class="icon-cutout" d="M6 12q8-7 13 1t9 4M8 23q4-4 10-1"/><path class="icon-ink" d="M10 5q6 4 12 0"/>',
    spark: '<path d="m16 2 3.5 10.5L30 16l-10.5 3.5L16 30l-3.5-10.5L2 16l10.5-3.5z"/>',
    tool: '<path d="M25 3a9 9 0 0 0-11 11L4 24a3 3 0 0 0 4 4l10-10A9 9 0 0 0 29 7l-6 6-4-4z"/>',
    check: '<path d="m5 17 7 7L28 7" fill="none" stroke-width="5"/>',
    lock: '<rect x="6" y="14" width="20" height="15" rx="4"/><path class="icon-ink" d="M10 14V9a6 6 0 0 1 12 0v5m-6 6v3"/>',
    home: '<path d="M3 15 16 3l13 12-4 1v13H7V16z"/><path class="icon-cutout" d="M13 29V19h6v10"/>',
    rocket: '<path d="M12 22 9 12Q17 2 29 3q1 12-9 20z"/><circle class="icon-cutout" cx="22" cy="10" r="3"/><path class="icon-ink" d="m10 12-6 3-2 7 10-1m8 1-3 7-7 2 1-9M7 26l-4 4"/>',
    report: '<rect x="6" y="5" width="22" height="25" rx="3"/><rect class="icon-cutout" x="11" y="2" width="12" height="7" rx="2"/><path class="icon-ink" d="m11 17 2 2 3-4m3 2h5m-13 7h13"/>',
    pin: '<path d="M16 30S5 19 5 13a11 11 0 0 1 22 0c0 6-11 17-11 17z"/><circle class="icon-cutout" cx="16" cy="13" r="4"/>',
    stop: '<rect x="6" y="6" width="20" height="20" rx="3"/>'
  };
  function svg(name) {
    return '<svg class="game-icon icon-' + name + '" viewBox="0 0 32 32" aria-hidden="true" focusable="false" fill="currentColor" stroke="#141a3c" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">' + (paths[name] || paths.spark) + '</svg>';
  }
  function label(el, name, text) {
    if (!el) return;
    el.innerHTML = svg(name);
    if (text) { const span = document.createElement("span"); span.className = "icon-label"; span.textContent = text; el.appendChild(span); }
    el.dataset.icon = name;
  }
  function mount(root = document) {
    root.querySelectorAll("[data-icon]").forEach(el => label(el, el.dataset.icon, el.dataset.iconLabel || ""));
  }
  mount();
  return { svg, label, mount, names: Object.keys(paths) };
})();
if (typeof module !== "undefined") module.exports = Icons;
