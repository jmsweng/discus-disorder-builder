/* Disorder Builder UI. State lives in S; every edit goes through commit(). */
(function () {
"use strict";
const DB = window.DB, EX = window.DB_EXAMPLES, SG = window.DB_SG || [], PAPER = window.DB_PAPER;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (x, d = 3) => (isFinite(x) ? (+x).toFixed(d).replace(/\.?0+$/, "") : "—");
const STORE = "discuspdf-disorder-builder-v1";
const TEMPLATE = (document.getElementById("engine-template") || {}).textContent || "";

// ------------------------------------------------------------------------------------------ state
let S;
try { const raw = localStorage.getItem(STORE); if (raw) S = upgrade(JSON.parse(raw)); } catch (e) { S = null; }
if (!S) S = EX.rotor.make();
let section = "cell", molSel = S.molecules[0] && S.molecules[0].id, grpSel = S.orientations[0] && S.orientations[0].id;
let previewSeed = 0, placing = false, placeEl = "C", atomSel = -1, colorMode = "orientation", cellsShown = 3;
let lastReal = null;
// "From a paper": the user's notes, the pasted reply and its reading (kept separately from the model)
const PSTORE = STORE + "-paper", PROMPT_FILE = "disorder_builder_prompt.md";
let PP = { notes: "", reply: "", result: null };
try { const raw = localStorage.getItem(PSTORE); if (raw) { const o = JSON.parse(raw); PP.notes = o.notes || ""; PP.reply = o.reply || ""; } } catch (e) { /* storage unavailable */ }
function savePaper() { try { localStorage.setItem(PSTORE, JSON.stringify({ notes: PP.notes, reply: PP.reply })); } catch (e) { /* storage unavailable */ } }

function upgrade(s) {
  const b = EX.blank.make();
  const merge = (d, x) => { if (x == null) return d; if (typeof d !== "object" || Array.isArray(d)) return x; const o = { ...d }; for (const k in x) o[k] = merge(d[k], x[k]); return o; };
  return merge(b, s);
}
function save() { try { localStorage.setItem(STORE, JSON.stringify(S)); } catch (e) { /* storage unavailable: work in memory */ } }
function getPath(path) { return path.split(".").reduce((o, k) => (o == null ? o : o[k]), S); }
function setPath(path, v) {
  const ks = path.split("."); let o = S;
  for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]];
  o[ks[ks.length - 1]] = v;
}
const uid = p => p + Math.random().toString(36).slice(2, 7);

// ------------------------------------------------------------------------------------------ commit / validation
let validation = { errs: [], warns: [] };
function commit({ render = true, preview = true } = {}) {
  save();
  try { validation = DB.validate(S); } catch (e) { validation = { errs: [e.message], warns: [] }; }
  renderStatus();
  const pi = $("#pinfo"); if (pi) pi.textContent = planeInfo();
  if ($("#planes") && $("#planes").dataset.sig !== undefined) renderBenchControls();
  if (render) renderSection();
  if (preview) schedulePreview();
  markDiffuseStale();
}
function renderStatus() {
  const e = validation.errs.length, w = validation.warns.length;
  $("#status").innerHTML = e ? `<span class="chip err"><span class="dot" style="background:currentColor"></span>${e} problem${e > 1 ? "s" : ""}</span>`
    : `<span class="chip ok"><span class="dot" style="background:currentColor"></span>Ready to export</span>`;
  if (w) $("#status").innerHTML += ` <span class="chip warn">${w} note${w > 1 ? "s" : ""}</span>`;
  const b = $("#badge-script"); if (b) b.textContent = e ? `${e}!` : "";
}

// ------------------------------------------------------------------------------------------ sections
const SECTIONS = [
  ["cell", "Cell"], ["molecules", "Molecules"], ["orientations", "Orientations"], ["sites", "Sites"],
  ["disorder", "Disorder"], ["contacts", "Forbidden contacts"], ["mc", "Monte Carlo"], ["calc", "Calculations"], ["script", "Script"],
];
function renderRail() {
  $("#rail").innerHTML = SECTIONS.map(([k, t], i) => `<button type="button" data-sec="${k}" aria-current="${k === section}">
    <span class="k">${i + 1}</span><span class="t">${t}</span>${k === "script" ? '<span class="badge" id="badge-script"></span>' : ""}</button>`).join("");
  renderStatus();
}
function renderSection() {
  const fn = RENDER[section];
  const ed = $("#editor");
  const y = window.scrollY;
  // remember which collapsible parts are open (by their summary text); the editor is rebuilt on every change
  const open = new Set($$("details[open] > summary", ed).map(s => section + "|" + s.textContent.trim()));
  ed.innerHTML = fn();
  $$("details > summary", ed).forEach(s => { if (open.has(section + "|" + s.textContent.trim())) s.parentElement.open = true; });
  if (AFTER[section]) AFTER[section]();
  applyTips(ed);
  window.scrollTo(0, y);
}
const num = (path, attrs = "") => `<input type="number" step="any" data-b="${path}" data-t="num" value="${esc(getPath(path))}" ${attrs}>`;
const txt = (path, attrs = "") => `<input type="text" data-b="${path}" data-t="str" value="${esc(getPath(path))}" ${attrs}>`;
const chk = (path, label, attrs = "") => `<label class="chk"><input type="checkbox" data-b="${path}" data-t="bool" ${getPath(path) ? "checked" : ""} ${attrs}> ${label}</label>`;
const sel = (path, opts, attrs = "") => `<select data-b="${path}" data-t="${typeof getPath(path) === "number" ? "num" : "str"}" ${attrs}>${opts.map(([v, l]) =>
  `<option value="${esc(v)}" ${String(getPath(path)) === String(v) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
const trio = (path, attrs = "") => `<span class="trio">${[0, 1, 2].map(k => num(`${path}.${k}`, attrs)).join("")}</span>`;
const field = (label, inner) => `<label class="f"><span>${label}</span>${inner}</label>`;
const head = (t, p) => `<div class="sec-head"><h2>${t}</h2><p>${p}</p></div>`;
const msgs = (list, cls) => list.map(m => `<div class="msg ${cls}">${esc(m)}</div>`).join("");

function allSpecies() {
  const set = new Set();
  S.sites.forEach(s => s.occupants.forEach(o => { if (o.type === "atom" && o.species) set.add(o.species); }));
  S.sites.forEach(s => s.occupants.forEach(o => {
    if (o.type === "molecule") { const g = S.orientations.find(x => x.id === o.group); const m = g && S.molecules.find(x => x.id === g.molecule); if (m) m.atoms.forEach(a => set.add(a.el)); }
  }));
  return [...set];
}
function lattice() { try { return DB.latticeMatrix(S.cell); } catch (e) { return null; } }

const RENDER = {};
const AFTER = {};

// ---- 1 cell
RENDER.cell = () => {
  const A = lattice(), n = S.supercell.map(Number);
  const V = A ? DB.det(A) : NaN;
  return head("Unit cell and crystal", "The cell uses the discus-python convention: a along x, b in the xy plane. All positions are fractions of this cell; the crystal is the cell repeated n₁ × n₂ × n₃ times.") + paperBlock() + `
  <div class="block"><h3>Model</h3><div class="fields">
    ${field("Title", txt("title", 'class="w-xl"'))}${field("Random seed", num("seed", 'step="1"'))}${field("Output folder", txt("output_dir", 'class="w-l"'))}</div></div>
  <div class="block"><h3>Lattice parameters</h3><div class="fields">
    ${["a", "b", "c"].map(k => field(`${k} (Å)`, num("cell." + k))).join("")}
    ${[["alpha", "α"], ["beta", "β"], ["gamma", "γ"]].map(([k, l]) => field(`${l} (°)`, num("cell." + k))).join("")}</div>
    <div class="fields">${field("Supercell n₁ n₂ n₃", trio("supercell", 'step="1" min="1" class="w-s"'))}
      <span class="btn-row">${[6, 8, 10, 12, 16].map(k => `<button type="button" class="btn small" data-a="supercell" data-v="${k}">${k}³</button>`).join(" ")}</span></div>
    ${A ? `<dl class="facts"><dt>Cell volume</dt><dd>${fmt(V, 3)} Å³</dd><dt>Crystal</dt><dd>${n.join(" × ")} = ${n[0] * n[1] * n[2]} cells, ${fmt(n[0] * DB.norm(A[0]), 1)} × ${fmt(n[1] * DB.norm(A[1]), 1)} × ${fmt(n[2] * DB.norm(A[2]), 1)} Å</dd>
      <dt>a, b, c (Cartesian)</dt><dd>${A.map(r => "(" + r.map(x => fmt(x, 4)).join(", ") + ")").join("  ")}</dd></dl>` : `<div class="msg err">These parameters do not form a valid cell.</div>`}
  </div>
  <div class="block"><h3>Start from an example</h3><p class="hint">Replaces the current model. Export it first if you want to keep it.</p>
    <div class="fields">${Object.entries(EX).map(([k, e]) => `<button type="button" class="btn" data-a="example" data-v="${k}">${esc(e.name)}</button>`).join("")}</div></div>`;
};

// ---- 2 molecules
const TEMPLATES = {
  "H2O": [["O", 0, 0, 0], ["H", .7572, .5865, 0], ["H", -.7572, .5865, 0]],
  "CO2": [["C", 0, 0, 0], ["O", 1.16, 0, 0], ["O", -1.16, 0, 0]],
  "N2": [["N", .549, 0, 0], ["N", -.549, 0, 0]],
  "C2H2": [["C", .601, 0, 0], ["C", -.601, 0, 0], ["H", 1.663, 0, 0], ["H", -1.663, 0, 0]],
  "NH4+": tetra("N", "H", 1.03), "CH4": tetra("C", "H", 1.09), "ClO4-": tetra("Cl", "O", 1.44), "SO4 2-": tetra("S", "O", 1.47),
  "NO3-": [["N", 0, 0, 0], ...[0, 120, 240].map(t => ["O", 1.24 * Math.cos(t * Math.PI / 180), 1.24 * Math.sin(t * Math.PI / 180), 0])],
  "SF6": [["S", 0, 0, 0], ["F", 1.56, 0, 0], ["F", -1.56, 0, 0], ["F", 0, 1.56, 0], ["F", 0, -1.56, 0], ["F", 0, 0, 1.56], ["F", 0, 0, -1.56]],
  "C6H6": [...[0, 60, 120, 180, 240, 300].map(t => ["C", 1.39 * Math.cos(t * Math.PI / 180), 1.39 * Math.sin(t * Math.PI / 180), 0]),
    ...[0, 60, 120, 180, 240, 300].map(t => ["H", 2.48 * Math.cos(t * Math.PI / 180), 2.48 * Math.sin(t * Math.PI / 180), 0])],
  "CH3CN": [["C", 0, 0, -1.47], ["C", 0, 0, 0], ["N", 0, 0, 1.157], ...[0, 120, 240].map(t => ["H", 1.03 * Math.cos(t * Math.PI / 180), 1.03 * Math.sin(t * Math.PI / 180), -1.83])],
};
function tetra(c, x, d) { const h = d / Math.sqrt(3); return [[c, 0, 0, 0], [x, h, h, h], [x, h, -h, -h], [x, -h, h, -h], [x, -h, -h, h]]; }

RENDER.molecules = () => {
  const m = S.molecules.find(x => x.id === molSel);
  const list = S.molecules.map(x => `<button type="button" class="btn" aria-pressed="${x.id === molSel}" data-a="mol-select" data-v="${x.id}">${esc(x.name)} <span class="tag">${x.atoms.length}</span></button>`).join(" ");
  let body = `<p class="hint">No molecule yet. Start from a template or an empty molecule.</p>`;
  if (m) {
    const mi = S.molecules.indexOf(m), loc = DB.moleculeLocal(m);
    const bonds = DB.bondsOf(loc.species, loc.xyz);
    body = `<div class="fields">${field("Name", txt(`molecules.${mi}.name`, 'class="w-l"'))}
      ${field("Placed at the site by", sel(`molecules.${mi}.anchor`, [["centroid", "centroid"], ["com", "centre of mass"], ...m.atoms.map((a, i) => [i, `atom ${i + 1} (${a.el})`])]))}
      ${field("Template", `<select id="tpl"><option value="">Replace atoms with…</option>${Object.keys(TEMPLATES).map(k => `<option>${k}</option>`).join("")}</select>`)}
      <button type="button" class="btn" data-a="mol-dup">Duplicate</button><span class="push"></span><button type="button" class="btn danger" data-a="mol-del">Delete molecule</button></div>
    <div class="mol-layout">
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>#</th><th>Element</th><th>x (Å)</th><th>y (Å)</th><th>z (Å)</th><th></th></tr></thead><tbody>
      ${m.atoms.map((a, i) => `<tr class="${i === atomSel ? "sel" : ""}"><td class="num"><button type="button" class="btn ghost small" data-a="atom-pick" data-v="${i}">${i + 1}</button></td>
        <td><input type="text" class="w-s" data-b="molecules.${mi}.atoms.${i}.el" data-t="str" value="${esc(a.el)}"></td>
        ${[0, 1, 2].map(k => `<td>${num(`molecules.${mi}.atoms.${i}.xyz.${k}`)}</td>`).join("")}
        <td><button type="button" class="btn ghost" data-a="atom-del" data-v="${i}" aria-label="Remove atom ${i + 1}">✕</button></td></tr>`).join("")}
      </tbody></table>
      <div class="fields" style="margin-top:10px"><button type="button" class="btn" data-a="atom-add">Add atom</button>
        <button type="button" class="btn" data-a="mol-centre">Move anchor to origin</button>
        <span class="hint">${bonds.length} bonds drawn from covalent radii. Coordinates are Cartesian, in the cell's frame (a ∥ x).</span></div>
      <details style="margin-top:10px"><summary>Paste XYZ coordinates</summary>
        <textarea id="xyz-in" rows="5" placeholder="C 0.0 0.0 0.0&#10;O 1.16 0 0"></textarea>
        <button type="button" class="btn small" data-a="xyz-import">Replace atoms</button></details></div>
      <div><div class="canvas-box ${placing ? "placing" : ""}" id="molbox"><canvas id="molcv"></canvas>
        <div class="overlay">${placing ? "click to place " + esc(placeEl) : "drag to rotate · shift-drag to pan · wheel to zoom"}</div></div>
        <div class="fields" style="margin-top:8px"><button type="button" class="btn small" aria-pressed="${placing}" data-a="place-toggle">Draw atoms</button>
          ${field("Element", `<input type="text" id="place-el" class="w-s" value="${esc(placeEl)}">`)}
          <button type="button" class="btn small" data-a="mol-view" data-v="z">View ⟂ xy</button><button type="button" class="btn small" data-a="mol-view" data-v="x">View ⟂ yz</button></div>
        <p class="hint">Draw atoms places a new atom where you click, in the plane of the screen through the anchor.</p></div>
    </div>`;
  }
  return head("Molecules", "Build rigid molecules from atoms. A molecule is placed on a site by its anchor point, then turned into an orientation from its library.") +
    `<div class="block"><h3>Molecules <span class="grow"></span><button type="button" class="btn small" data-a="mol-add">New molecule</button></h3>
      <div class="fields">${list || '<span class="hint">None</span>'}</div>${body}</div>`;
};
let molViewer = null;
AFTER.molecules = () => {
  const cv = $("#molcv"); if (!cv) return;
  molViewer = new Viewer(cv, { aspect: 1, placing: () => placing, onClick: (p) => {
    const m = S.molecules.find(x => x.id === molSel); if (!m) return;
    const el = ($("#place-el").value || "C").trim(); placeEl = el;
    const loc = DB.moleculeLocal(m), o = DB.sub(m.atoms.length ? m.atoms[0].xyz.map(Number) : [0, 0, 0], loc.xyz[0] || [0, 0, 0]);
    const xyz = DB.add(p, o).map(x => +x.toFixed(4));
    m.atoms.push({ el, xyz }); atomSel = m.atoms.length - 1; commit();
  } });
  if (window._molR) molViewer.R = window._molR;
  drawMolecule();
  cv.addEventListener("pointerup", () => { window._molR = molViewer.R; });
  const tpl = $("#tpl"); if (tpl) tpl.addEventListener("change", () => {
    const m = S.molecules.find(x => x.id === molSel); const t = TEMPLATES[tpl.value]; if (!m || !t) return;
    m.atoms = t.map(([el, x, y, z]) => ({ el, xyz: [x, y, z].map(v => +v.toFixed(4)) })); m.anchor = "centroid";
    if (/^Mol|^New/.test(m.name)) m.name = tpl.value;
    commit();
  });
};
function drawMolecule() {
  const m = S.molecules.find(x => x.id === molSel); if (!m || !molViewer) return;
  const loc = DB.moleculeLocal(m);
  molViewer.set({ atoms: loc.xyz.map((p, i) => ({ p, color: DB.colorOf(loc.species[i]), r: 0.18 + 0.2 * DB.covOf(loc.species[i]), label: String(i + 1), ring: i === atomSel ? "#0d6a80" : null })),
    bonds: DB.bondsOf(loc.species, loc.xyz), lines: [], center: [0, 0, 0], axes: lattice() || undefined });
}

// ---- 3 orientations
RENDER.orientations = () => {
  const g = S.orientations.find(x => x.id === grpSel);
  const list = S.orientations.map(x => `<button type="button" class="btn" aria-pressed="${x.id === grpSel}" data-a="grp-select" data-v="${x.id}">${esc(x.name)}</button>`).join(" ");
  let body = `<p class="hint">${S.molecules.length ? "Create a group to start a library." : "Build a molecule first."}</p>`;
  if (g) {
    const gi = S.orientations.indexOf(g), A = lattice();
    const mol = S.molecules.find(x => x.id === g.molecule);
    let ex = { orientations: [], errors: ["choose a molecule"], nOps: 0 };
    if (mol && A) ex = DB.expandGroup(g, mol, A);
    const w = k => (g.weights && g.weights[k] != null ? g.weights[k] : 1);
    const wsum = ex.orientations.reduce((s, o, k) => s + (+w(k) || 0), 0) || 1;
    body = `<div class="fields">${field("Name", txt(`orientations.${gi}.name`, 'class="w-l"'))}
        ${field("Molecule", sel(`orientations.${gi}.molecule`, S.molecules.map(m => [m.id, m.name])))}
        <button type="button" class="btn" data-a="grp-dup">Duplicate</button><span class="push"></span><button type="button" class="btn danger" data-a="grp-del">Delete group</button></div>
      <div class="fields">${field("Euler convention", sel(`orientations.${gi}.convention`, [["ZYZ", "ZYZ"], ["ZXZ", "ZXZ"], ["XYZ", "XYZ"]]))}
        ${field("α β γ (°) — base orientation", trio(`orientations.${gi}.euler`))}
        ${field("Operations act in", sel(`orientations.${gi}.frame`, [["lab", "crystal frame (after the base)"], ["molecule", "molecule frame (before the base)"]]))}
        ${chk(`orientations.${gi}.closure`, "Generate the full group")}</div>
      <div class="fields" style="align-items:start"><label class="f" style="flex:1;min-width:240px"><span>Symmetry operations, one per line</span>
        <textarea rows="5" data-b="orientations.${gi}.ops" data-t="str" spellcheck="false">${esc(g.ops)}</textarea></label>
        <div class="doc hint" style="max-width:44ch"><p><code>C4 [0 0 1]</code> n-fold axis along a lattice direction, <code>&lt;x y z&gt;</code> for Cartesian; <code>S4 [001]</code>; <code>m [1 -1 0]</code> mirror normal; <code>-1</code> inversion; <code>R 30 [1 1 1]</code> any angle; <code>-y,x,z</code> Jones symbol (translations ignored); <code>M</code> + nine numbers for a Cartesian matrix.</p>
        <div class="fields">${["C2 [0 0 1]", "C3 [1 1 1]", "C4 [0 0 1]", "m [0 0 1]", "-1"].map(o => `<button type="button" class="btn small" data-a="op-add" data-v="${o}">${o}</button>`).join("")}</div></div></div>
      ${msgs(ex.errors, "err")}
      <p class="hint">${ex.orientations.length} distinct orientation${ex.orientations.length === 1 ? "" : "s"} from ${ex.nOps} operation${ex.nOps === 1 ? "" : "s"}${ex.nOps > ex.orientations.length ? " (operations that map the molecule onto itself are merged)" : ""}. Relative weights set how often each orientation is drawn when a site picks this group. All thumbnails share one tilted view of the cell axes.</p>
      <div class="orient-grid">${ex.orientations.map((o, k) => `<div class="orient ${+w(k) > 0 ? "" : "off"}"><canvas data-orient="${k}"></canvas>
        <div class="row"><span class="tag">#${k + 1}</span>${o.improper ? '<span class="tag improper" title="contains a mirror: the molecule is inverted">mirror</span>' : ""}${o.multiplicity > 1 ? `<span class="tag" title="operations giving this placement">×${o.multiplicity}</span>` : ""}</div>
        <div class="row"><span>weight</span><input type="number" step="any" min="0" data-b="orientations.${gi}.weights.${k}" data-t="num" value="${esc(w(k))}"></div>
        <div class="row"><span class="tag">${fmt(100 * (+w(k) || 0) / wsum, 1)}%</span><button type="button" class="btn ghost small" data-a="mat-show" data-v="${k}">matrix</button></div></div>`).join("")}</div>
      <pre class="code" id="matbox" hidden></pre>`;
  }
  return head("Orientation library", "A group is a base orientation (Euler angles) plus symmetry operations. Every operation applied to the base gives one preferred orientation; sites then choose among a group's orientations with the weights below.") +
    `<div class="block"><h3>Groups <span class="grow"></span><button type="button" class="btn small" data-a="grp-add">New group</button></h3><div class="fields">${list || '<span class="hint">None</span>'}</div>${body}</div>`;
};
AFTER.orientations = () => {
  const g = S.orientations.find(x => x.id === grpSel), A = lattice();
  const mol = g && S.molecules.find(x => x.id === g.molecule);
  if (!g || !mol || !A) return;
  const ex = DB.expandGroup(g, mol, A), loc = DB.moleculeLocal(mol), bonds = DB.bondsOf(loc.species, loc.xyz);
  $$("canvas[data-orient]").forEach(cv => {
    const o = ex.orientations[+cv.dataset.orient];
    const v = new Viewer(cv, { static: true, aspect: 1 });
    v.viewAlong(DB.add(DB.add(DB.scale(A[0], 0.42), DB.scale(A[1], 0.28)), A[2]), A[2]);
    v.set({ atoms: loc.xyz.map((p, i) => ({ p: DB.mv(o.R, p), color: DB.colorOf(loc.species[i]), r: 0.16 + 0.18 * DB.covOf(loc.species[i]) })), bonds, lines: [], center: [0, 0, 0], axes: A });
  });
};

// ---- 4 sites
const OCC_COLORS = ["#0d6a80", "#d9822b", "#6b8e23", "#8e44ad", "#c0392b", "#2c7fb8", "#b8860b", "#7f8c8d"];
RENDER.sites = () => {
  const groups = S.orientations.map(g => [g.id, g.name]);
  const cards = S.sites.map((s, si) => {
    const tot = s.occupants.reduce((a, o) => a + (+o.p || 0), 0);
    const occ = s.occupants.map((o, oi) => {
      const p = `sites.${si}.occupants.${oi}`;
      const what = o.type === "atom" ? `<input type="text" class="w-s" data-b="${p}.species" data-t="str" value="${esc(o.species)}" aria-label="species">`
        : o.type === "molecule" ? (groups.length ? sel(`${p}.group`, groups) : '<span class="hint">no orientation groups yet</span>') : '<span class="hint">empty site</span>';
      return `<tr><td><span class="dot" style="background:${OCC_COLORS[oi % 8]}"></span></td><td>${sel(`${p}.type`, [["atom", "atom"], ["molecule", "molecule"], ["vacancy", "vacancy"]])}</td><td>${what}</td>
        <td>${num(`${p}.p`, 'min="0" max="1"')}</td><td>${o.type !== "vacancy" ? `<input type="number" step="any" data-b="${p}.b" data-t="numornull" value="${esc(o.b)}" placeholder="site" class="w-s">` : ""}</td>
        <td><button type="button" class="btn ghost" data-a="occ-del" data-v="${si}.${oi}" aria-label="Remove occupant">✕</button></td></tr>`;
    }).join("");
    return `<div class="site"><div class="site-head">${field("Label", `<input type="text" class="w-s" data-b="sites.${si}.label" data-t="str" value="${esc(s.label)}">`)}
      ${field("x y z (fractional)", trio(`sites.${si}.frac`))}${field("B (Å²)", num(`sites.${si}.b_iso`, 'class="w-s"'))}
      ${field("Draw", sel(`sites.${si}.draw`, [["random", "independent per cell"], ["exact", "exact composition"]]))}
      ${s.set ? `<span class="tag" title="Generated from ${esc(s.wyckoff || "")}">${esc(s.wyckoff || "")}</span>` : ""}
      ${s.sym ? `<span class="tag" title="Molecules on this site are turned by the rotation part of ${esc(s.sym)} relative to the orientation library.">↻ ${esc(s.sym)}</span><button type="button" class="btn ghost small" data-a="sym-clear" data-v="${si}">don't rotate</button>` : ""}
      <span class="grow" style="flex:1"></span><button type="button" class="btn danger small" data-a="site-del" data-v="${si}">Delete site</button></div>
      <div class="probbar">${s.occupants.map((o, oi) => `<span style="width:${100 * Math.max(0, +o.p || 0) / Math.max(tot, 1)}%;background:${OCC_COLORS[oi % 8]}"></span>`).join("")}</div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th></th><th>Occupant</th><th>Species / orientation group</th><th>Probability</th><th>B override</th><th></th></tr></thead><tbody>${occ}</tbody></table></div>
      <div class="fields"><button type="button" class="btn small" data-a="occ-add" data-v="${si}.atom">+ Atom</button><button type="button" class="btn small" data-a="occ-add" data-v="${si}.molecule">+ Molecule</button>
        <button type="button" class="btn small" data-a="occ-add" data-v="${si}.vacancy">+ Vacancy</button><button type="button" class="btn small" data-a="occ-norm" data-v="${si}">Scale to 1</button>
        <span class="sum ${Math.abs(tot - 1) > 1e-6 ? "bad" : ""}">Σp = ${fmt(tot, 4)}</span>
        ${s.set && S.sites.filter(x => x.set === s.set).length > 1 ? `<span style="flex:1"></span><button type="button" class="btn small" data-a="set-copy" data-v="${si}">Copy occupants to the other ${S.sites.filter(x => x.set === s.set).length - 1} sites of this set</button>` : ""}</div></div>`;
  }).join("");
  return head("Sites", "Each site sits at one fractional position in every unit cell. In each cell it holds one occupant, drawn with these probabilities: an atom, a molecule in one of its group's orientations, or nothing.") +
    spaceGroupBlock() +
    `<div class="block"><h3>Sites in the unit cell <span class="grow"></span><button type="button" class="btn small" data-a="site-add">Add site</button></h3>
    <div class="cards">${cards}</div>
    <p class="hint">“Exact composition” fixes the number of each occupant in the crystal (shuffled); “independent” draws every cell separately. B is used only with Debye–Waller switched on (Calculations).</p></div>`;
};

// ---- space group → Wyckoff sites
let wy = { letter: null, free: { x: 0.1, y: 0.2, z: 0.3 }, prefix: "", occ: "atom", el: "C", copy: 0, rotate: true };
function spaceGroupBlock() {
  const n = +(S.spacegroup || {}).n || 0, sg = SG.find(g => g.n === n);
  const systems = ["triclinic", "monoclinic", "orthorhombic", "tetragonal", "trigonal", "hexagonal", "cubic"];
  const options = systems.map(sys => `<optgroup label="${sys}">${SG.filter(g => DB.crystalSystem(g.n) === sys).map(g =>
    `<option value="${g.n}" ${g.n === n ? "selected" : ""}>${g.n}  ${esc(g.s)}</option>`).join("")}</optgroup>`).join("");
  let body = '<p class="hint">Pick a space group to list its Wyckoff positions. Choosing one adds every symmetry-equivalent position in the unit cell as a site.</p>';
  if (sg) {
    const fits = DB.cellFits(sg.n, S.cell), sys = DB.crystalSystem(sg.n);
    const setting = sys === "monoclinic" ? "unique axis b" : sys === "trigonal" && sg.s[0] === "R" ? "hexagonal axes" : [48, 50, 59, 68, 70, 85, 86, 88, 125, 126, 129, 130, 133, 134, 137, 138, 141, 142, 201, 203, 222, 224, 227, 228].includes(sg.n) ? "origin choice 2" : "standard setting";
    const rows = sg.w.map(w => {
      const on = wy.letter === w[0];
      return `<tr class="${on ? "sel" : ""}"><td class="num">${w[1]}${esc(w[0])}</td><td class="num">${esc(w[2])}</td><td class="num">${esc(w[3])}</td>
        <td><button type="button" class="btn small" aria-pressed="${on}" data-a="wy-pick" data-v="${esc(w[0])}">${on ? "Selected" : "Choose"}</button></td></tr>`;
    }).join("");
    let form = "";
    const w = sg.w.find(q => q[0] === wy.letter);
    if (w) {
      const fp = DB.freeParams(w[3]);
      const pos = DB.wyckoffOrbit(sg, w[3], wy.free);
      // positions taken by the set just added are not reported until the user tries to add it again
      const clash = pos.filter(p => S.sites.some(s => (wy.repeat || !wy.lastSet || s.set !== wy.lastSet) && s.frac.every((v, i) => { const d = Math.abs((((+v - p[i]) % 1) + 1) % 1); return Math.min(d, 1 - d) < 1e-4; })));
      const siteOpts = S.sites.map((s, i) => `<option value="${i}" ${+wy.copy === i ? "selected" : ""}>${esc(s.label)}</option>`).join("");
      const prefix = wy.prefix || defaultPrefix(w);
      form = `<div class="site"><div class="fields"><strong>${w[1]}${esc(w[0])} (${esc(w[3])})</strong>
          ${fp.length ? fp.map(v => field(v, `<input type="number" step="any" id="wy-${v}" value="${esc(wy.free[v])}" class="w-s">`)).join("") : '<span class="hint">no free parameters</span>'}
          ${field("Label prefix", `<input type="text" id="wy-prefix" value="${esc(prefix)}" class="w-s" maxlength="7">`)}
          ${field("Occupant", `<select id="wy-occ"><option value="atom" ${wy.occ === "atom" ? "selected" : ""}>new atom</option>${S.sites.length ? `<option value="copy" ${wy.occ === "copy" ? "selected" : ""}>copy from site</option>` : ""}</select>`)}
          ${wy.occ === "copy" && S.sites.length ? field("Site", `<select id="wy-copy">${siteOpts}</select>`) : field("Element", `<input type="text" id="wy-el" value="${esc(wy.el)}" class="w-s">`)}
          ${wy.occ === "copy" ? `<label class="chk" title="Turn each copied molecule by the rotation (or mirror) of the symmetry operation that generates its position, as in an ordered crystal. Off: every copy keeps the original orientations."><input type="checkbox" id="wy-rot" ${wy.rotate ? "checked" : ""}> Rotate molecules with the symmetry</label>` : ""}
          <button type="button" class="btn primary small" data-a="wy-add">Add ${pos.length} site${pos.length === 1 ? "" : "s"}</button></div>
        <p class="hint num">${pos.slice(0, 12).map(p => "(" + p.map(v => fmt(v, 4)).join(", ") + ")").join("  ")}${pos.length > 12 ? `  … ${pos.length - 12} more` : ""}</p>
        ${pos.length !== w[1] ? `<div class="msg warn">These parameter values give ${pos.length} positions instead of ${w[1]}: they put the site on a more special position.</div>` : ""}
        ${clash.length ? `<div class="msg warn">${clash.length === pos.length ? `All ${pos.length} positions already hold a site, so nothing will be added.` : `${clash.length} of these positions already hold a site; they will be skipped.`}</div>` : ""}</div>`;
    }
    body = `<div class="fields"><span class="chip">${sys}</span><span class="hint">lattice ${esc(sg.l)}, ${setting}, ${sg.g.length} symmetry operations in the cell</span>
        ${fits ? "" : `<span class="chip warn">cell does not match</span><button type="button" class="btn small" data-a="sg-fit">Make the cell ${sys}</button>`}</div>
      <div class="tbl-wrap" style="max-height:280px;overflow:auto"><table class="tbl"><thead><tr><th>Wyckoff</th><th>Site symmetry</th><th>Coordinates</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
      ${form}
      <p class="hint">Sites made this way are ordinary sites you can edit; each carries its Wyckoff label so you can copy occupants across the set. Molecule orientations are not rotated by the symmetry operations, so give a molecule an orientation group that already has the site's symmetry (e.g. generated with “full group”).</p>`;
  }
  return `<div class="block"><h3>Sites from a space group</h3><div class="fields">${field("Space group", `<select id="sg-sel"><option value="0">choose…</option>${options}</select>`)}</div>${body}</div>`;
}
function defaultPrefix(w) { return ((wy.occ === "copy" && S.sites[+wy.copy] ? S.sites[+wy.copy].label.replace(/_?\d+$/, "") : (wy.el || "S")) + w[0]).slice(0, 7); }

// ---- source paper (Cell step) and "From a paper"
function paperBlock() {
  const p = S.paper;
  if (!p || !(p.title || p.doi || p.summary)) return `<p class="hint">Starting from a published structure? <button type="button" class="btn small" data-a="paper-open">Start from a paper</button></p>`;
  const cite = [p.authors, p.year && `(${esc(p.year)})`].filter(Boolean).map(String).join(" ");
  const list = (t, xs) => xs && xs.length ? `<p class="hint"><strong>${t}</strong></p><ul class="plist">${xs.map(q => `<li>${esc(q)}</li>`).join("")}</ul>` : "";
  return `<div class="block"><h3>Source paper</h3>
    <p>${esc(cite)}${cite ? ", " : ""}<em>${esc(p.title)}</em>${p.doi ? ` · <a href="https://doi.org/${esc(p.doi)}" target="_blank" rel="noopener">doi:${esc(p.doi)}</a>` : ""}</p>
    ${p.conditions ? `<p class="hint">${esc(p.conditions)}</p>` : ""}${p.summary ? `<p>${esc(p.summary)}</p>` : ""}
    ${p.notes ? `<p class="hint"><strong>Your notes</strong></p><p class="pnotes">${esc(p.notes)}</p>` : ""}
    ${list("Assumptions made when reading the paper", p.assumptions)}${list("Not represented in this model", p.not_representable)}${list("Open questions", p.questions)}</div>`;
}
const STATUS_TXT = { unsourced: "no source", assumed: "assumed", default: "page default", derived: "derived", user: "your note", reported: "reported" };
RENDER.paper = () => {
  const r = PP.result;
  const step = (k, t) => `<h3><span class="pstep">${k}</span>${t}</h3>`;
  let res = "";
  if (r) {
    const warnRows = r.review.filter(q => q.status !== "reported").length;
    res = `<div class="block">${step(4, "Check what was read")}
      ${r.errors.length ? `${msgs(r.errors, "err")}<div class="fields"><button type="button" class="btn primary small" data-a="paper-fix">Copy a message for the chatbot</button>
        <span class="hint">Paste it into the same chat; the chatbot answers with a corrected JSON, which you paste in step 3 again.</span></div>` : ""}
      ${msgs(r.warnings, "warn")}
      ${r.review.length ? `<p class="hint">${r.review.length} values were read; ${warnRows} of them are not reported by the paper (no source, assumed, derived or page defaults) and are listed first. Compare them with the paper before you rely on the model.</p>
      <div class="tbl-wrap" style="max-height:420px;overflow:auto"><table class="tbl ptbl"><thead><tr><th>What</th><th>Value</th><th>Status</th><th>Source</th></tr></thead><tbody>
      ${r.review.map(q => `<tr class="ps-${q.status}"><td>${esc(q.label)}${q.note ? `<div class="hint">${esc(q.note)}</div>` : ""}</td><td class="num">${esc(q.value)}</td>
        <td><span class="chip ps">${esc(STATUS_TXT[q.status] || q.status)}</span></td><td>${esc(q.source)}</td></tr>`).join("")}</tbody></table></div>` : ""}
      ${r.state ? `<div class="fields"><button type="button" class="btn primary" data-a="paper-load">Load this model</button>
        <button type="button" class="btn small" data-a="export">Save the current model first</button>
        <span class="hint">Loading replaces the model now on this page.</span></div>` : ""}</div>`;
  }
  return head("Start from a paper", "A chatbot such as Claude or ChatGPT reads the paper and writes down what it reports; this page then builds the model and shows you every value with its source, so you can check it before you use it.") + `
  <div class="msg warn">This has only been tested to work properly with Claude Opus 5.5 and GPT-6.1 Sol. Other chatbots may give replies the page cannot read, or misread the paper.</div>
  <div class="block">${step(1, "Add your notes (optional)")}
    <p class="hint">Anything that helps read the paper correctly: which phase, temperature or pressure to use, which table holds the final refinement, what the disorder is, what you will compare with (X-ray or neutron), or where the paper is wrong or unclear. The notes go into the prompt and are kept with the model.</p>
    <textarea id="paper-notes" rows="5" placeholder="e.g. Use the 500 K, 4.7 GPa structure (Table S2), not the room-temperature one. The sample is D2O. The paper describes three orientation types of the water molecule in Fig. 3; their populations are in Extended Data Fig. 7b.">${esc(PP.notes)}</textarea></div>
  <div class="block">${step(2, "Give the prompt to a chatbot together with the paper")}
    <p class="hint">Open Claude, ChatGPT or a similar assistant that can read PDF files, in a new chat. Then use either way:</p>
    <div class="pways">
      <div class="pway"><h4>A · Copy and paste</h4>
        <ol class="psteps"><li>Click <strong>Copy the prompt</strong>.</li>
          <li>Attach the paper's PDF, and its supplementary information and CIF files if you have them.</li>
          <li>Paste the prompt into the message box and send it.</li></ol>
        <button type="button" class="btn primary" data-a="paper-copy">Copy the prompt</button></div>
      <div class="pway"><h4>B · Attach the prompt as a file</h4>
        <ol class="psteps"><li>Click <strong>Download prompt (.md)</strong> and save the file.</li>
          <li>Attach the saved <code>${esc(PROMPT_FILE)}</code> together with the paper's PDF (and SI or CIF files).</li>
          <li>Type a short message such as <em>“Follow the instructions in ${esc(PROMPT_FILE)} for the attached paper.”</em> and send it.</li></ol>
        <button type="button" class="btn" data-a="paper-dl">Download prompt (.md)</button></div></div>
    <p class="hint">Either way the answer ends with a block of JSON. The file holds your notes from step 1 as they were when you downloaded it: download it again after changing the notes. You can keep the file and reuse it for other papers if the notes still fit.</p>
    <details><summary>Show the prompt</summary><pre class="code" id="paper-prompt">${esc(PAPER.buildPrompt(PP.notes))}</pre></details></div>
  <div class="block">${step(3, "Paste the chatbot's whole answer")}
    <textarea id="paper-reply" rows="8" placeholder="Paste the complete answer here, including the JSON block.">${esc(PP.reply)}</textarea>
    <div class="fields"><button type="button" class="btn primary" data-a="paper-read">Read the answer</button>${PP.reply ? '<button type="button" class="btn small ghost" data-a="paper-clear">Clear</button>' : ""}</div></div>
  ${res}
  <p class="hint">Chatbots make mistakes. The page checks that the model is complete and self-consistent, but only you can check it against the paper: look at every row that is not marked “reported”, and at the crystal preview.</p>`;
};

// ---- 5 disorder
RENDER.disorder = () => {
  const sp = allSpecies(), d = S.disorder, c = d.correlations;
  const siteOpts = S.sites.map((s, i) => [i, s.label]);
  const rep = lastReal && lastReal.report;
  const inter = c.interactions.map((it, k) => {
    const r = rep && rep.find(x => x.it === undefined ? false : x.it.site_a === +it.site_a && x.it.site_b === +it.site_b && String(x.it.t) === String(it.t.map(Number)) && +x.it.J === +it.J);
    return `<tr><td>${sel(`disorder.correlations.interactions.${k}.site_a`, siteOpts)}</td><td>${sel(`disorder.correlations.interactions.${k}.site_b`, siteOpts)}</td>
      <td>${trio(`disorder.correlations.interactions.${k}.t`, 'step="1" class="w-s"')}</td><td>${num(`disorder.correlations.interactions.${k}.J`, 'class="w-s"')}</td>
      <td class="num">${r ? `${fmt(r.before, 2)} → ${fmt(r.after, 2)}` : "—"}</td>
      <td><button type="button" class="btn ghost" data-a="int-del" data-v="${k}" aria-label="Remove">✕</button></td></tr>`;
  }).join("");
  return head("Disorder", "Occupancies come from the Sites step. Here you add correlations between neighbouring occupants and the displacive disorder applied after the occupants are placed.") + `
  <div class="block"><h3>Correlated occupants ${chk("disorder.correlations.enabled", "on")}</h3>
    <p class="hint">A swap Monte Carlo that keeps the composition. Each listed pair of neighbours adds an energy J (in kT) when both hold the same occupant: J &lt; 0 makes like neighbours (domains), J &gt; 0 alternation. It works for atoms, vacancies and molecule orientations alike and runs in the generated script before DISCUS sees the crystal.</p>
    <div class="fields">${field("Sweeps", num("disorder.correlations.sweeps", 'step="1" class="w-s"'))}${field("kT", num("disorder.correlations.kT", 'class="w-s"'))}
      <span class="hint">Sweeps and kT are shared with Forbidden contacts.</span>
      ${field("“Same occupant” means", sel("disorder.correlations.match", [["orientation", "same atom / same orientation"], ["group", "same atom / same molecule group"]]))}</div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Site</th><th>Neighbour site</th><th>Cell offset t</th><th>J (kT)</th><th>P(same) preview</th><th></th></tr></thead><tbody>${inter}</tbody></table></div>
    <div class="fields"><button type="button" class="btn small" data-a="int-add">Add pair</button>
      ${S.sites.length ? `<button type="button" class="btn small" data-a="int-axes">Add ±a, ±b, ±c neighbours of ${esc(S.sites[0].label)}</button>` : ""}</div></div>
  <div class="block"><h3>Rigid-body disorder of molecules (default)</h3><div class="fields">
    ${field("Translation σ (Å)", num("disorder.molecule_rigid.translation_sigma"))}${field("Libration σ (°)", num("disorder.molecule_rigid.libration_sigma_deg"))}</div>
    <p class="hint">Each molecule gets a Gaussian shift and a small rotation about a random axis on top of its preferred orientation. These are static (frozen) displacements, so they appear as diffuse scattering rather than as a Debye–Waller factor.</p></div>
  <div class="block"><h3>Atomic displacements (default per element)</h3><div class="fields">
    ${sp.length ? sp.map(s => field(`σ ${esc(s)} (Å)`, `<input type="number" step="any" min="0" data-b="disorder.atomic_displacements.${esc(s)}" data-t="num" value="${esc(d.atomic_displacements[s] || 0)}">`)).join("") : '<span class="hint">No species yet.</span>'}</div>
    <p class="hint">Independent Gaussian displacements per atom (all three directions). Applied to molecule atoms too, which then distorts the molecules slightly.</p></div>
  ${perOccupant()}
  <div class="block"><h3>Contact check</h3><div class="fields">${field("Warn below (Å)", num("disorder.clash_threshold", 'class="w-s"'))}</div>
    <p class="hint">The script reports atoms of different molecules or sites that come closer than this.</p></div>`;
};

function perOccupant() {
  const d = S.disorder, rig = d.molecule_rigid;
  const rows = [];
  S.sites.forEach((s, si) => s.occupants.forEach((o, oi) => {
    if (o.type === "vacancy") return;
    const p = `sites.${si}.occupants.${oi}`;
    const g = o.type === "molecule" ? S.orientations.find(x => x.id === o.group) : null;
    const name = o.type === "atom" ? esc(o.species) : `${esc(g ? g.name : "?")} <span class="tag">molecule</span>`;
    const els = o.type === "molecule" && g ? [...new Set(((S.molecules.find(m => m.id === g.molecule) || {}).atoms || []).map(x => x.el))] : [];
    const dflt = o.type === "atom" ? `${+d.atomic_displacements[o.species] || 0}` : "default";
    const sigTip = o.type === "atom" ? "Gaussian displacement of this atom (Å). Empty: the element default above."
      : `Gaussian displacement of every atom of this molecule (Å). Empty: each element's default above (${els.map(e => `${e} ${+d.atomic_displacements[e] || 0}`).join(", ") || "none"}).`;
    const inp = (k, ph, tip) => `<input type="number" step="any" min="0" class="w-po" data-b="${p}.${k}" data-t="numornull" value="${esc(o[k] == null ? "" : o[k])}" placeholder="${esc(ph)}" title="${esc(tip)}">`;
    rows.push(`<tr><td>${esc(s.label)}</td><td>${name}</td><td class="num">${fmt(+o.p, 3)}</td>
      <td>${inp("sigma", dflt, sigTip)}</td>
      <td>${o.type === "molecule" ? inp("trans", `${+rig.translation_sigma || 0}`, "Gaussian shift of the whole molecule (Å). Empty: the default above.") : ""}</td>
      <td>${o.type === "molecule" ? inp("lib", `${+rig.libration_sigma_deg || 0}`, "Gaussian rotation of the whole molecule about a random axis (°). Empty: the default above.") : ""}</td></tr>`);
  }));
  return `<div class="block"><h3>Per site and occupant</h3>
    <p class="hint">Different amounts of disorder for each atom or molecule in the cell. An empty field uses the default shown in grey (“default” for a molecule's atoms means each element's own value above); a value replaces it for that occupant only (0 switches it off).</p>
    ${rows.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Site</th><th>Occupant</th><th>p</th><th>Atomic σ (Å)</th><th>Translation σ (Å)</th><th>Libration σ (°)</th></tr></thead><tbody>${rows.join("")}</tbody></table></div>` : '<p class="hint">No occupants yet.</p>'}</div>`;
}

// ---- Forbidden contacts
const STRENGTH = [[100, "forbidden (100 kT)"], [10, "strong (10 kT)"], [2, "mild (2 kT)"]];
RENDER.contacts = () => {
  const con = S.disorder.contacts, corr = S.disorder.correlations;
  const sp = [...new Set(allSpecies().map(e => DB.elementOf(e) || e))];
  const elOpts = [["any", "any atom"], ...sp.map(e => [e, e])];
  const rules = con.rules.map((r, k) => {
    const p = `disorder.contacts.rules.${k}`, known = STRENGTH.some(([v]) => v === +r.penalty);
    const opts = elOpts.some(([v]) => v === r.a) ? elOpts : [[r.a, r.a], ...elOpts];
    const optsB = elOpts.some(([v]) => v === r.b) ? elOpts : [[r.b, r.b], ...elOpts];
    return `<tr><td>${sel(`${p}.a`, opts)}</td><td>${sel(`${p}.b`, optsB)}</td><td>${num(`${p}.dmin`, 'min="0" class="w-s"')}</td>
      <td><select data-b="${p}.penalty" data-t="penalty">${STRENGTH.map(([v, l]) => `<option value="${v}" ${+r.penalty === v ? "selected" : ""}>${l}</option>`).join("")}
        <option value="custom" ${known ? "" : "selected"}>custom…</option></select>
        ${known ? "" : num(`${p}.penalty`, 'min="0" class="w-s"') + ' <span class="hint">kT</span>'}</td>
      <td><button type="button" class="btn ghost" data-a="rule-del" data-v="${k}" aria-label="Remove rule">✕</button></td></tr>`;
  }).join("");
  const cr = lastReal && lastReal.contactReport;
  let check = '<p class="hint">Switch the rules on to see what they do in the preview crystal.</p>';
  if (con.enabled && !con.rules.length) check = '<p class="hint">Add a rule first.</p>';
  else if (con.enabled && !cr) check = '<p class="hint">No neighbouring occupants can come that close, so the rules never apply. Check the distances.</p>';
  else if (cr) {
    const nn = lastReal.n.join("×"), ok = cr.after === 0;
    const pairs = cr.pairs.slice().sort((x, y) => x.dist - y.dist);
    const shown = pairs.slice(0, 12).map(q => {
      let bad = 0; for (let i = 0; i < q.table.length; i++) if (q.table[i] > 0) bad++;
      return `<tr><td>${esc(S.sites[q.i].label)} → ${esc(S.sites[q.j].label)}</td><td class="num">[${q.t.join(" ")}]</td><td class="num">${fmt(q.dist, 3)} Å</td>
        <td class="num">${bad} of ${q.table.length}</td><td><div class="probbar" style="width:120px"><span style="width:${100 * bad / q.table.length}%;background:var(--err)"></span></div></td></tr>`;
    }).join("");
    const pop = S.sites.map((s, si) => {
      const cl = lastReal.classes[si]; if (cl.length < 2) return "";
      const groups = {};
      cl.forEach((c, k) => { const g = c.type === "molecule" ? (S.orientations.find(o => o.id === c.group) || {}).name || c.group : c.type === "atom" ? c.species : "vacancy";
        groups[g] = groups[g] || { prior: 0, now: 0, n: 0, used: 0 }; groups[g].prior += c.p; groups[g].now += cr.populations[si][k]; groups[g].n++; if (cr.populations[si][k] > 0) groups[g].used++; });
      return Object.entries(groups).map(([g, v]) => `<tr><td>${esc(s.label)}</td><td>${esc(g)}</td><td class="num">${fmt(v.prior, 3)}</td><td class="num">${fmt(v.now, 3)}</td><td class="num">${v.used} of ${v.n}</td></tr>`).join("");
    }).join("");
    check = `<div class="fields"><span class="chip ${ok ? "ok" : "warn"}"><span class="dot" style="background:currentColor"></span>${cr.before} → ${cr.after} close contacts</span>
        <span class="hint">in a random ${nn}-cell preview crystal, before and after ${Math.min(+corr.sweeps, 60)} sweeps${+corr.sweeps > 60 ? " (the script runs all " + corr.sweeps + ")" : ""}.</span></div>
      ${ok ? "" : '<p class="hint">Contacts remain. Try more sweeps, keep annealing on, or check that an arrangement without them exists (the closest neighbour pairs below show how many occupant combinations each rule excludes).</p>'}
      <h4 class="sub">Neighbour positions the rules act on</h4>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Sites</th><th>Cell offset</th><th>Centre distance</th><th>Excluded pairs</th><th></th></tr></thead><tbody>${shown}</tbody></table></div>
      ${pairs.length > 12 ? `<p class="hint">…and ${pairs.length - 12} more neighbour positions.</p>` : ""}
      <h4 class="sub">How often each occupant is chosen</h4>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Site</th><th>Occupant</th><th>Set in Sites</th><th>After the run</th><th>Orientations used</th></tr></thead><tbody>${pop}</tbody></table></div>`;
  }
  return head("Forbidden contacts", "Rules that keep atoms of neighbouring molecules or sites apart, for example no Br···Br closer than 3.8 Å. A Monte Carlo then picks the occupants and orientations so that these contacts are avoided, in the generated script and in the preview.") + `
  <div class="block"><h3>Rules ${chk("disorder.contacts.enabled", "on")}</h3>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Atom</th><th>Atom</th><th>Closer than (Å)</th><th>Strength</th><th></th></tr></thead><tbody>${rules || '<tr><td colspan="5" class="hint">No rules yet.</td></tr>'}</tbody></table></div>
    <div class="fields"><button type="button" class="btn small" data-a="rule-add">Add rule</button>
      <button type="button" class="btn small" data-a="rule-vdw">Suggest from van der Waals radii</button>
      ${field("Scale the sums by", `<input type="number" id="vdw-scale" step="0.05" min="0.5" max="1.2" value="${esc(S.disorder.contacts.vdw_scale || 1)}" class="w-s">`)}</div>
    <p class="hint">A contact is two atoms of different molecules or sites closer than the distance. Each one costs the penalty in kT: “forbidden” makes it practically impossible, “strong” and “mild” only make it rare. Contacts are checked at the ideal positions, before the rigid-body and atomic displacements of the Disorder step.</p></div>
  <div class="block"><h3>Monte Carlo run</h3>
    <div class="fields">${field("Sweeps", num("disorder.correlations.sweeps", 'step="1" class="w-s"'))}${field("kT", num("disorder.correlations.kT", 'class="w-s"'))}
      <span class="hint">shared with Correlated occupants</span></div>
    <div class="fields">${field("The run may change", sel("disorder.contacts.change", [["orientation", "orientations within each group"], ["group", "orientations and molecule groups"], ["none", "nothing: swap occupants only"]]))}
      ${chk("disorder.contacts.anneal", "Anneal (start at 10 kT and cool)")}</div>
    <p class="hint">“Orientations within each group” keeps the number of molecules of each group from the Sites step and lets each molecule pick another orientation of its group. “Orientations and molecule groups” also lets the group shares move, starting from the probabilities in Sites. “Swap only” keeps every occupant's count exactly and only exchanges occupants between cells. In all three the counts of atoms and vacancies stay fixed.</p></div>
  <div class="block"><h3>Check</h3>${check}</div>`;
};

// ---- 6 Monte Carlo (DISCUS mmc)
RENDER.mc = () => {
  const m = S.mmc, hasMol = S.sites.some(s => s.occupants.some(o => o.type === "molecule" && +o.p > 0));
  const siteOpts = S.sites.map((s, i) => [i + 1, `${i + 1} · ${s.label}`]);
  const sp = allSpecies().concat(S.sites.some(s => s.occupants.some(o => o.type === "vacancy")) ? ["VOID"] : []);
  const spOpts = sp.map(s => [s, s]);
  const nbs = m.neighborhoods.map((nb, k) => `<div class="site"><div class="site-head"><strong>Neighbourhood ${k + 1}</strong> ${chk(`mmc.neighborhoods.${k}.symmetric`, "add reversed vectors")}
      <span style="flex:1"></span><button type="button" class="btn ghost" data-a="nb-del" data-v="${k}">Delete</button></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>From site</th><th>To site</th><th>Cell offset</th><th></th></tr></thead><tbody>
    ${nb.vectors.map((v, j) => `<tr><td>${sel(`mmc.neighborhoods.${k}.vectors.${j}.origin`, siteOpts)}</td><td>${sel(`mmc.neighborhoods.${k}.vectors.${j}.target`, siteOpts)}</td>
      <td>${trio(`mmc.neighborhoods.${k}.vectors.${j}.t`, 'step="1" class="w-s"')}</td><td><button type="button" class="btn ghost" data-a="vec-del" data-v="${k}.${j}" aria-label="Remove">✕</button></td></tr>`).join("")}</tbody></table></div>
    <div class="fields"><button type="button" class="btn small" data-a="vec-add" data-v="${k}">Add vector</button><button type="button" class="btn small" data-a="vec-axes" data-v="${k}">Add ±a, ±b, ±c of site 1</button></div></div>`).join("");
  const tg = m.targets.map((t, k) => {
    const p = `mmc.targets.${k}`;
    const extra = t.type === "displacement" ? field("Direction (Cartesian)", trio(`${p}.direction`))
      : t.type === "spring" ? field("Distance (Å)", num(`${p}.distance`, 'class="w-s"')) + field("k", num(`${p}.k`, 'class="w-s"'))
      : t.type === "lennard_jones" ? field("Distance (Å)", num(`${p}.distance`, 'class="w-s"')) + field("Depth", num(`${p}.depth`, 'class="w-s"')) : "";
    const valued = t.type === "occupational" || t.type === "displacement";
    return `<div class="fields">${field("Type", sel(`${p}.type`, [["occupational", "occupational correlation"], ["displacement", "displacement correlation"], ["spring", "spring (size effect)"], ["lennard_jones", "Lennard-Jones"]]))}
      ${field("Neighbourhood", sel(`${p}.neighborhood`, m.neighborhoods.map((x, i) => [i, String(i + 1)])))}${field("A", sel(`${p}.a`, spOpts))}${field("B", sel(`${p}.b`, spOpts))}
      ${valued ? field("Given as", sel(`${p}.mode`, [["correlation", "target correlation"], ["energy", "fixed energy (kT)"]])) + field("Value", num(`${p}.value`, 'class="w-s"')) : ""}
      ${extra}<button type="button" class="btn ghost" data-a="tg-del" data-v="${k}">Remove</button></div>`;
  }).join("");
  return head("DISCUS Monte Carlo", "Optional DISCUS mmc run on the crystal before the scattering calculation, through discus-python's MCConfig. It adds chemical short-range order, correlated displacements or size effects.") +
    (hasMol ? `<div class="msg warn">This model contains molecules. DISCUS mmc moves single atoms, so it is only offered for atom-only models. Use “Correlated occupants” under Disorder for molecule orientations.</div>` : "") + `
  <div class="block"><h3>${chk("mmc.enabled", "Run DISCUS mmc", hasMol ? "disabled" : "")}</h3>
    <p class="hint">Sites are numbered as in the Sites step (DISCUS site = position in the cell). Acceptance is heat-bath, not Metropolis. A vacancy is the atom type VOID.</p>
    <div class="fields">${field("Moves per atom", num("mmc.moves_per_atom", 'class="w-s"'))}${field("Feedback per atom", num("mmc.feedback_per_atom", 'class="w-s"'))}${field("kT", num("mmc.temperature", 'class="w-s"'))}</div></div>
  <div class="block"><h3>Neighbourhoods <span class="grow"></span><button type="button" class="btn small" data-a="nb-add">Add neighbourhood</button></h3><div class="cards">${nbs || '<p class="hint">None yet.</p>'}</div></div>
  <div class="block"><h3>Targets <span class="grow"></span><button type="button" class="btn small" data-a="tg-add">Add target</button></h3>${tg || '<p class="hint">None yet.</p>'}
    <p class="hint">At most one target may use a correlation (DISCUS feedback); give the others fixed energies. Each neighbourhood holds one occupational and one displacement target.</p></div>
  <div class="block"><h3>Moves</h3><div class="fields">${field("Swap probability", num("mmc.moves.swap", 'class="w-s"'))}${field("Pairing", sel("mmc.moves.pairing", [["all", "all"], ["local", "local"], ["slocal", "slocal"], ["site", "site"]]))}
    ${field("Shift probability", num("mmc.moves.shift", 'class="w-s"'))}${field("Swap + displacement", num("mmc.moves.swap_displacement", 'class="w-s"'))}</div>
    <div class="fields">${sp.filter(s => s !== "VOID").map(s => field(`Shift σ ${esc(s)} (Å)`, `<input type="number" step="any" min="0" data-b="mmc.moves.shift_sigma.${esc(s)}" data-t="num" value="${esc(m.moves.shift_sigma[s] || 0)}">`)).join("")}</div></div>`;
};

// ---- 7 calculations
const WVL_NAMES = { moa1: "Mo Kα1", cua1: "Cu Kα1", aga1: "Ag Kα1", coa1: "Co Kα1", fea1: "Fe Kα1", cra1: "Cr Kα1", wa1: "W Kα1" };
const WVL_LIST = `<datalist id="wvl-syms">${Object.entries(WVL_NAMES).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</datalist>`;
function wvlInfo(w) {
  const s = String(w ?? "").trim(), x = DB.wavelengthValue(s);
  if (x == null) return "not a DISCUS symbol or a positive number";
  return DB.WAVELENGTH_SYMBOLS[s.toLowerCase()] ? `${s.toLowerCase()}${WVL_NAMES[s.toLowerCase()] ? ` (${WVL_NAMES[s.toLowerCase()]})` : ""} = ${x} Å` : `${x} Å`;
}
RENDER.calc = () => {
  const c = S.calc, f = c.fourier, p = c.pdf, A = lattice(), n = S.supercell.map(Number);
  const shape = f.steps.map((s, k) => 2 * Math.round(+f.hmax[k] / +s) + 1);
  const vox = shape.reduce((a, b) => a * b, 1);
  const ext = f.steps.map(s => 1 / (2 * +s)), res = f.hmax.map(h => 1 / (2 * +h));
  return head("Calculations", "What the generated script asks DISCUS 6.23.01 to compute, with discus-python's verified macros. Grids are centred on hkl = 0 so the 3D-ΔPDF is an exact FFT.") + `
  <div class="block"><h3>Running DISCUS</h3><div class="fields">${field("Command that runs a macro", txt("calc.launcher", 'class="w-xl"'))}${field("Time limit (s)", num("calc.timeout_s", 'class="w-s"'))}</div>
    <div class="fields"><button type="button" class="btn small" data-a="launcher" data-v="linux">Linux / WSL shell</button><button type="button" class="btn small" data-a="launcher" data-v="wsl">Windows → WSL</button>
      ${chk("calc.debye_waller", "Debye–Waller factor from the B values (temp use)")}</div>
    <p class="hint">The script appends <code>run.mac</code> to this command and starts it in each run folder. You can also pass <code>--launcher</code> when you run the script.</p></div>
  <div class="block"><h3>${chk("calc.fourier.enabled", "3D diffuse scattering")}</h3>
    <div class="fields">${field("Step Δh Δk Δl (r.l.u.)", trio("calc.fourier.steps"))}<button type="button" class="btn small" data-a="step-commensurate">1 / supercell</button>
      ${field("Range ± h k l", trio("calc.fourier.hmax"))}</div>
    <div class="fields">${field("Radiation", sel("calc.fourier.radiation", [["xray", "X-ray"], ["neutron", "neutron"]]))}
      ${field("λ (DISCUS symbol or Å)", txt("calc.fourier.wavelength", 'class="w-s" list="wvl-syms"'))}${WVL_LIST}</div>
    <p class="hint">The 3D runs write <code>disp off</code>, so λ only labels the output files; it does not change the intensities. The in-page preview always uses f = Z.</p>
    <div class="fields">${field("Bragg subtraction (set aver, %)", num("calc.fourier.aver_percent", 'min="0" max="100" class="w-s"'))}
      ${field("Friedel symmetry", sel("calc.fourier.symmetry", [["", "engine default"], ["friedel", "friedel"], ["ignore", "ignore"], ["apply", "apply"]]))}
      ${chk("calc.fourier.delta_pdf", "3D-ΔPDF from the diffuse volume")}${chk("calc.fourier.total", "Also total scattering + 3D-PDF (Patterson)")}</div>
    <dl class="facts"><dt>Grid</dt><dd>${shape.join(" × ")} = ${(vox / 1e6).toFixed(2)} M points</dd>
      <dt>3D-ΔPDF range</dt><dd>±${ext.map(x => fmt(x, 2)).join(", ± ")} cells${A ? ` (±${ext.map((x, k) => fmt(x * DB.norm(A[k]), 1)).join(", ±")} Å)` : ""}</dd>
      <dt>3D-ΔPDF voxel</dt><dd>${res.map(x => fmt(x, 3)).join(" × ")} cells${A ? ` (${res.map((x, k) => fmt(x * DB.norm(A[k]), 2)).join(" × ")} Å)` : ""}</dd>
      <dt>λ</dt><dd>${wvlInfo(f.wavelength)}</dd></dl>
    <details><summary>LOTS (average over sub-volumes)</summary><div class="fields" style="margin-top:8px">${chk("calc.fourier.lots.enabled", "use LOTS")}
      ${field("Shape", sel("calc.fourier.lots.shape", [["box", "box"], ["ellipsoid", "ellipsoid"]]))}${field("Size (cells)", trio("calc.fourier.lots.size", 'step="1" class="w-s"'))}
      ${field("Number", txt("calc.fourier.lots.count", 'class="w-s"'))}${chk("calc.fourier.lots.periodic", "periodic")}</div>
      <p class="hint">Number is a count or “all”. LOTS apply to the diffuse run only.</p></details></div>
  <div class="block"><h3>${chk("calc.pdf.enabled", "1D powder PDF")}</h3>
    <div class="fields">${field("Radiation", sel("calc.pdf.radiation", [["xray", "X-ray"], ["neutron", "neutron"]]))}${field("Qmin (Å⁻¹)", num("calc.pdf.qmin", 'class="w-s"'))}
      ${field("Qmax (Å⁻¹)", num("calc.pdf.qmax", 'class="w-s"'))}${field("ΔQ", num("calc.pdf.dq", 'class="w-s"'))}${field("Gaussian width (set delta)", num("calc.pdf.qsig", 'class="w-s"'))}
      ${field("λ (Å, empty = default)", txt("calc.pdf.wavelength", 'class="w-s"'))}</div>
    <div class="fields">${field("rmax (Å)", num("calc.pdf.rmax", 'class="w-s"'))}${field("Δr (Å)", num("calc.pdf.dr", 'class="w-s"'))}</div>
    <p class="hint">Computed by DISCUS's powder Debye sum over the disordered supercell (N² pairs), so long-range peaks are damped by the finite crystal size. DISCUS 6.23.01 caps Q at ≈ 12.3/λ.</p></div>`;
};

// ---- 8 script
RENDER.script = () => {
  const v = validation;
  let code = "", err = "";
  // export even with problems: they are listed above the buttons, and the script stops with a clear message if it cannot run
  try { code = DB.generateScript(withState(), TEMPLATE); } catch (e) { err = `The script cannot be written: ${e.message}`; }
  const lines = code ? code.split("\n").length : 0;
  return head("Python script", "One self-contained script: it rebuilds this model with numpy and discus-python, writes the DISCUS structure and runs the calculations. The model is embedded as JSON, so you can re-import the script here later.") + `
  ${v.errs.length && code ? `<div class="msg warn">The model has ${v.errs.length} problem${v.errs.length === 1 ? "" : "s"} (listed below). You can still export the script, but it, or DISCUS, may stop or give wrong results until they are fixed.</div>` : ""}
  ${msgs(v.errs, "err")}${msgs(v.warns, "warn")}${err ? msgs([err], "err") : ""}
  <div class="block"><h3>Export <span class="grow"></span></h3>
    <div class="fields"><button type="button" class="btn primary" data-a="dl-script" ${code ? "" : "disabled"}>Download ${esc(fileBase())}.py</button>
      <button type="button" class="btn" data-a="copy-script" ${code ? "" : "disabled"}>Copy script</button>
      <button type="button" class="btn" data-a="dl-json">Download model JSON</button>
      ${code ? `<span class="hint">${lines} lines</span>` : ""}</div>
    <div class="doc"><p>Run it where DISCUS_SUITE 6.23.01 and discus-python are installed:</p>
      <pre class="code">pip install "discuspdf[data] @ git+https://github.com/jmsweng/discus-python"
python ${esc(fileBase())}.py --dry-run        # build the crystal, stage the DISCUS inputs
python ${esc(fileBase())}.py --numpy-preview  # quick diffuse plane, no DISCUS needed
python ${esc(fileBase())}.py                  # full run</pre>
      <p>Results: <code>supercell.stru</code>, <code>supercell.xyz</code>, <code>diffuse.npz</code> and slice plots, <code>delta_pdf.npz</code> / <code>.vts</code>, <code>pdf_1d.txt</code>, and every DISCUS run folder with its macro and log.</p></div></div>
  ${code ? `<pre class="code" id="code">${esc(code)}</pre>` : ""}`;
};
const fileBase = () => (S.title || "model").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "model";
function withState() { return S; }

// ------------------------------------------------------------------------------------------ tooltips
const TIPS_B = [
  [/^title$/, "Name of the model; used for the script file name and DISCUS titles."],
  [/^seed$/, "Seeds every random choice in the script (occupants, displacements, DISCUS seeds). Same seed, same crystal."],
  [/^output_dir$/, "Folder the script writes into (relative to where you run it). --out overrides it."],
  [/^cell\.(a|b|c)$/, "Unit-cell edge length in Å."],
  [/^cell\.(alpha|beta|gamma)$/, "Unit-cell angle in degrees: α = b∧c, β = a∧c, γ = a∧b."],
  [/^supercell\.\d$/, "Number of unit cells along a, b, c. Larger crystals give smoother diffuse scattering but take longer."],
  [/^molecules\.\d+\.name$/, "Name shown in lists and in the script."],
  [/^molecules\.\d+\.anchor$/, "The point of the molecule placed exactly on the site position."],
  [/atoms\.\d+\.el$/, "Element symbol (DISCUS needs real element names, at most 4 characters)."],
  [/atoms\.\d+\.xyz\.\d$/, "Cartesian coordinate in Å, in the cell's frame (x ∥ a, y in the ab plane)."],
  [/^orientations\.\d+\.name$/, "Name of this orientation group, shown when a site picks a molecule."],
  [/^orientations\.\d+\.molecule$/, "The molecule these orientations are applied to."],
  [/^orientations\.\d+\.convention$/, "Order of the three rotation axes for the Euler angles (intrinsic, active rotations)."],
  [/^orientations\.\d+\.euler\.\d$/, "Euler angle in degrees giving the base orientation before symmetry operations."],
  [/^orientations\.\d+\.frame$/, "Crystal frame: operations rotate the already-oriented molecule about crystal axes. Molecule frame: operations act on the molecule before the base orientation."],
  [/^orientations\.\d+\.closure$/, "Combine the operations until they form a closed group (e.g. C4 + C3[111] → 24 rotations). Off: base orientation plus each operation once."],
  [/^orientations\.\d+\.ops$/, "One operation per line, e.g. C4 [0 0 1], m [1 -1 0], -1, R 30 [1 1 1] or -y,x,z."],
  [/^orientations\.\d+\.weights\.\d+$/, "Relative weight of this orientation within the group; 0 removes it."],
  [/^sites\.\d+\.label$/, "Site name (1–10 letters, digits or _)."],
  [/^sites\.\d+\.frac\.\d$/, "Fractional coordinate of the site in the unit cell."],
  [/^sites\.\d+\.b_iso$/, "Isotropic B (Å²) of atoms on this site; used only with Debye–Waller switched on."],
  [/^sites\.\d+\.draw$/, "Independent: each cell drawn separately, composition fluctuates. Exact: the crystal has exactly the given fractions, shuffled."],
  [/occupants\.\d+\.type$/, "What can occupy the site: an atom, a molecule from an orientation group, or nothing."],
  [/occupants\.\d+\.species$/, "Element symbol of the atom."],
  [/occupants\.\d+\.group$/, "Orientation group: the molecule takes one of the group's orientations, chosen by their weights."],
  [/occupants\.\d+\.p$/, "Probability of this occupant; the probabilities of a site add up to 1."],
  [/occupants\.\d+\.b$/, "B (Å²) for this occupant only; empty uses the site B."],
  [/^disorder\.correlations\.enabled$/, "Run the swap Monte Carlo that correlates neighbouring occupants."],
  [/^disorder\.correlations\.sweeps$/, "Swap attempts per cell and site, repeated this many times. More sweeps, closer to equilibrium."],
  [/^disorder\.correlations\.kT$/, "Temperature in the units of J. Smaller kT makes the correlations stronger."],
  [/^disorder\.correlations\.match$/, "Whether two molecules count as 'the same' only in the same orientation, or whenever they come from the same group."],
  [/interactions\.\d+\.site_a$/, "Site of the first occupant of the pair."],
  [/interactions\.\d+\.site_b$/, "Site of the neighbour."],
  [/interactions\.\d+\.t\.\d$/, "Cell offset from the first site's cell to the neighbour's cell (whole cells)."],
  [/interactions\.\d+\.J$/, "Energy (kT) when both hold the same occupant: negative favours like neighbours, positive unlike."],
  [/^disorder\.molecule_rigid\.translation_sigma$/, "Default Gaussian shift of each whole molecule (Å, per direction)."],
  [/^disorder\.molecule_rigid\.libration_sigma_deg$/, "Default Gaussian rotation of each molecule about a random axis (degrees)."],
  [/^disorder\.atomic_displacements\./, "Default Gaussian displacement of every atom of this element (Å, per direction)."],
  [/^disorder\.contacts\.enabled$/, "Use the contact rules in the Monte Carlo that places occupants and orientations."],
  [/^disorder\.contacts\.rules\.\d+\.(a|b)$/, "Element of one atom of the contact; 'any atom' matches every element."],
  [/^disorder\.contacts\.rules\.\d+\.dmin$/, "Two atoms of different molecules or sites closer than this (Å) count as a contact."],
  [/^disorder\.contacts\.rules\.\d+\.penalty$/, "Energy cost per contact in kT. Forbidden = 100 kT (never happens in practice), strong = 10, mild = 2."],
  [/^disorder\.contacts\.change$/, "What the Monte Carlo may change to avoid contacts: orientations within a group, orientations and the molecule group, or nothing (swaps only)."],
  [/^disorder\.contacts\.anneal$/, "Start at 10 × kT and cool to kT over the first 60 % of the sweeps; helps the run escape poor arrangements."],
  [/^disorder\.clash_threshold$/, "The script warns about atoms of different molecules or sites closer than this (Å)."],
  [/^mmc\.enabled$/, "Run DISCUS mmc on the built crystal before the scattering calculation (atom-only models)."],
  [/^mmc\.moves_per_atom$/, "Trial moves per atom (× atoms = DISCUS set cyc)."],
  [/^mmc\.feedback_per_atom$/, "How often (per atom) DISCUS reports and adjusts energies for correlation targets."],
  [/^mmc\.temperature$/, "kT in the energy units of the targets; keep 1 with correlation targets."],
  [/^mmc\.neighborhoods\.\d+\.symmetric$/, "Also add each vector in the opposite direction."],
  [/vectors\.\d+\.origin$/, "Site the vector starts from (DISCUS site number)."],
  [/vectors\.\d+\.target$/, "Site the vector points to."],
  [/vectors\.\d+\.t\.\d$/, "Cell offset of the target site (whole cells)."],
  [/targets\.\d+\.type$/, "Occupational: chemical short-range order. Displacement: correlated shifts. Spring / Lennard-Jones: size effect."],
  [/targets\.\d+\.neighborhood$/, "Which neighbourhood the target acts on."],
  [/targets\.\d+\.(a|b)$/, "Species of the pair the target acts on."],
  [/targets\.\d+\.mode$/, "Target correlation (DISCUS adjusts the energy to reach it) or a fixed energy."],
  [/targets\.\d+\.value$/, "Correlation in −1…1, or energy in kT."],
  [/targets\.\d+\.direction\.\d$/, "Direction of the correlated displacement (Cartesian)."],
  [/targets\.\d+\.distance$/, "Preferred pair distance (Å)."],
  [/targets\.\d+\.k$/, "Spring constant."],
  [/targets\.\d+\.depth$/, "Depth of the Lennard-Jones well."],
  [/^mmc\.moves\.swap$/, "Relative probability of swapping two atoms' species."],
  [/^mmc\.moves\.pairing$/, "Which atoms may be swapped: all, local neighbours, or same site."],
  [/^mmc\.moves\.shift$/, "Relative probability of moving one atom by a random shift."],
  [/^mmc\.moves\.swap_displacement$/, "Relative probability of swapping two atoms together with their displacements."],
  [/^mmc\.moves\.shift_sigma\./, "Size (Å) of the random shift for this element."],
  [/^calc\.launcher$/, "Command that starts DISCUS with a macro; the script adds run.mac and runs it in each run folder."],
  [/^calc\.timeout_s$/, "Stop a DISCUS run after this many seconds."],
  [/^calc\.debye_waller$/, "Apply each atom's B as a Debye–Waller factor (temp use). Off: B is ignored (temp ignore)."],
  [/^calc\.fourier\.enabled$/, "Compute the 3D diffuse scattering with DISCUS."],
  [/^calc\.fourier\.steps\.\d$/, "Grid step in reciprocal lattice units. 1/n (n = supercell size) avoids finite-size ripples; 1/(2·step) cells is the 3D-ΔPDF range."],
  [/^calc\.fourier\.hmax\.\d$/, "The grid runs from −range to +range. Larger range, finer 3D-ΔPDF voxels."],
  [/^calc\.fourier\.aver_percent$/, "Percentage of unit cells used for the average structure that DISCUS subtracts (set aver). 100 = Bragg peaks removed exactly, 0 = total scattering."],
  [/^calc\.fourier\.radiation$/, "X-ray or neutron scattering factors for the 3D runs (DISCUS xray / neut)."],
  [/^calc\.fourier\.wavelength$/, "DISCUS wavelength symbol (moa1, cua1, aga1, mob, …) or a number in Å. With disp off it only labels the files."],
  [/^calc\.fourier\.symmetry$/, "How DISCUS uses Friedel symmetry to save time; engine default merges Friedel pairs."],
  [/^calc\.fourier\.delta_pdf$/, "Fourier-transform the diffuse volume into the 3D-ΔPDF (discus-python's fractional FFT)."],
  [/^calc\.fourier\.total$/, "Second DISCUS run with the Bragg peaks kept, and its 3D-PDF (Patterson). Doubles the run time."],
  [/^calc\.fourier\.lots\.enabled$/, "Average the diffuse scattering over sub-volumes (LOTS) instead of the whole crystal."],
  [/^calc\.fourier\.lots\.shape$/, "Shape of each lot."],
  [/^calc\.fourier\.lots\.size\.\d$/, "Lot size in unit cells."],
  [/^calc\.fourier\.lots\.count$/, "Number of lots at random positions, or 'all' (one per cell)."],
  [/^calc\.fourier\.lots\.periodic$/, "Lots wrap around the crystal edges."],
  [/^calc\.pdf\.enabled$/, "Compute the 1D powder PDF of the supercell with DISCUS (Debye sum)."],
  [/^calc\.pdf\.radiation$/, "X-ray or neutron scattering factors."],
  [/^calc\.pdf\.qmin$/, "Lowest Q of the powder pattern (Å⁻¹)."],
  [/^calc\.pdf\.qmax$/, "Highest Q used in the PDF transform (Å⁻¹); DISCUS caps it at ≈ 12.3/λ."],
  [/^calc\.pdf\.dq$/, "Q step of the powder pattern (Å⁻¹)."],
  [/^calc\.pdf\.qsig$/, "Gaussian width of the powder pattern convolution (DISCUS set delta); 0 = none."],
  [/^calc\.pdf\.wavelength$/, "Wavelength in Å; empty uses 1.5406 (X-ray) or 1.54 (neutron)."],
  [/^calc\.pdf\.rmax$/, "Largest r of G(r) (Å)."],
  [/^calc\.pdf\.dr$/, "r step of G(r) (Å); rmax must be a whole number of steps."],
];
const TIPS_A = {
  "supercell": "Set the same number of cells along a, b and c.", "example": "Replace the current model with this example.",
  "mol-add": "Start a new molecule with one carbon atom.", "mol-select": "Edit this molecule.", "mol-dup": "Copy this molecule.",
  "mol-del": "Delete this molecule (only when no orientation group uses it).", "atom-add": "Add an atom at the origin.",
  "atom-del": "Remove this atom.", "atom-pick": "Highlight this atom in the view.", "mol-centre": "Shift the coordinates so the anchor is at 0, 0, 0.",
  "xyz-import": "Replace the atoms with the pasted 'Element x y z' lines.", "place-toggle": "Click in the view to add atoms of the element on the right.",
  "mol-view": "Look along this axis.", "grp-add": "Create a new orientation group.", "grp-select": "Edit this orientation group.",
  "grp-dup": "Copy this group.", "grp-del": "Delete this group (only when no site uses it).", "op-add": "Append this operation.",
  "mat-show": "Show the rotation matrix of this orientation.", "site-add": "Add a site to the unit cell.", "site-del": "Remove this site.",
  "occ-add": "Add an occupant with probability 0; then set its probability.", "occ-del": "Remove this occupant.",
  "occ-norm": "Scale the probabilities so they add up to 1.", "int-add": "Add a neighbour pair with an energy J.", "rule-add": "Add a contact rule.", "rule-del": "Remove this rule.",
  "rule-vdw": "Add a rule for every element pair that has a tabulated radius: minimum distance = sum of the van der Waals radii × the scale.",
  "int-axes": "Add pairs along +a, +b and +c (the reverse directions are included automatically).", "int-del": "Remove this pair.",
  "nb-add": "Add a DISCUS neighbourhood.", "nb-del": "Remove this neighbourhood and its targets.", "vec-add": "Add a neighbour vector.",
  "vec-axes": "Add vectors to the same site one cell along a, b and c.", "vec-del": "Remove this vector.", "tg-add": "Add an mmc target.",
  "tg-del": "Remove this target.", "launcher": "Fill in the usual command for this setup.", "step-commensurate": "Set the grid steps to 1/n₁, 1/n₂, 1/n₃.",
  "dl-script": "Save the Python script.", "copy-script": "Copy the script to the clipboard.", "dl-json": "Save the model as JSON (re-import it later).",
  "export": "Save the model as JSON (re-import it later).", "new-model": "Clear everything and start a new structure (asks first).",
  "new-confirm": "Clear the current model and start from one cubic cell with a single site.", "new-cancel": "Keep the current model.", "import": "Load a model from a JSON file or a script made by this page.",
  "reseed": "Draw another random crystal for the preview.", "cells": "Number of unit cells shown along each axis (1 = a single unit cell).", "color": "Colour the atoms by this property.",
  "diffuse": "Compute the diffuse plane in your browser.", "plane": "Reciprocal-lattice plane through the origin to compute.", "wy-pick": "Use this Wyckoff position.", "wy-add": "Add a site at every symmetry-equivalent position (positions that already hold a site are skipped).",
  "sym-clear": "Stop rotating molecules on this site; it then uses the orientation library as it is.", "sg-fit": "Set the lattice parameters to what this crystal system requires (keeps a, and c where it is free).", "set-copy": "Give every site generated from the same Wyckoff position these occupants, B and draw mode.", "plane-hkl": "Fill in u, v and the offset for this (h k l) plane and layer.",
  "plane-custom": "Highlighted when the plane is not one of the presets (other directions or a non-zero offset). Click to open the custom plane fields.",
};
const TIPS_ID = {
  "pv-range": "The plane runs from −range to +range in reciprocal lattice units.",
  "pv-n": "Size of each random preview crystal (cells per axis, at most the supercell).",
  "pv-d": "Number of independent random crystals averaged; more crystals, less speckle.",
  "vdw-scale": "Multiply the van der Waals sums by this (e.g. 0.9 to allow slightly closer contacts).",
  "pv-n-0": "Plane by indices: all points H with h·n₁ + k·n₂ + l·n₃ = layer, i.e. the reciprocal-space plane perpendicular to the real-space direction [n₁ n₂ n₃] (for cubic cells: perpendicular to [h k l]*). (1 1 1) with layer 0 is the (111) section through the origin.",
  "pv-L": "Which parallel layer: 0 goes through the origin, 1 through the next layer of reciprocal-lattice points, fractions in between.",
  "sg-sel": "Space group in its standard setting (monoclinic: unique axis b; origin choice 2; rhombohedral groups on hexagonal axes).",
  "wy-x": "Free coordinate of the Wyckoff position (fraction of the cell).", "wy-y": "Free coordinate of the Wyckoff position (fraction of the cell).", "wy-z": "Free coordinate of the Wyckoff position (fraction of the cell).",
  "wy-prefix": "New sites are labelled prefix_1, prefix_2, …", "wy-occ": "Give the new sites a single atom, or copy the occupants (atoms, molecules, vacancies) of an existing site.",
  "wy-el": "Element of the atom placed on every new site.", "wy-rot": "Turn each copied molecule by the symmetry operation that generates its position.", "wy-copy": "Site whose occupants are copied to the new sites.",
  "pv-u-0": "First in-plane direction u (h k l). Plotted to the right.", "pv-v-0": "Second in-plane direction v (h k l). Plotted upwards.",
  "pv-origin-0": "Offset of the plane from the origin (h k l), e.g. 0 0 0.5 for the hk½ layer.",
  "tpl": "Replace the atoms with a template molecule.", "place-el": "Element placed by Draw atoms.", "xyz-in": "One atom per line: Element x y z (Å).",
};
["u", "v", "origin", "n"].forEach(k => [1, 2].forEach(i => { TIPS_ID[`pv-${k}-${i}`] = TIPS_ID[`pv-${k}-0`]; }));
function applyTips(root) {
  $$("[data-b]", root).forEach(el => {
    const hit = TIPS_B.find(([re]) => re.test(el.dataset.b));
    if (!hit) return;
    const host = el.closest("label.f, label.chk") || el;
    if (!host.title) host.title = hit[1];
    if (!el.title) el.title = hit[1];
  });
  $$("[data-a]", root).forEach(el => { if (!el.title && TIPS_A[el.dataset.a]) el.title = TIPS_A[el.dataset.a]; });
  Object.entries(TIPS_ID).forEach(([id, t]) => { const el = root.querySelector ? root.querySelector("#" + id) : null; if (el) { el.title = t; const l = el.closest("label.f"); if (l) l.title = t; } });
}

// ------------------------------------------------------------------------------------------ actions
const ACT = {
  "supercell": el => { const k = +el.dataset.v; S.supercell = [k, k, k]; commit(); },
  "new-model": () => { const b = $("#confirm-new"); b.hidden = !b.hidden; if (!b.hidden) $('[data-a="new-cancel"]').focus(); },
  "new-cancel": () => { $("#confirm-new").hidden = true; },
  "new-confirm": () => {
    $("#confirm-new").hidden = true;
    S = EX.blank.make(); S.title = "New structure";
    molSel = undefined; grpSel = undefined; atomSel = -1; placing = false; previewSeed = 0;
    wy = { letter: null, free: { x: 0.1, y: 0.2, z: 0.3 }, prefix: "", occ: "atom", el: "C", copy: 0, rotate: true };
    section = "cell"; renderRail(); commit(); window.scrollTo(0, 0); toast("New structure: one cubic cell with a single site");
  },
  "example": el => { S = EX[el.dataset.v].make(); molSel = S.molecules[0] && S.molecules[0].id; grpSel = S.orientations[0] && S.orientations[0].id; previewSeed = 0; commit(); toast("Example loaded"); },
  "mol-add": () => { const id = uid("m"); S.molecules.push({ id, name: "New molecule", anchor: "centroid", atoms: [{ el: "C", xyz: [0, 0, 0] }] }); molSel = id; commit(); },
  "mol-select": el => { molSel = el.dataset.v; atomSel = -1; renderSection(); },
  "mol-dup": () => { const m = S.molecules.find(x => x.id === molSel); const c = JSON.parse(JSON.stringify(m)); c.id = uid("m"); c.name += " copy"; S.molecules.push(c); molSel = c.id; commit(); },
  "mol-del": () => {
    const used = S.orientations.some(g => g.molecule === molSel);
    if (used) { toast("Delete the orientation groups that use this molecule first"); return; }
    S.molecules = S.molecules.filter(x => x.id !== molSel); molSel = S.molecules[0] && S.molecules[0].id; commit();
  },
  "atom-add": () => { const m = S.molecules.find(x => x.id === molSel); m.atoms.push({ el: placeEl || "C", xyz: [0, 0, 0] }); atomSel = m.atoms.length - 1; commit(); },
  "atom-del": el => { const m = S.molecules.find(x => x.id === molSel); m.atoms.splice(+el.dataset.v, 1); if (typeof m.anchor === "number" && m.anchor >= m.atoms.length) m.anchor = "centroid"; atomSel = -1; commit(); },
  "atom-pick": el => { atomSel = +el.dataset.v; renderSection(); },
  "mol-centre": () => { const m = S.molecules.find(x => x.id === molSel); const loc = DB.moleculeLocal(m); m.atoms.forEach((a, i) => { a.xyz = loc.xyz[i].map(x => +x.toFixed(4)); }); commit(); },
  "xyz-import": () => {
    const m = S.molecules.find(x => x.id === molSel); const lines = $("#xyz-in").value.split("\n").map(l => l.trim()).filter(Boolean);
    const atoms = [];
    for (const l of lines) { const p = l.split(/[\s,]+/); if (p.length >= 4 && DB.elementOf(p[0]) && p.slice(1, 4).every(x => isFinite(+x))) atoms.push({ el: DB.elementOf(p[0]), xyz: p.slice(1, 4).map(Number) }); }
    if (!atoms.length) { toast("No “Element x y z” lines found"); return; }
    m.atoms = atoms; m.anchor = "centroid"; commit(); toast(`${atoms.length} atoms read`);
  },
  "place-toggle": () => { placing = !placing; const e = $("#place-el"); if (e) placeEl = e.value.trim() || "C"; renderSection(); },
  "mol-view": el => { const A = lattice(); if (!molViewer) return; if (el.dataset.v === "z") molViewer.viewAlong([0, 0, 1], [0, 1, 0]); else molViewer.viewAlong([1, 0, 0], [0, 0, 1]); window._molR = molViewer.R; void A; },
  "grp-add": () => {
    if (!S.molecules.length) { toast("Build a molecule first"); return; }
    const id = uid("g"); S.orientations.push({ id, name: "New group", molecule: (S.molecules.find(m => m.id === molSel) || S.molecules[0]).id, convention: "ZYZ", euler: [0, 0, 0], ops: "", frame: "lab", closure: true, weights: [] });
    grpSel = id; commit();
  },
  "grp-select": el => { grpSel = el.dataset.v; renderSection(); },
  "grp-dup": () => { const g = S.orientations.find(x => x.id === grpSel); const c = JSON.parse(JSON.stringify(g)); c.id = uid("g"); c.name += " copy"; S.orientations.push(c); grpSel = c.id; commit(); },
  "grp-del": () => {
    if (S.sites.some(s => s.occupants.some(o => o.type === "molecule" && o.group === grpSel))) { toast("A site still uses this group"); return; }
    S.orientations = S.orientations.filter(x => x.id !== grpSel); grpSel = S.orientations[0] && S.orientations[0].id; commit();
  },
  "op-add": el => { const g = S.orientations.find(x => x.id === grpSel); g.ops = (g.ops.trim() ? g.ops.trim() + "\n" : "") + el.dataset.v; commit(); },
  "mat-show": el => {
    const g = S.orientations.find(x => x.id === grpSel), mol = S.molecules.find(x => x.id === g.molecule);
    const R = DB.expandGroup(g, mol, lattice()).orientations[+el.dataset.v].R;
    const box = $("#matbox"); box.hidden = false;
    box.textContent = `Orientation #${+el.dataset.v + 1}, Cartesian rotation matrix (applied to the molecule's coordinates):\n` + R.map(r => r.map(x => (x >= 0 ? " " : "") + x.toFixed(6)).join("  ")).join("\n") + `\ndet = ${DB.det(R).toFixed(6)}`;
  },
  "wy-pick": el => { wy.letter = el.dataset.v; wy.prefix = ""; wy.lastSet = null; wy.repeat = false; renderSection(); },
  "sg-fit": () => { S.cell = DB.fitCell(+S.spacegroup.n, S.cell); commit(); toast("Cell adjusted to the crystal system"); },
  "wy-add": () => {
    const sg = SG.find(g => g.n === +S.spacegroup.n), w = sg && sg.w.find(q => q[0] === wy.letter); if (!w) return;
    const pos = DB.wyckoffOrbitOps(sg, w[3], wy.free);
    const prefix = (($("#wy-prefix") || {}).value || defaultPrefix(w)).replace(/[^A-Za-z0-9_]/g, "").slice(0, 7) || "S";
    const src = wy.occ === "copy" ? S.sites[+wy.copy] : null;
    const el = (wy.el || "C").trim();
    if (!src && !DB.elementOf(el)) { toast(`“${el}” is not an element symbol`); return; }
    const setId = uid("w"), label = `${sg.n} ${sg.s} ${w[1]}${w[0]}`;
    let added = 0, k = 0;
    const used = new Set(S.sites.map(s => s.label));
    const rotate = !!src && wy.rotate;
    pos.forEach(({ p, op }) => {
      if (S.sites.some(s => s.frac.every((v, i) => { const d = Math.abs((((+v - p[i]) % 1) + 1) % 1); return Math.min(d, 1 - d) < 1e-4; }))) return;
      let lab; do { k++; lab = `${prefix}_${k}`.slice(0, 10); } while (used.has(lab)); used.add(lab);
      const sym = rotate ? op.split(",").map(q => q.replace(/[+-]?\d+(\/\d+)?$/, "").replace(/^\+/, "") || "0").join(",") : "";
      S.sites.push({ label: lab, frac: p.slice(), b_iso: src ? src.b_iso : 1, draw: src ? src.draw : "random", set: setId, wyckoff: label,
        ...(sym && sym !== "x,y,z" ? { sym } : {}),
        occupants: src ? JSON.parse(JSON.stringify(src.occupants)) : [{ type: "atom", species: el, p: 1, b: "" }] });
      added++;
    });
    if (!added) { wy.repeat = true; renderSection(); toast("These positions already hold sites; nothing was added"); return; }
    wy.lastSet = setId; wy.repeat = false;
    commit(); toast(`${added} site${added === 1 ? "" : "s"} added from ${label}`);
  },
  "sym-clear": el => { delete S.sites[+el.dataset.v].sym; commit(); toast("This site now uses the library orientations unchanged"); },
  "set-copy": el => {
    const s = S.sites[+el.dataset.v]; let n = 0;
    S.sites.forEach(x => { if (x !== s && x.set === s.set) { x.occupants = JSON.parse(JSON.stringify(s.occupants)); x.b_iso = s.b_iso; x.draw = s.draw; n++; } });
    commit(); toast(`Occupants copied to ${n} site${n === 1 ? "" : "s"}`);
  },
  "site-add": () => { S.sites.push({ label: "S" + (S.sites.length + 1), frac: [0, 0, 0], b_iso: 1, draw: "random", occupants: [{ type: "atom", species: "C", p: 1, b: "" }] }); commit(); },
  "site-del": el => { const i = +el.dataset.v; S.sites.splice(i, 1);
    S.disorder.correlations.interactions = S.disorder.correlations.interactions.filter(it => +it.site_a !== i && +it.site_b !== i).map(it => ({ ...it, site_a: +it.site_a > i ? +it.site_a - 1 : +it.site_a, site_b: +it.site_b > i ? +it.site_b - 1 : +it.site_b }));
    commit(); },
  "occ-add": el => {
    const [si, type] = el.dataset.v.split("."); const s = S.sites[+si];
    const o = type === "atom" ? { type, species: "C", p: 0, b: "" } : type === "molecule" ? { type, group: (S.orientations[0] || {}).id || "", p: 0, b: "" } : { type, p: 0 };
    s.occupants.push(o); commit();
  },
  "occ-del": el => { const [si, oi] = el.dataset.v.split(".").map(Number); S.sites[si].occupants.splice(oi, 1); commit(); },
  "occ-norm": el => { const s = S.sites[+el.dataset.v]; const t = s.occupants.reduce((a, o) => a + (+o.p || 0), 0); if (t > 0) s.occupants.forEach(o => { o.p = +((+o.p || 0) / t).toFixed(6); }); commit(); },
  "rule-add": () => { const sp = allSpecies().map(e => DB.elementOf(e) || e); const e = sp.includes("Br") ? "Br" : sp[sp.length - 1] || "any";
    S.disorder.contacts.rules.push({ a: e, b: e, dmin: +((DB.VDW[e] || 1.7) * 2).toFixed(2), penalty: 100 }); S.disorder.contacts.enabled = true; commit(); },
  "rule-del": el => { S.disorder.contacts.rules.splice(+el.dataset.v, 1); commit(); },
  "rule-vdw": () => {
    const f = +($("#vdw-scale") || {}).value || 1; S.disorder.contacts.vdw_scale = f;
    const sp = [...new Set(allSpecies().map(e => DB.elementOf(e) || e))].filter(e => DB.VDW[e]);
    const missing = [...new Set(allSpecies().map(e => DB.elementOf(e) || e))].filter(e => !DB.VDW[e]);
    let added = 0;
    sp.forEach((a, i) => sp.slice(i).forEach(b => {
      const d = +((DB.VDW[a] + DB.VDW[b]) * f).toFixed(2), r = S.disorder.contacts.rules.find(x => (x.a === a && x.b === b) || (x.a === b && x.b === a));
      if (r) r.dmin = d; else { S.disorder.contacts.rules.push({ a, b, dmin: d, penalty: 100 }); added++; }
    }));
    S.disorder.contacts.enabled = true; commit();
    toast(`${added} rule${added === 1 ? "" : "s"} added${missing.length ? `; no radius for ${missing.join(", ")}` : ""}`);
  },
  "int-add": () => { S.disorder.correlations.interactions.push({ site_a: 0, site_b: 0, t: [1, 0, 0], J: -0.5 }); S.disorder.correlations.enabled = true; commit(); },
  "int-axes": () => { [[1, 0, 0], [0, 1, 0], [0, 0, 1]].forEach(t => S.disorder.correlations.interactions.push({ site_a: 0, site_b: 0, t, J: -0.5 })); S.disorder.correlations.enabled = true; commit(); },
  "int-del": el => { S.disorder.correlations.interactions.splice(+el.dataset.v, 1); commit(); },
  "nb-add": () => { S.mmc.neighborhoods.push({ vectors: [{ origin: 1, target: 1, t: [1, 0, 0] }], symmetric: true }); commit(); },
  "nb-del": el => { S.mmc.neighborhoods.splice(+el.dataset.v, 1); S.mmc.targets = S.mmc.targets.filter(t => +t.neighborhood !== +el.dataset.v); commit(); },
  "vec-add": el => { S.mmc.neighborhoods[+el.dataset.v].vectors.push({ origin: 1, target: 1, t: [0, 1, 0] }); commit(); },
  "vec-axes": el => { const nb = S.mmc.neighborhoods[+el.dataset.v]; [[1, 0, 0], [0, 1, 0], [0, 0, 1]].forEach(t => nb.vectors.push({ origin: 1, target: 1, t })); commit(); },
  "vec-del": el => { const [k, j] = el.dataset.v.split(".").map(Number); S.mmc.neighborhoods[k].vectors.splice(j, 1); commit(); },
  "tg-add": () => { const sp = allSpecies(); S.mmc.targets.push({ type: "occupational", neighborhood: 0, a: sp[0] || "Cu", b: sp[1] || sp[0] || "Au", mode: "energy", value: 0.5, direction: [1, 0, 0], distance: 2.5, k: 1, depth: 1 }); commit(); },
  "tg-del": el => { S.mmc.targets.splice(+el.dataset.v, 1); commit(); },
  "launcher": el => { S.calc.launcher = el.dataset.v === "wsl" ? "wsl.exe -d Ubuntu-22.04 -- bash -lc 'discus_suite -noautorun -macro \"$0\"'" : "discus_suite -noautorun -macro"; commit(); },
  "plane-custom": () => { const d = $(".custom-plane"); d.open = true; d.scrollIntoView({ block: "nearest", behavior: "smooth" }); },
  "plane-hkl": () => {
    const nrm = [0, 1, 2].map(i => +$(`#pv-n-${i}`).value || 0), L = +$("#pv-L").value || 0, Al = lattice();
    if (!Al) { toast("Fix the unit cell first"); return; }
    try {
      const p = DB.zonePlane(Al, nrm, L);
      Object.assign(S.calc.preview, { u: p.u, v: p.v, origin: p.origin, normal: nrm, layer: L });
      save(); renderBenchControls(); markDiffuseStale();
      toast(`(${nrm.join(" ")}) layer ${L}: u = [${p.u.join(" ")}], v = [${p.v.join(" ")}]. Press Compute.`);
    } catch (e) { toast(e.message); }
  },
  "step-commensurate": () => { S.calc.fourier.steps = S.supercell.map(n => +(1 / +n).toFixed(10)); commit(); },
  "dl-script": () => { try { download(`${fileBase()}.py`, DB.generateScript(withState(), TEMPLATE), "text/x-python"); } catch (e) { toast(e.message); } },
  "copy-script": () => copyText(DB.generateScript(withState(), TEMPLATE)),
  "dl-json": () => download(`${fileBase()}.json`, JSON.stringify({ schema: "discuspdf-disorder-builder-state", version: 1, state: S }, null, 1), "application/json"),
  "export": () => ACT["dl-json"](),
  "import": () => $("#file-in").click(),
  "paper-open": () => { section = "paper"; placing = false; renderRail(); renderSection(); window.scrollTo(0, 0); },
  "paper-copy": () => copyText(PAPER.buildPrompt(PP.notes), "Prompt copied", "#paper-prompt"),
  "paper-dl": () => download(PROMPT_FILE, PAPER.promptMarkdown(PP.notes), "text/markdown"),
  "paper-read": () => {
    PP.reply = ($("#paper-reply") || {}).value || PP.reply; savePaper();
    const ex = PAPER.extractJson(PP.reply);
    PP.result = ex.json ? PAPER.fromPaper(ex.json) : { errors: [ex.error], warnings: [], review: [], state: null };
    renderSection();
    const box = $(".ptbl") || $("#editor .msg"); if (box) box.scrollIntoView({ block: "nearest", behavior: "smooth" });
  },
  "paper-fix": () => copyText(PAPER.fixMessage(PP.result.errors), "Message copied: paste it into the chat"),
  "paper-clear": () => { PP.reply = ""; PP.result = null; savePaper(); renderSection(); },
  "paper-load": () => {
    const r = PP.result; if (!r || !r.state) return;
    S = upgrade(JSON.parse(JSON.stringify(r.state))); S.paper.notes = PP.notes.trim();
    molSel = S.molecules[0] && S.molecules[0].id; grpSel = S.orientations[0] && S.orientations[0].id; previewSeed = 0; atomSel = -1;
    wy = { letter: null, free: { x: 0.1, y: 0.2, z: 0.3 }, prefix: "", occ: "atom", el: "C", copy: 0, rotate: true };
    section = "cell"; renderRail(); commit(); window.scrollTo(0, 0); toast("Model loaded from the paper: check each step");
  },
  "reseed": () => { previewSeed++; updatePreview(); },
  "cells": el => { cellsShown = +el.dataset.v; drawCrystal(); $$('[data-a="cells"]').forEach(b => b.setAttribute("aria-pressed", String(+b.dataset.v === cellsShown))); },
  "color": el => { colorMode = el.dataset.v; drawCrystal(); $$('[data-a="color"]').forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === colorMode))); },
  "diffuse": () => (diffuseRunning ? cancelDiffuse() : runDiffuse()),
  "plane": el => { const q = presetPlanes().list.find(x => x.k === el.dataset.v); if (!q) return; const P = [q.u, q.v];
    S.calc.preview.u = P[0].slice(); S.calc.preview.v = P[1].slice(); S.calc.preview.origin = [0, 0, 0]; save(); renderBenchControls(); markDiffuseStale(); },
};
function download(name, text, type) {
  try {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast(`Downloading ${name}. If nothing arrives, use Copy instead.`);
  } catch (e) { toast("Download blocked here; use Copy instead"); }
}
function copyText(t, done = "Script copied", boxSel = "#code") {
  const fallback = () => {
    const box = $(boxSel); if (box) { const d = box.closest("details"); if (d) d.open = true; const r = document.createRange(); r.selectNodeContents(box); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
    toast(box ? "Selected: press Ctrl/⌘+C to copy" : "Copy is blocked here; use the download instead");
  };
  try { navigator.clipboard.writeText(t).then(() => toast(done), fallback); } catch (e) { fallback(); }
}
let toastT;
function toast(m) { let el = $("#toast"); el.textContent = m; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, 2600); }

// ------------------------------------------------------------------------------------------ events
document.addEventListener("change", e => {
  const el = e.target;
  if (el.id === "file-in") { importFile(el.files[0]); el.value = ""; return; }
  if (el.id === "sg-sel") { S.spacegroup = { n: +el.value || 0 }; wy.letter = null; wy.lastSet = null; wy.repeat = false; save(); renderSection(); return; }
  if (/^wy-/.test(el.id)) {
    if (/^wy-[xyz]$/.test(el.id)) { wy.lastSet = null; wy.repeat = false; }
    if (/^wy-[xyz]$/.test(el.id)) wy.free[el.id.slice(3)] = +el.value || 0;
    else if (el.id === "wy-prefix") wy.prefix = el.value;
    else if (el.id === "wy-occ") wy.occ = el.value;
    else if (el.id === "wy-el") wy.el = el.value.trim();
    else if (el.id === "wy-copy") wy.copy = +el.value;
    else if (el.id === "wy-rot") wy.rotate = el.checked;
    renderSection(); return;
  }
  if (/^pv-(u|v|origin)-\d$/.test(el.id)) {
    const [, k, i] = /^pv-(u|v|origin)-(\d)$/.exec(el.id); const x = +el.value;
    S.calc.preview[k][+i] = isFinite(x) ? x : 0;
    if (S.calc.preview.u.every(q => q === 0) || S.calc.preview.v.every(q => q === 0)) toast("u and v must not be zero vectors");
    save(); renderBenchControls(); markDiffuseStale(); return;
  }
  if (el.id === "pv-range" || el.id === "pv-n" || el.id === "pv-d") { S.calc.preview.range = +$("#pv-range").value || 4; S.calc.preview.n = +$("#pv-n").value || 8; S.calc.preview.draws = +$("#pv-d").value || 4; save(); renderBenchControls(); markDiffuseStale(); return; }
  const path = el.dataset.b; if (!path) return;
  let v = el.value;
  const t = el.dataset.t;
  if (t === "num") { v = el.value === "" ? 0 : +el.value; if (!isFinite(v)) v = 0; }
  else if (t === "numornull") v = el.value === "" ? "" : +el.value;
  else if (t === "bool") v = el.checked;
  else if (t === "penalty") v = el.value === "custom" ? 5 : +el.value;
  if (path.endsWith(".type") && path.includes(".occupants.")) {
    const o = getPath(path.replace(/\.type$/, ""));
    if (v === "atom" && !o.species) o.species = "C";
    if (v === "molecule" && !o.group) o.group = (S.orientations[0] || {}).id || "";
  }
  if (path.endsWith(".group") && path.includes("disorder") === false) { /* group changes keep their weights */ }
  setPath(path, v);
  if (path === "orientations." + S.orientations.findIndex(g => g.id === grpSel) + ".ops" || /\.(closure|frame|euler\.\d|molecule|convention)$/.test(path)) {
    const g = S.orientations.find(x => x.id === grpSel); if (g && /orientations\.\d+\.(ops|closure|frame|molecule)$/.test(path)) g.weights = [];
  }
  commit();
});
document.addEventListener("input", e => {
  const el = e.target;
  if (el.id === "paper-notes") { PP.notes = el.value; savePaper(); const pr = $("#paper-prompt"); if (pr) pr.textContent = PAPER.buildPrompt(PP.notes); }
  else if (el.id === "paper-reply") { PP.reply = el.value; savePaper(); }
});
document.addEventListener("click", e => {
  const s = e.target.closest("[data-sec]");
  if (s) { section = s.dataset.sec; placing = false; renderRail(); renderSection(); window.scrollTo(0, 0); return; }
  const a = e.target.closest("[data-a]");
  if (a && ACT[a.dataset.a] && !a.disabled) { e.preventDefault(); ACT[a.dataset.a](a); }
});
function importFile(file) {
  if (!file) return;
  const rd = new FileReader();
  rd.onload = () => {
    try {
      let text = String(rd.result), obj;
      const m = /CONFIG_JSON = r"""\s*([\s\S]*?)\s*"""/.exec(text);
      obj = JSON.parse(m ? m[1] : text);
      const st = obj.state || obj.builder_state || (obj.cell && obj.sites && obj.calc && obj.disorder && Array.isArray(obj.molecules) ? obj : null);
      if (!st) throw new Error("this file holds no builder model");
      S = upgrade(st); molSel = S.molecules[0] && S.molecules[0].id; grpSel = S.orientations[0] && S.orientations[0].id;
      commit(); toast("Model imported");
    } catch (err) { toast(`Could not import: ${err.message}`); }
  };
  rd.readAsText(file);
}

// ------------------------------------------------------------------------------------------ preview bench
let crystalViewer = null, previewTimer = null;
function schedulePreview() { clearTimeout(previewTimer); previewTimer = setTimeout(updatePreview, 250); }
function previewN() { const pn = +S.calc.preview.n || 8; return S.supercell.map(x => Math.max(1, Math.min(+x || 1, pn))); }
function updatePreview() {
  if (validation.errs.some(e => /cell|Supercell|probabilit|orientation group|not an element/i.test(e))) { $("#xstats").textContent = "Fix the problems listed under Script to see the preview."; return; }
  try { lastReal = DB.realize(S, { n: previewN(), seed: (+S.seed || 1) + 7919 * previewSeed, maxSweeps: 60 }); }
  catch (e) { $("#xstats").textContent = e.message; return; }
  drawCrystal();
  if (section === "disorder" || section === "contacts") { const y = window.scrollY; renderSection(); window.scrollTo(0, y); }
}
const ORI = ["#0d6a80", "#d9822b", "#5f9e3a", "#9b59b6", "#c0392b", "#2c7fb8", "#c9a227", "#16a085", "#e67e22", "#7f8c8d", "#8e44ad", "#27ae60"];
function drawCrystal() {
  if (!crystalViewer || !lastReal) return;
  const { atoms, A } = lastReal, k = cellsShown;
  const sub = atoms.filter(a => a.cell[0] < k && a.cell[1] < k && a.cell[2] < k);
  const groups = S.orientations.map(g => g.id);
  const color = a => {
    if (colorMode === "element") return DB.colorOf(a.el);
    if (colorMode === "site") return ORI[a.site % ORI.length];
    if (a.mol < 0) return "#9aa7ad";
    return ORI[(groups.indexOf(a.group) * 3 + a.orient) % ORI.length];
  };
  const mols = {};
  sub.forEach((a, i) => { if (a.mol >= 0) (mols[a.mol] = mols[a.mol] || []).push(i); });
  const bonds = [];
  Object.values(mols).forEach(ix => { for (let x = 0; x < ix.length; x++) for (let y = x + 1; y < ix.length; y++) {
    const p = sub[ix[x]], q = sub[ix[y]], d = DB.norm(DB.sub(p.p, q.p));
    if (d < DB.covOf(p.el) + DB.covOf(q.el) + 0.45) bonds.push([ix[x], ix[y]]);
  } });
  const lines = [], O = [0, 0, 0], a = DB.scale(A[0], k), b = DB.scale(A[1], k), c = DB.scale(A[2], k);
  const corners = [[O, a], [O, b], [O, c], [a, DB.add(a, b)], [a, DB.add(a, c)], [b, DB.add(a, b)], [b, DB.add(b, c)], [c, DB.add(a, c)], [c, DB.add(b, c)], [DB.add(a, b), DB.add(DB.add(a, b), c)], [DB.add(a, c), DB.add(DB.add(a, b), c)], [DB.add(b, c), DB.add(DB.add(a, b), c)]];
  corners.forEach(([p, q]) => lines.push([p, q, null, 0.5, 1]));
  crystalViewer.set({ atoms: sub.map(x => ({ p: x.p, color: color(x), r: 0.12 + 0.13 * DB.covOf(x.el) })), bonds, lines, axes: A,
    center: DB.scale(DB.add(DB.add(a, b), c), 0.5) });
  // legend + stats
  const comp = {};
  atoms.forEach(x => { comp[x.el] = (comp[x.el] || 0) + 1; });
  const nc = lastReal.n.reduce((p, q) => p * q, 1);
  let legend = "";
  if (colorMode === "element") legend = Object.keys(comp).map(e => `<span><span class="dot" style="background:${DB.colorOf(e)}"></span>${esc(e)}</span>`).join("");
  else if (colorMode === "site") legend = S.sites.map((s, i) => `<span><span class="dot" style="background:${ORI[i % ORI.length]}"></span>${esc(s.label)}</span>`).join("");
  else {
    const otab = DB.orientationTable(S, A);
    const tabs = Object.values(otab), total = tabs.reduce((a, t) => a + t.orientations.length, 0);
    legend = (total <= 12
      ? tabs.flatMap(t => t.orientations.map((o, k2) => `<span><span class="dot" style="background:${ORI[(groups.indexOf(t.group.id) * 3 + k2) % ORI.length]}"></span>${esc(t.group.name)} #${k2 + 1}</span>`))
      : tabs.map(t => `<span>${t.orientations.slice(0, 6).map((o, k2) => `<span class="dot" style="background:${ORI[(groups.indexOf(t.group.id) * 3 + k2) % ORI.length]}"></span>`).join("")}${esc(t.group.name)} (${t.orientations.length} orientations)</span>`)
    ).join("") + `<span><span class="dot" style="background:#9aa7ad"></span>atoms</span>`;
  }
  $("#xlegend").innerHTML = legend;
  $("#xstats").innerHTML = `${lastReal.n.join("×")} preview cells · ${(atoms.length / nc).toFixed(2)} atoms/cell · ${lastReal.nMolecules} molecules<br>` +
    Object.entries(comp).map(([e, c2]) => `${esc(e)} ${(c2 / nc).toFixed(3)}`).join(" · ") + " per cell";
}

// diffuse
let diffuseJob = 0, diffuseRunning = null;
function markDiffuseStale() {
  // a model change makes a running preview meaningless (and its crystals a different size): stop it
  if (diffuseRunning) {
    diffuseJob++; diffuseRunning = null; setDiffuseButton(false);
    const st = $("#dstate"); if (st) delete st.dataset.running;
  }
  const s = $("#dstate"); if (s) s.textContent = "Model changed: compute again to update.";
}
// Preset planes for the preview, chosen from the shape of the cell. Each plane goes through the origin.
// hk0 / h0l / 0kl are the layers perpendicular to the real-space axes c / b / a in every cell.
function cellSystem(c) {
  const eq = (x, y) => Math.abs(+x - +y) < 1e-4, r90 = k => eq(c[k], 90);
  if (eq(c.a, c.b) && eq(c.b, c.c) && r90("alpha") && r90("beta") && r90("gamma")) return "cubic";
  if (eq(c.a, c.b) && r90("alpha") && r90("beta") && eq(c.gamma, 120)) return "hexagonal";
  if (eq(c.a, c.b) && eq(c.b, c.c) && eq(c.alpha, c.beta) && eq(c.beta, c.gamma)) return "rhombohedral";
  if (eq(c.a, c.b) && r90("alpha") && r90("beta") && r90("gamma")) return "tetragonal";
  if (r90("alpha") && r90("beta") && r90("gamma")) return "orthorhombic";
  if (r90("alpha") && r90("gamma")) return "monoclinic";
  return "triclinic";
}
function presetPlanes() {
  const sys = cellSystem(S.cell), A = lattice();
  const zone = n => { try { const z = DB.zonePlane(A, n, 0); return [z.u, z.v]; } catch (e) { return null; } };
  const p = (k, u, v, tip) => ({ k, u, v, tip });
  const H = [1, 0, 0], K = [0, 1, 0], L = [0, 0, 1];
  const base = {
    cubic: [p("hk0", H, K, "l = 0: contains a* and b*, perpendicular to c. One of the three equivalent cube-face sections (4-fold symmetry)."),
      p("h0l", H, L, "k = 0: contains a* and c*, perpendicular to b. Equivalent to hk0 in a cubic crystal; useful to check for lost symmetry."),
      p("0kl", K, L, "h = 0: contains b* and c*, perpendicular to a. Equivalent to hk0 in a cubic crystal.")],
    tetragonal: [p("hk0", H, K, "l = 0: the basal plane, contains a* and b*, perpendicular to the 4-fold axis c."),
      p("h0l", H, L, "k = 0: contains a* and c*; a vertical plane through the 4-fold axis."),
      p("0kl", K, L, "h = 0: contains b* and c*; equivalent to h0l in a tetragonal crystal.")],
    hexagonal: [p("hk0", H, K, "l = 0: the basal plane, contains a* and b* (60° apart), perpendicular to c; shows the 6-fold (or 3-fold) symmetry."),
      p("h0l", H, L, "k = 0: contains a* and c*; one of the two kinds of vertical plane through the c axis."),
      p("0kl", K, L, "h = 0: contains b* and c*; equivalent to h0l by the hexagonal symmetry.")],
    rhombohedral: [p("hk0", H, K, "l = 0: contains a* and b*, perpendicular to the real-space c axis of the rhombohedral cell."),
      p("h0l", H, L, "k = 0: contains a* and c*, perpendicular to the real-space b axis."),
      p("0kl", K, L, "h = 0: contains b* and c*, perpendicular to the real-space a axis.")],
    orthorhombic: [p("hk0", H, K, "l = 0: contains a* and b*, perpendicular to c."),
      p("h0l", H, L, "k = 0: contains a* and c*, perpendicular to b."),
      p("0kl", K, L, "h = 0: contains b* and c*, perpendicular to a.")],
    monoclinic: [p("h0l", H, L, "k = 0: contains a* and c* (at 180° − β), perpendicular to the unique axis b. The mirror plane of the monoclinic diffraction pattern."),
      p("hk0", H, K, "l = 0: contains a* and b* (at 90°), perpendicular to the real-space c axis."),
      p("0kl", K, L, "h = 0: contains b* and c* (at 90°), perpendicular to the real-space a axis.")],
    triclinic: [p("hk0", H, K, "l = 0: contains a* and b*, perpendicular to the real-space c axis (not to c*)."),
      p("h0l", H, L, "k = 0: contains a* and c*, perpendicular to the real-space b axis."),
      p("0kl", K, L, "h = 0: contains b* and c*, perpendicular to the real-space a axis.")],
  }[sys];
  const extra = [];
  if (sys === "cubic") {
    extra.push(p("hhl", [1, 1, 0], L, "Contains [110]* and c*: the diagonal mirror plane, with the ⟨001⟩, ⟨110⟩ and ⟨111⟩ directions in one picture."));
    const z = zone([1, 1, 1]); if (z) extra.push(p("(111)", z[0], z[1], "h + k + l = 0: the plane perpendicular to the 3-fold axis [111], containing the three ⟨1-10⟩* directions; shows 6-fold symmetry."));
  }
  if (sys === "tetragonal") extra.push(p("hhl", [1, 1, 0], L, "Contains [110]* and c*: the diagonal vertical mirror plane of tetragonal symmetry, at 45° to h0l."));
  if (sys === "hexagonal") extra.push(p("hhl", [1, 1, 0], L, "Contains [110]* and c*. [110]* lies halfway between a* and b*, so this is the second kind of vertical plane through c, at 30° to h0l."));
  if (sys === "rhombohedral") { const z = zone([1, 1, 1]); if (z) extra.push(p("(111)", z[0], z[1], "h + k + l = 0: the plane perpendicular to the 3-fold axis [111] of the rhombohedral cell.")); }
  return { sys, list: base.concat(extra) };
}
function renderBenchControls() {
  const pv = S.calc.preview;
  if (!pv.origin) pv.origin = [0, 0, 0];
  const key = JSON.stringify([pv.u.map(Number), pv.v.map(Number)]), atOrigin = pv.origin.every(x => +x === 0);
  const pp = presetPlanes();
  const preset = atOrigin ? (pp.list.find(q => JSON.stringify([q.u, q.v]) === key) || {}).k : null;
  // rebuild the buttons only when the set of presets changes; replacing them while a field blurs would swallow the click
  const box = $("#planes"), sig = pp.sys + ":" + pp.list.map(q => q.k).join(",");
  if (box.dataset.sig !== sig) {
    box.dataset.sig = sig;
    box.innerHTML = pp.list.map(q => `<button type="button" class="btn small" data-a="plane" data-v="${esc(q.k)}" title="${esc(`${q.tip} u = [${q.u.join(" ")}], v = [${q.v.join(" ")}].`)}">${esc(q.k)}</button>`).join("") +
      `<button type="button" class="btn small" data-a="plane-custom">custom</button>`;
    box.title = `Preset planes for a ${pp.sys} cell (from the lattice parameters).`;
  }
  $$("button", box).forEach(b => b.setAttribute("aria-pressed", String(b.dataset.a === "plane-custom" ? !preset : b.dataset.v === preset)));
  $("#pv-range").value = pv.range; $("#pv-n").value = pv.n || 8; $("#pv-d").value = pv.draws || 4;
  ["u", "v", "origin"].forEach(k => [0, 1, 2].forEach(i => { $(`#pv-${k}-${i}`).value = pv[k][i]; }));
  if (pv.normal) { [0, 1, 2].forEach(i => { $(`#pv-n-${i}`).value = pv.normal[i]; }); $("#pv-L").value = pv.layer || 0; }
  $("#pinfo").textContent = planeInfo();
  applyTips($("#planes"));
}
// how the preview plane relates to the DISCUS grid of the Calculations step, and whether it is commensurate
function planeInfo() {
  const pv = S.calc.preview; if (!pv.origin) pv.origin = [0, 0, 0];
  const u = pv.u.map(Number), v = pv.v.map(Number), o = pv.origin.map(Number);
  const n = previewN(), notes = [];
  const isInt = x => Math.abs(x - Math.round(x)) < 1e-9;
  if (![...u, ...v].every(isInt)) notes.push("u or v is not a whole-number vector, so the points are not commensurate with the crystal: expect ripples.");
  if (!o.every((x, k) => isInt(x * n[k]))) notes.push(`The offset is not a multiple of 1/${n.join(", 1/")} (the preview crystal), so it falls between allowed points: expect ripples.`);
  const unit = w => { const nz = w.map((x, k) => [x, k]).filter(([x]) => x !== 0); return nz.length === 1 && nz[0][0] === 1 ? nz[0][1] : -1; };
  const i = unit(u), j = unit(v), f = S.calc.fourier;
  if (i < 0 || j < 0 || i === j) notes.push("Oblique plane: it is not one slice of the DISCUS 3D grid; compare it by eye.");
  else {
    const k = 3 - i - j, hkl = "hkl";
    if (o[i] || o[j]) notes.push("An offset within the plane only shifts the window; the DISCUS slices are centred on 0.");
    const step = +f.steps[k], idx = o[k] / step, half = Math.round(+f.hmax[k] / step);
    if (!f.enabled) notes.push(`Same cut as the ${hkl[k]} = ${fmt(o[k], 4)} slice of a 3D grid (3D diffuse is switched off).`);
    else if (!isInt(idx)) notes.push(`${hkl[k]} = ${fmt(o[k], 4)} is not on the DISCUS grid (step ${fmt(step, 4)} along ${hkl[k]}).`);
    else if (Math.abs(idx) > half) notes.push(`${hkl[k]} = ${fmt(o[k], 4)} is outside the DISCUS grid (±${fmt(+f.hmax[k], 3)}).`);
    else notes.push(`Same cut as the ${hkl[k]} = ${fmt(o[k], 4)} slice of the 3D diffuse volume from DISCUS (index ${Math.round(idx) + half} of ${2 * half + 1} along its ${hkl[k]} axis).`);
  }
  return notes.join(" ");
}
function setDiffuseButton(running) {
  const b = $("#dbtn"); if (!b) return;
  b.textContent = running ? "Cancel" : "Compute";
  b.classList.toggle("primary", !running);
  b.title = running ? "Stop the calculation and keep the average of the crystals finished so far." : TIPS_A.diffuse;
}
function cancelDiffuse() {
  if (!diffuseRunning) return;
  diffuseJob++;
  const { done, draws } = diffuseRunning();
  diffuseRunning = null; setDiffuseButton(false);
  const st = $("#dstate"); delete st.dataset.running;
  st.textContent = done ? `Cancelled after ${done} of ${draws} crystals; the plot shows their average.` : "Cancelled before the first crystal finished.";
}
function runDiffuse() {
  const job = ++diffuseJob;
  const pv = S.calc.preview, draws = Math.max(1, Math.min(16, +pv.draws || 4));
  let real, plane, P, sum, geom = null, d = 0, a = 0, natoms = 0;
  const st = $("#dstate"), bar = $("#dprog span");
  const t0 = performance.now();
  const start = () => {
    real = DB.realize(S, { n: previewN(), seed: (+S.seed || 1) + 7919 * previewSeed + 104729 * d, maxSweeps: 60 });
    plane = DB.diffusePlaneRows(real, { u: pv.u, v: pv.v, origin: pv.origin, range: +pv.range || 4 });
    if (!geom) geom = { ...DB.planeGeometry(real.A, pv.u, pv.v), u: pv.u.slice(), v: pv.v.slice(), origin: (pv.origin || [0, 0, 0]).slice() };
    if (!sum) { P = plane.P; sum = new Float64Array(P * P); }
    natoms = real.atoms.length; a = 0;
  };
  try { start(); } catch (e) { toast(e.message); return; }
  st.dataset.running = "1"; st.textContent = `Computing ${P}×${P} points, ${draws} random crystals of ${natoms} atoms…`;
  diffuseRunning = () => ({ done: d, draws }); setDiffuseButton(true);
  const step = () => {
    if (job !== diffuseJob) return;
    const tEnd = performance.now() + 30;
    while (a < P && performance.now() < tEnd) { const r = plane.row(a); for (let b = 0; b < P; b++) sum[a * P + b] += r[b]; a++; }
    bar.style.width = `${100 * (d * P + a) / (draws * P)}%`;
    if (a >= P) { d++; drawHeat(Float64Array.from(sum, x => x / d), P, plane.t, geom); if (d < draws) { start(); } }
    if (d < draws) requestAnimationFrame(step);
    else { diffuseRunning = null; setDiffuseButton(false); delete st.dataset.running; st.textContent = `Average of ${draws} random ${real.n.join("×")} crystals (${natoms} atoms each), ${((performance.now() - t0) / 1000).toFixed(1)} s. f = Z, no Debye–Waller: a shape check, not the DISCUS result.`; }
  };
  requestAnimationFrame(step);
}
function magma(t) {
  if (!isFinite(t)) t = 0;
  const st = [[0, 0, 4], [40, 11, 84], [101, 21, 110], [159, 42, 99], [212, 72, 66], [245, 125, 21], [250, 193, 39], [252, 253, 191]];
  t = Math.max(0, Math.min(1, t)) * (st.length - 1); const i = Math.min(st.length - 2, Math.floor(t)), f = t - i;
  return st[i].map((x, k) => x + (st[i + 1][k] - x) * f);
}
// Draws the plane with its true shape: each grid point is a parallelogram spanned by the reciprocal vectors of
// u and v (Å⁻¹), so angles and relative lengths are correct; u points to the right.
let lastHeat = null;
function drawHeat(img, P, t, geom) {
  lastHeat = { img, P, t, geom };
  const vals = Array.from(img).filter(x => x > 0).sort((x, y) => x - y);
  const vmax = vals.length ? vals[Math.floor(0.995 * (vals.length - 1))] : 1;
  const off = document.createElement("canvas"); off.width = P; off.height = P;
  const og = off.getContext("2d"), id = og.createImageData(P, P);
  for (let a = 0; a < P; a++) for (let b = 0; b < P; b++) {
    const v = img[a * P + b], c = magma(Math.sqrt(Math.max(0, v) / (vmax || 1)));
    const o = 4 * ((P - 1 - b) * P + a);
    id.data[o] = c[0]; id.data[o + 1] = c[1]; id.data[o + 2] = c[2]; id.data[o + 3] = 255;
  }
  og.putImageData(id, 0, 0);
  const cv = $("#dcv"), g = cv.getContext("2d");
  const W = Math.max(300, Math.round(cv.clientWidth * Math.min(2, window.devicePixelRatio || 1))) || 600;
  cv.width = W; cv.height = W;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--view").trim() || "#f7f9f9";
  g.fillRect(0, 0, W, W);
  const step = t[1] - t[0], t0 = t[0], { u2, v2 } = geom;
  // plane position (Å⁻¹) of grid indices (a, b); pixel (px, py) of the off-screen image has a = px, b = P-1-py
  const pos = (a, b) => [(t0 + a * step) * u2[0] + (t0 + b * step) * v2[0], (t0 + a * step) * u2[1] + (t0 + b * step) * v2[1]];
  const corners = [pos(-0.5, -0.5), pos(P - 0.5, -0.5), pos(-0.5, P - 0.5), pos(P - 0.5, P - 0.5)];
  const xs = corners.map(c => c[0]), ys = corners.map(c => c[1]);
  const pad = 30 * (W / 600), sc = Math.min((W - 2 * pad) / (Math.max(...xs) - Math.min(...xs)), (W - 2 * pad) / (Math.max(...ys) - Math.min(...ys)));
  const cx = W / 2 - sc * (Math.max(...xs) + Math.min(...xs)) / 2, cy = W / 2 + sc * (Math.max(...ys) + Math.min(...ys)) / 2;
  const scr = p => [cx + sc * p[0], cy - sc * p[1]];
  const p00 = pos(-0.5, P - 0.5);                      // corner of pixel (0, 0)
  g.imageSmoothingEnabled = false;
  g.setTransform(sc * step * u2[0], -sc * step * u2[1], -sc * step * v2[0], sc * step * v2[1], cx + sc * p00[0], cy - sc * p00[1]);
  g.drawImage(off, 0, 0);
  g.setTransform(1, 0, 0, 1, 0, 0);
  // unit arrows along u and v from the plane's own origin (t = 0, 0), and a 1 Å⁻¹ scale bar
  const o = scr(pos(-t0 / step, -t0 / step)), ink = "#ffffff", lw = Math.max(1.5, W / 300);
  const arrow = (vec, label) => {
    const e = [o[0] + sc * vec[0], o[1] - sc * vec[1]], ang = Math.atan2(e[1] - o[1], e[0] - o[0]), h = 8 * W / 600;
    g.strokeStyle = ink; g.fillStyle = ink; g.lineWidth = lw; g.beginPath(); g.moveTo(o[0], o[1]); g.lineTo(e[0], e[1]); g.stroke();
    g.beginPath(); g.moveTo(e[0], e[1]); g.lineTo(e[0] - h * Math.cos(ang - 0.4), e[1] - h * Math.sin(ang - 0.4)); g.lineTo(e[0] - h * Math.cos(ang + 0.4), e[1] - h * Math.sin(ang + 0.4)); g.fill();
    g.font = `${12 * W / 600}px ui-monospace, monospace`; g.fillText(label, e[0] + 4, e[1] - 4);
  };
  const lab = v => `[${v.map(x => fmt(+x, 3)).join(" ")}]`;
  arrow(u2, lab(geom.u)); arrow(v2, lab(geom.v));
  const ink2 = getComputedStyle(document.documentElement).getPropertyValue("--muted").trim() || "#567";
  g.strokeStyle = ink2; g.fillStyle = ink2; g.lineWidth = lw;
  const bx = pad, by = W - pad / 2.5; g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + sc, by); g.stroke();
  g.font = `${11 * W / 600}px ui-monospace, monospace`; g.fillText("1 Å⁻¹", bx + sc + 6, by + 4);
  const offTxt = (geom.origin || [0, 0, 0]).some(x => +x) ? ` · offset ${lab(geom.origin)}` : "";
  $("#daxes").innerHTML = `<span>u ${lab(geom.u)} → · v ${lab(geom.v)} at ${fmt(geom.angle, 1)}°${offTxt}</span><span>±${fmt(-t0, 2)} r.l.u.</span>`;
}

// ------------------------------------------------------------------------------------------ boot
function boot() {
  renderRail();
  try { validation = DB.validate(S); } catch (e) { validation = { errs: [e.message], warns: [] }; }
  renderStatus();
  renderSection();
  crystalViewer = new Viewer($("#xcv"), { aspect: 0.85 });
  $$('[data-a="cells"]').forEach(b => b.setAttribute("aria-pressed", String(+b.dataset.v === cellsShown)));
  $$('[data-a="color"]').forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === colorMode)));
  renderBenchControls();
  applyTips(document);
  updatePreview();
  setTimeout(runDiffuse, 400);
  if (window.matchMedia) window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { drawCrystal(); if (lastHeat) drawHeat(lastHeat.img, lastHeat.P, lastHeat.t, lastHeat.geom); if (molViewer) drawMolecule(); });
}
boot();
})();
