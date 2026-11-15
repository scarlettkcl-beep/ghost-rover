/* =====================================================================
   GHOST ROVERS · BUTTON PROMPTS
   The game is played with a game controller or the keyboard.
   Every on-screen prompt comes from this table, so it always matches the
   input the player is using right now. Controllers are labelled with
   PlayStation symbols (Xbox and others use the same layout).
   ===================================================================== */
const Prompts = (() => {
  const K = {
    pad: { name: "🎮 controller", next: "✕", back: "○", read: "△", book: "□", pause: "OPTIONS", world: "OPTIONS", steer: "left stick", drive: "R2", brake: "L2", grab: "hold ✕", skip: "○", move: "D-pad" },
    phone: { name: "phone controller", next: "Select", back: "Back", read: "Read", book: "Book", pause: "Pause", world: "Pause", steer: "tilt phone", drive: "Drive", brake: "Reverse", grab: "hold Select", skip: "Back", move: "tilt phone" },
    kb: { name: "⌨️ keyboard", next: "Enter", back: "Esc", read: "R", book: "B", pause: "P", world: "M", steer: "← →", drive: "↑", brake: "↓", grab: "hold Enter", skip: "Esc", move: "← →" }
  };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const cls = k => k === "✕" ? "ps x" : k === "○" ? "ps o" : k === "△" ? "ps t" : k === "□" ? "ps s" : "ps";
  const key = k => '<i class="' + cls(k) + '">' + esc(k) + "</i>";
  // e.g. line("pad", [["next", "Keep exploring"], ["read", "Read aloud"]]) -> "✕ Keep exploring · △ Read aloud"
  // A plain string in the list is shown as it is. Actions this input has no button for are left out.
  function line(kind, pairs) {
    const k = K[kind] || K.kb;
    return pairs.map(p => typeof p === "string" ? esc(p) : k[p[0]] ? key(k[p[0]]) + " " + esc(p[1]) : "").filter(Boolean).join(" · ");
  }
  return { K, line, key, label: (kind, act) => (K[kind] || K.kb)[act] || "" };
})();
if (typeof module !== "undefined") module.exports = Prompts;
