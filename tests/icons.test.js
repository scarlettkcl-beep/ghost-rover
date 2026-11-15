const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm"), path = require("node:path");
function element() {
  return { innerHTML: "", dataset: {}, children: [], attributes: {}, textContent: "",
    appendChild(child) { this.children.push(child); }, setAttribute(key, value) { this.attributes[key] = value; } };
}
const nodes = new Map([["muteBtn", element()], ["pauseSound", element()]]);
const ctx = vm.createContext({ document: { querySelectorAll: () => [], createElement: element }, Sfx: { muted: false }, $: id => nodes.get(id) });
vm.runInContext(fs.readFileSync(path.join(__dirname, "../js/icons.js"), "utf8") + "\nthis.icons = Icons;", ctx);
for (const name of ctx.icons.names) {
  const svg = ctx.icons.svg(name);
  assert.ok(svg.includes('aria-hidden="true"') && svg.includes('focusable="false"'), name + " is decorative");
  assert.ok(svg.includes('viewBox="0 0 32 32"'), name + " shares the mission icon grid");
  assert.ok(!svg.includes("<animate"), name + " stays still with reduced motion");
}
const host = fs.readFileSync(path.join(__dirname, "../js/host.js"), "utf8");
vm.runInContext(host.slice(host.indexOf("  function paintSound()"), host.indexOf("  function toTitle()")), ctx);
ctx.paintSound();
assert.equal(nodes.get("muteBtn").dataset.icon, "sound");
assert.equal(nodes.get("muteBtn").attributes["aria-pressed"], "true");
assert.match(nodes.get("muteBtn").attributes["aria-label"], /Mute sound/);
ctx.Sfx.muted = true; ctx.paintSound();
assert.equal(nodes.get("muteBtn").dataset.icon, "soundOff");
assert.equal(nodes.get("muteBtn").attributes["aria-pressed"], "false");
assert.match(nodes.get("muteBtn").attributes["aria-label"], /Turn sound on/);
assert.equal(nodes.get("pauseSound").children.at(-1).textContent, "Sound: Off");
for (const id of ["toast", "toastTxt", "toastTitle", "toastIco"]) {
  const el = element(); el.classList = { toggle() {}, add() {} }; nodes.set(id, el);
}
ctx.mode = "play"; ctx.toastT = 0;
vm.runInContext(host.slice(host.indexOf("  const toastIcons ="), host.indexOf("  // confetti", host.indexOf("  const toastIcons ="))), ctx);
ctx.toast("Fact");
assert.equal(nodes.get("toastIco").dataset.icon, "star"); assert.equal(ctx.toastT, 8);
ctx.toast("Task done", "Mission task", "🛠");
assert.equal(nodes.get("toastIco").dataset.icon, "tool"); assert.equal(ctx.toastT, 4);
ctx.toast("Unknown icon", "Title", "<script>");
assert.equal(nodes.get("toastIco").dataset.icon, "star", "unknown toast icons use a safe emblem");
const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
const phoneHtml = fs.readFileSync(path.join(__dirname, '../phone.html'), 'utf8');
for (const match of (html + phoneHtml).matchAll(/data-icon="([^"]+)"/g)) assert.ok(ctx.icons.names.includes(match[1]), "known icon " + match[1]);
assert.doesNotMatch(html, /reduced-motion|prefers-reduced-motion/);
console.log("Mission icons, sound state labels, and remaining menu icon checks passed");
