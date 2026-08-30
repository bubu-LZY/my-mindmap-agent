const { JSDOM } = require("jsdom")
const fs = require("fs"), path = require("path")
const bundle = process.argv[2]
const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><script type="module" crossorigin src="file:///dist/${path.basename(bundle)}"></script></head><body><div id="app"></div></body></html>`
const errors = []
const dom = new JSDOM(html, { url: "http://localhost/", runScripts: "dangerously", resources: "usable", pretendToBeVisual: true })
const win = dom.window
win.addEventListener("error", e => errors.push("ERR: " + (e.error && e.error.stack ? e.error.stack : (e.error && e.error.message) || e.message)))
win.console.error = (...a) => errors.push("CE: " + a.map(x => (x && x.message) || String(x)).join(" "))
setTimeout(() => {
  const appEl = win.document.getElementById("app")
  console.log("app len:", appEl ? appEl.innerHTML.length : 0)
  console.log("app text:", (appEl ? appEl.textContent : "").slice(0, 250))
  console.log("--- errors ---")
  console.log(errors.slice(0,15).join(String.fromCharCode(10) + "---" + String.fromCharCode(10)) || "(none)")
  process.exit(0)
}, 4000)
