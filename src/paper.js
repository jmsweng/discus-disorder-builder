/* Start a model from a paper.
   1. buildPrompt(notes) gives a prompt the user pastes, with the paper's PDF, into a chatbot (Claude, ChatGPT, ...).
   2. The chatbot answers with a "paper extract" JSON (schema below): what the paper reports, each number with its source.
   3. extractJson(reply) finds that JSON in the reply; fromPaper(extract) turns it into a builder model plus a review list.
   The chatbot only transcribes what the paper says. All geometry (symmetry expansion, orientation matrices) is done here. */
(function (root) {
"use strict";
const isNode = typeof module !== "undefined" && module.exports;
const DB = isNode ? require("./core.js") : root.DB;
const EX = isNode ? require("./examples.js") : root.DB_EXAMPLES;
const SG = (isNode ? require("./spacegroups.js") : root.DB_SG) || [];

const SCHEMA = "disorder-builder-paper-extract";
const VERSION = 1;
const STATUSES = ["reported", "derived", "assumed", "user"];

// point groups on standard Cartesian axes (principal axis along z = c; secondary 2-fold or mirror normal along x = a)
const POINT_GROUPS = {
  C1: [], Ci: ["-1"], C2: ["C2 <0 0 1>"], Cs: ["m <0 0 1>"], C2h: ["C2 <0 0 1>", "-1"],
  D2: ["C2 <0 0 1>", "C2 <1 0 0>"], C2v: ["C2 <0 0 1>", "m <1 0 0>"], D2h: ["C2 <0 0 1>", "C2 <1 0 0>", "-1"],
  C4: ["C4 <0 0 1>"], S4: ["S4 <0 0 1>"], C4h: ["C4 <0 0 1>", "-1"], D4: ["C4 <0 0 1>", "C2 <1 0 0>"], C4v: ["C4 <0 0 1>", "m <1 0 0>"],
  D2d: ["S4 <0 0 1>", "C2 <1 0 0>"], D4h: ["C4 <0 0 1>", "C2 <1 0 0>", "-1"],
  C3: ["C3 <0 0 1>"], S6: ["C3 <0 0 1>", "-1"], D3: ["C3 <0 0 1>", "C2 <1 0 0>"], C3v: ["C3 <0 0 1>", "m <1 0 0>"], D3d: ["C3 <0 0 1>", "C2 <1 0 0>", "-1"],
  C6: ["C6 <0 0 1>"], C3h: ["S3 <0 0 1>"], C6h: ["C6 <0 0 1>", "-1"], D6: ["C6 <0 0 1>", "C2 <1 0 0>"], C6v: ["C6 <0 0 1>", "m <1 0 0>"],
  D3h: ["C3 <0 0 1>", "C2 <1 0 0>", "m <0 0 1>"], D6h: ["C6 <0 0 1>", "C2 <1 0 0>", "-1"],
  T: ["C2 <0 0 1>", "C3 <1 1 1>"], Th: ["C2 <0 0 1>", "C3 <1 1 1>", "-1"], O: ["C4 <0 0 1>", "C3 <1 1 1>"],
  Td: ["S4 <0 0 1>", "C3 <1 1 1>"], Oh: ["C4 <0 0 1>", "C3 <1 1 1>", "-1"],
};
const HM = { "1": "C1", "-1": "Ci", "2": "C2", "m": "Cs", "2/m": "C2h", "222": "D2", "mm2": "C2v", "mmm": "D2h", "4": "C4", "-4": "S4",
  "4/m": "C4h", "422": "D4", "4mm": "C4v", "-42m": "D2d", "4/mmm": "D4h", "3": "C3", "-3": "S6", "32": "D3", "3m": "C3v", "-3m": "D3d",
  "6": "C6", "-6": "C3h", "6/m": "C6h", "622": "D6", "6mm": "C6v", "-6m2": "D3h", "6/mmm": "D6h", "23": "T", "m-3": "Th", "432": "O",
  "-43m": "Td", "m-3m": "Oh" };
function pointGroupOps(name) {
  const k = String(name || "").trim().replace(/\s+/g, "");
  const key = POINT_GROUPS[k] ? k : HM[k.toLowerCase()] || Object.keys(POINT_GROUPS).find(q => q.toLowerCase() === k.toLowerCase());
  return key ? { key, ops: POINT_GROUPS[key] } : null;
}

// ---------------------------------------------------------------------------------- prompt
const EXAMPLE = `{
  "schema": "${SCHEMA}", "version": ${VERSION},
  "paper": { "title": "...", "authors": "First Author et al.", "year": 2025, "doi": "10.xxxx/xxxxx" },
  "material": "short name or formula of the phase",
  "conditions": "temperature, pressure, sample (as in the paper)",
  "summary": "Three to five plain sentences: the average structure and the disorder the paper describes.",
  "cell": { "a": { "value": 3.30, "source": "Table 1", "status": "reported" }, "b": { "value": 3.30, "source": "cubic", "status": "derived" },
            "c": { "value": 3.30, "source": "cubic", "status": "derived" }, "alpha": 90, "beta": 90, "gamma": 90 },
  "space_group": { "symbol": "Im-3m", "number": 229, "source": "p. 2" },
  "sites_are": "asymmetric_unit",
  "sites": [
    { "label": "O1", "frac": { "value": [0, 0, 0], "source": "Table 1", "status": "reported" },
      "occupants": [
        { "type": "atom", "element": "Na", "occupancy": { "value": 0.85, "source": "Table S2", "status": "reported" },
          "b_iso": { "value": 1.2, "source": "Table S2", "status": "reported" } },
        { "type": "vacancy", "occupancy": { "value": 0.15, "source": "1 − occupancy of Na", "status": "derived" } },
        { "type": "molecule", "molecule": "water", "orientation_group": "S-type",
          "occupancy": { "value": 0.74, "source": "Fig. 4b", "status": "reported" } }
      ] }
  ],
  "molecules": [
    { "name": "water", "anchor_atom": 1, "geometry_source": "TIP4P/2005 model, Methods", "atoms": [
        { "element": "O", "xyz": [0, 0, 0] }, { "element": "H", "xyz": [0.7572, 0.5865, 0] }, { "element": "H", "xyz": [-0.7572, 0.5865, 0] } ] }
  ],
  "orientation_groups": [
    { "name": "S-type", "molecule": "water", "description": "both O–H bonds point to cube corners on one face diagonal",
      "source": "Fig. 3a",
      "primary": { "from_atom": 1, "to_midpoint_of": [2, 3], "along": [0, 0, 1] },
      "secondary": { "from_atom": 2, "to_atom": 3, "towards": [1, 1, 0] },
      "symmetry": "Oh" }
  ],
  "displacements": {
    "atom_sigma_A": { "O": { "value": 0.08, "source": "assumed small static offset", "status": "assumed" } },
    "molecule_translation_sigma_A": 0, "molecule_libration_sigma_deg": { "value": 12, "source": "MD, Fig. S5", "status": "derived" } },
  "short_range_order": [
    { "description": "neighbouring molecules avoid the same orientation", "site_a": "O1", "site_b": "O1", "cell_offset": [1, 0, 0],
      "tendency": "unlike", "strength": "moderate", "source": "Fig. 5" } ],
  "forbidden_contacts": [ { "element_a": "H", "element_b": "H", "min_distance_A": { "value": 1.5, "source": "p. 4", "status": "reported" } } ],
  "experiment": { "radiation": "neutron", "wavelength_A": { "value": 0.71, "source": "Methods", "status": "reported" } },
  "assumptions": ["Every assumption you made, one sentence each."],
  "not_representable": ["Parts of the paper's model this format cannot hold (e.g. a modulation wave, magnetic order)."],
  "questions_for_user": ["Anything you could not decide that the user should check."]
}`;

function buildPrompt(notes) {
  const n = String(notes || "").trim();
  return `You will help a scientist turn the crystal structure reported in the attached paper into a model for the DISCUS Disorder Builder (https://jmsweng.github.io/discus-disorder-builder/), which builds disordered crystal models for diffuse-scattering and PDF calculations.

Read the whole paper, including its supplementary information and any attached CIF files. Then reply with ONE JSON object in a single \`\`\`json code block, following the format below. A short note before the code block is fine, but put nothing after it.

YOUR JOB IS TO TRANSCRIBE, NOT TO CALCULATE
- Report the unit cell, space group and atom sites as the paper (or its CIF) gives them. The builder applies the space-group symmetry and computes all orientation matrices itself.
- Never compute Euler angles or rotation matrices. Describe each preferred molecular orientation with directions (see "orientation_groups").

NUMBERS AND SOURCES
- Every number may be written plainly or as { "value": ..., "source": "...", "status": "..." }. Use the long form for every number that matters: cell, coordinates, occupancies, B or U values, displacements, distances, wavelengths.
- "source" says where it came from: "Table 2", "p. 5", "Fig. 3 caption", "Table S4", "CIF", "user note".
- "status" is one of: "reported" (stated in the paper or CIF), "derived" (calculated by you from reported values; say how in "source"), "assumed" (not in the paper; your reasonable choice), "user" (from the user's notes below).
- Never mark a guessed value as "reported". If the paper does not give something the model needs, choose a sensible value, mark it "assumed" and add a sentence to "assumptions".
- Units: Å for lengths, degrees for angles, Å² for B and U. Coordinates are fractions of the unit cell. Write numbers as JSON numbers, not strings. No comments in the JSON.

FORMAT RULES
- "space_group": Hermann–Mauguin symbol and number in the ITA standard setting (monoclinic unique axis b, origin choice 2, rhombohedral groups on hexagonal axes). If the paper uses another setting, convert the cell and coordinates to the standard setting, mark them "derived" and say so in "assumptions". If there is no space group, use null.
- "sites_are": "asymmetric_unit" when you list one position per Wyckoff site (the builder then generates all equivalent positions), "all_positions" when you list every position in the unit cell yourself (then space_group may be null).
- "sites": one entry per crystallographic site. List everything that can sit on the same position as occupants of that one site: atoms, molecules and vacancies. Occupancies of a site add up to 1 (a missing remainder is read as vacancy). Give "b_iso", or "u_iso" (U = B/8π²), per atom occupant when reported. Labels: 1–8 letters, digits or _.
- When the paper models a disordered molecule as several partially occupied atoms (split positions), prefer a "molecule" occupant if the paper itself describes molecules in a few preferred orientations; otherwise keep the split atoms as atom occupants.
- "molecules": rigid molecules with Cartesian atom coordinates in Å in any frame of your choice (atom numbers 1, 2, 3 ... in the order listed). Take bond lengths and angles from the paper; otherwise use standard values, say which in "geometry_source", and list them in "assumptions". "anchor_atom" is the number of the atom placed on the site (or "centroid").
- "orientation_groups": each group is one family of symmetry-equivalent orientations, all equally likely. Give:
    "primary": a direction in the molecule ("from_atom" + "to_atom", or "from_atom" + "to_midpoint_of": [atom, atom], or "vector": [x, y, z] in your molecule frame) and the crystal direction it points along: "along": [u, v, w] (lattice direction, as in [111]) or "along_cartesian": [x, y, z] (x ∥ a, y in the ab plane).
    "secondary" (needed unless the molecule is linear along "primary"): a second molecule direction and the crystal direction it turns towards ("towards" or "towards_cartesian"); only its part perpendicular to "primary" counts.
    "symmetry": the point group whose operations generate the family from that one orientation, as a Schoenflies or Hermann–Mauguin symbol on standard axes (principal axis ∥ c; for cubic groups the cube axes), e.g. "Oh", "m-3m", "D4h", "-3m"; or "operations": a list such as ["C4 [0 0 1]", "C3 [1 1 1]", "-1"] ("Cn [u v w]" rotation, "m [u v w]" mirror normal, "-1" inversion, "R 30 [u v w]" rotation by degrees). Usually this is the site symmetry of the molecule's position.
    Families with different probabilities are separate groups; their probabilities are the "occupancy" values of the molecule occupants on the site.
- "displacements": static (frozen) Gaussian disorder used to build the model: "atom_sigma_A" per element (σ per direction, Å; from a reported U use σ = √U and mark it "derived"), "molecule_translation_sigma_A", "molecule_libration_sigma_deg".
- "short_range_order": correlations between neighbouring occupants that the paper describes. "cell_offset" is the whole-cell offset from site_a to site_b; "tendency" is "like" (same occupants/orientations cluster) or "unlike" (they alternate); "strength" is "weak", "moderate" or "strong", or give "J_kT" (negative = like) if the paper gives an energy in units of kT.
- "forbidden_contacts": atom pairs of different molecules or sites that the paper says must not come closer than a distance.
- "experiment": the radiation ("xray", "neutron" or "electron") and wavelength of the paper's diffuse-scattering or PDF data.
- Fill "not_representable" honestly: the builder handles occupational disorder, molecules in discrete orientations, static displacements and nearest-neighbour correlations; it does not handle modulated or incommensurate structures, magnetic order, anisotropic ADPs, or a continuous distribution of orientations.
- Leave out any section the paper has nothing on (use [] or omit it). Do not invent disorder the paper does not describe.

FORMAT EXAMPLE (structure only; the values are placeholders, not data):
\`\`\`
${EXAMPLE}
\`\`\`

ADDITIONAL INFORMATION FROM THE USER
${n ? `The user added these notes. Follow them where they apply (for example which phase, temperature or table to use) and mark values taken from them with status "user":\n"""\n${n}\n"""` : "(none)"}
`;
}

// ---------------------------------------------------------------------------------- reading the reply
function extractJson(text) {
  const t = String(text || "").replace(/[“”]/g, '"').replace(/ /g, " ");
  if (!t.trim()) return { error: "The reply box is empty. Paste the chatbot's whole answer." };
  const candidates = [];
  const fence = /```[a-zA-Z]*\s*\n([\s\S]*?)```/g;
  let m;
  while ((m = fence.exec(t)) !== null) candidates.push(m[1]);
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) candidates.push(t.slice(a, b + 1));
  let firstErr = null, parsed = [];
  for (const c of candidates) {
    try { const o = JSON.parse(c); if (o && typeof o === "object" && !Array.isArray(o)) parsed.push(o); } catch (e) { if (!firstErr) firstErr = e.message; }
  }
  const pick = parsed.filter(o => o.schema === SCHEMA).pop() || parsed.filter(o => o.cell || o.sites).pop();
  if (pick) return { json: pick };
  if (!candidates.length) return { error: "No JSON was found in the reply. Ask the chatbot to answer with the JSON in one ```json code block." };
  return { error: `The JSON in the reply is not valid (${firstErr || "not an object"}). Ask the chatbot to send the complete, valid JSON again.` };
}

// ---------------------------------------------------------------------------------- geometry helpers
const unit = v => { const l = DB.norm(v); return l > 1e-12 ? DB.scale(v, 1 / l) : null; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const cols = (c1, c2, c3) => [[c1[0], c2[0], c3[0]], [c1[1], c2[1], c3[1]], [c1[2], c2[2], c3[2]]];
// rotation taking unit vector u onto unit vector v (shortest arc)
function arc(u, v) {
  const c = dot(u, v);
  if (c > 1 - 1e-12) return DB.I3();
  if (c < -1 + 1e-12) { const p = unit(cross(u, Math.abs(u[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0])); return DB.axisAngle(p, 180); }
  return DB.axisAngle(cross(u, v), Math.acos(c) * 180 / Math.PI);
}
// ZYZ Euler angles (degrees) of the builder's convention R = Rz(a) Ry(b) Rz(g)
function eulerZYZ(R) {
  const d = 180 / Math.PI, cb = Math.max(-1, Math.min(1, R[2][2]));
  const sb = Math.sqrt(Math.max(0, 1 - cb * cb));
  let a, b, g;
  if (sb > 1e-9) { a = Math.atan2(R[1][2], R[0][2]); b = Math.acos(cb); g = Math.atan2(R[2][1], -R[2][0]); }
  else if (cb > 0) { a = Math.atan2(R[1][0], R[0][0]); b = 0; g = 0; }
  else { a = Math.atan2(-R[1][0], -R[0][0]); b = Math.PI; g = 0; }
  const r = x => { const y = +(x * d).toFixed(8); return Object.is(y, -0) ? 0 : y; };
  return [r(a), r(b), r(g)];
}

// ---------------------------------------------------------------------------------- conversion
function fromPaper(x) {
  const errors = [], warnings = [], review = [];
  const fail = m => errors.push(m);
  if (!x || typeof x !== "object") return { errors: ["The reply holds no JSON object."], warnings, review };
  if (x.schema && x.schema !== SCHEMA) warnings.push(`The JSON says schema “${x.schema}”; expected “${SCHEMA}”. Reading it anyway.`);
  if (x.version != null && +x.version > VERSION) warnings.push(`The JSON is format version ${x.version}; this page reads version ${VERSION}.`);

  // a number or { value, source, status }; records a review row
  const rec = (label, value, src, status, note) => review.push({ label, value, source: src || "", status, note: note || "" });
  const isWrap = v => v && typeof v === "object" && !Array.isArray(v) && "value" in v;
  const meta = v => (isWrap(v) ? { src: v.source != null ? String(v.source) : "", status: STATUSES.includes(v.status) ? v.status : (v.source ? "reported" : "unsourced") } : { src: "", status: "unsourced" });
  const raw = v => (isWrap(v) ? v.value : v);
  function number(v, label, { required = true, min = -Infinity, positive = false, fallback, fallbackNote } = {}) {
    if (v == null || v === "") {
      if (fallback !== undefined) { rec(label, fallback, "", "default", fallbackNote || "not in the reply; page default used"); return fallback; }
      if (required) fail(`${label} is missing.`);
      return null;
    }
    const n = Number(raw(v));
    if (!Number.isFinite(n)) { fail(`${label}: “${JSON.stringify(raw(v))}” is not a number.`); return null; }
    if (positive && !(n > 0)) { fail(`${label} must be positive (got ${n}).`); return null; }
    if (n < min) { fail(`${label} must be at least ${min} (got ${n}).`); return null; }
    const m = meta(v); rec(label, n, m.src, m.status); return n;
  }
  function vector(v, label, { record = true } = {}) {
    const val = raw(v);
    if (!Array.isArray(val) || val.length !== 3) { fail(`${label} needs three numbers.`); return null; }
    const out = val.map(q => Number(raw(q)));
    if (out.some(q => !Number.isFinite(q))) { fail(`${label}: ${JSON.stringify(val)} is not three numbers.`); return null; }
    if (record) { const m = isWrap(v) ? meta(v) : meta(val.find(isWrap)); rec(label, `(${out.map(q => +q.toFixed(6)).join(", ")})`, m.src, m.status); }
    return out;
  }
  const str = v => (v == null ? "" : String(v).trim());

  const s = EX.blank.make();
  s.sites = []; s.molecules = []; s.orientations = [];
  s.calc.pdf.enabled = false; // the 1D PDF stays off until the user switches it on
  const paper = x.paper || {};
  s.title = (str(x.material) || str(paper.title) || "Model from a paper").slice(0, 120);

  // cell
  const c = x.cell || {};
  if (!x.cell) fail("The reply has no unit cell (“cell”).");
  ["a", "b", "c"].forEach(k => { const v = number(c[k], `Cell ${k} (Å)`, { positive: true }); if (v != null) s.cell[k] = v; });
  [["alpha", "α"], ["beta", "β"], ["gamma", "γ"]].forEach(([k, l]) => {
    const v = number(c[k], `Cell ${l} (°)`, { positive: true, fallback: 90, fallbackNote: "not in the reply; 90° assumed" }); if (v != null) s.cell[k] = v;
  });
  let A = null;
  if (!errors.length) { try { A = DB.latticeMatrix(s.cell); } catch (e) { fail("The cell parameters do not form a valid cell."); } }

  // space group
  let sg = null;
  const sgx = x.space_group;
  if (sgx && (sgx.number != null || sgx.symbol)) {
    const n = Number(raw(sgx.number)), sym = str(sgx.symbol).replace(/[\s_]/g, "").replace(/−/g, "-").toLowerCase();
    const byN = Number.isInteger(n) ? SG.find(g => g.n === n) : null, byS = sym ? SG.find(g => g.s.replace(/\s/g, "").toLowerCase() === sym) : null;
    sg = byN || byS;
    if (!sg) fail(`Space group “${str(sgx.symbol)}” (${sgx.number ?? "no number"}) is not one of the 230 standard groups.`);
    else {
      if (byN && byS && byN !== byS) warnings.push(`Space-group number ${n} is ${byN.s}, but the symbol says ${str(sgx.symbol)}; number ${n} is used.`);
      else if (byN && sym && !byS) warnings.push(`Space-group symbol “${str(sgx.symbol)}” is not the standard symbol of number ${n} (${byN.s}); number ${n} is used. Check the setting.`);
      rec("Space group", `${sg.n} ${sg.s}`, str(sgx.source), sgx.status && STATUSES.includes(sgx.status) ? sgx.status : (sgx.source ? "reported" : "unsourced"));
      s.spacegroup = { n: sg.n };
      if (A && !DB.cellFits(sg.n, s.cell)) warnings.push(`The cell does not have the shape required by ${sg.s} (${DB.crystalSystem(sg.n)}); check the cell or the setting.`);
    }
  }
  const asym = (x.sites_are || (sg ? "asymmetric_unit" : "all_positions")) !== "all_positions";
  if (asym && !sg && (x.sites || []).length) warnings.push("The sites are marked as an asymmetric unit but there is no space group; they are used as listed.");

  // molecules
  const molByName = {};
  (x.molecules || []).forEach((m, i) => {
    const name = str(m.name) || `molecule ${i + 1}`, id = `m${i + 1}`;
    const atoms = [];
    (m.atoms || []).forEach((a, j) => {
      const el = str(a.element || a.el);
      if (!DB.elementOf(el)) fail(`Molecule “${name}”, atom ${j + 1}: “${el}” is not an element symbol.`);
      const xyz = vector(a.xyz, `${name} atom ${j + 1} xyz`, { record: false });
      if (xyz) atoms.push({ el: DB.elementOf(el) || el, xyz: xyz.map(q => +q.toFixed(6)) });
    });
    if (!atoms.length) fail(`Molecule “${name}” has no atoms.`);
    let anchor = "centroid";
    if (m.anchor_atom != null && m.anchor_atom !== "centroid") {
      const k = Number(m.anchor_atom);
      if (Number.isInteger(k) && k >= 1 && k <= atoms.length) anchor = k - 1;
      else fail(`Molecule “${name}”: anchor_atom ${JSON.stringify(m.anchor_atom)} is not an atom number 1…${atoms.length}.`);
    }
    rec(`Molecule ${name}: geometry`, `${atoms.length} atoms`, str(m.geometry_source), m.geometry_source ? (/assum|standard|typical/i.test(m.geometry_source) ? "assumed" : "reported") : "unsourced");
    s.molecules.push({ id, name: name.slice(0, 40), anchor, atoms });
    molByName[name] = s.molecules[s.molecules.length - 1];
  });

  // orientation groups
  const grpByName = {};
  (x.orientation_groups || []).forEach((g, i) => {
    const name = str(g.name) || `group ${i + 1}`, id = `g${i + 1}`;
    const mol = molByName[str(g.molecule)] || (s.molecules.length === 1 && !g.molecule ? s.molecules[0] : null);
    if (!mol) { fail(`Orientation group “${name}”: molecule “${str(g.molecule)}” is not in "molecules".`); return; }
    const local = DB.moleculeLocal(mol);
    const molVec = (spec, what) => {
      if (!spec || typeof spec !== "object") { fail(`Orientation group “${name}”: ${what} is missing.`); return null; }
      const at = k => { const q = Number(k); if (!(Number.isInteger(q) && q >= 1 && q <= local.xyz.length)) { fail(`Orientation group “${name}”, ${what}: atom ${JSON.stringify(k)} is not 1…${local.xyz.length}.`); return null; } return local.xyz[q - 1]; };
      let v = null;
      if (spec.vector) v = vector(spec.vector, `${name} ${what} vector`, { record: false });
      else if (spec.from_atom != null && spec.to_atom != null) { const p = at(spec.from_atom), q = at(spec.to_atom); if (p && q) v = DB.sub(q, p); }
      else if (spec.from_atom != null && Array.isArray(spec.to_midpoint_of) && spec.to_midpoint_of.length === 2) {
        const p = at(spec.from_atom), q1 = at(spec.to_midpoint_of[0]), q2 = at(spec.to_midpoint_of[1]);
        if (p && q1 && q2) v = DB.sub(DB.scale(DB.add(q1, q2), 0.5), p);
      } else { fail(`Orientation group “${name}”, ${what}: give from_atom + to_atom, from_atom + to_midpoint_of, or vector.`); return null; }
      const u = v && unit(v);
      if (v && !u) fail(`Orientation group “${name}”, ${what}: the molecule direction has zero length.`);
      return u;
    };
    const crysVec = (spec, lat, cart, what) => {
      let v = null;
      if (spec[lat] != null) { const w = vector(spec[lat], `${name} ${what}`, { record: false }); if (w && A) v = DB.frac2cart(A, w); }
      else if (spec[cart] != null) v = vector(spec[cart], `${name} ${what}`, { record: false });
      else { fail(`Orientation group “${name}”: ${what} needs "${lat}" (lattice direction) or "${cart}".`); return null; }
      const u = v && unit(v);
      if (v && !u) fail(`Orientation group “${name}”: ${what} is the zero vector.`);
      return u;
    };
    const p = g.primary || {};
    const m1 = molVec(g.primary, "primary"), t1 = g.primary ? crysVec(p, "along", "along_cartesian", "primary direction") : null;
    let R0 = DB.I3(), how = "";
    if (m1 && t1) {
      if (g.secondary) {
        const m2r = molVec(g.secondary, "secondary"), t2r = crysVec(g.secondary, "towards", "towards_cartesian", "secondary direction");
        if (m2r && t2r) {
          const m2 = unit(DB.sub(m2r, DB.scale(m1, dot(m2r, m1)))), t2 = unit(DB.sub(t2r, DB.scale(t1, dot(t2r, t1))));
          if (!m2) fail(`Orientation group “${name}”: the secondary molecule direction is parallel to the primary one.`);
          else if (!t2) fail(`Orientation group “${name}”: the secondary crystal direction is parallel to the primary one.`);
          else { R0 = DB.mul(cols(t1, t2, cross(t1, t2)), DB.tr(cols(m1, m2, cross(m1, m2)))); how = "primary and secondary directions"; }
        }
      } else {
        R0 = arc(m1, t1); how = "primary direction only";
        const perp = local.xyz.some(q => DB.norm(DB.sub(q, DB.scale(m1, dot(q, m1)))) > 0.05);
        if (perp) warnings.push(`Orientation group “${name}”: only a primary direction is given, so the turn of the molecule about it is arbitrary. Add "secondary" unless the symmetry makes it irrelevant.`);
      }
    }
    let ops = [], symText = "";
    if (Array.isArray(g.operations) && g.operations.length) { ops = g.operations.map(str).filter(Boolean); symText = "operations as listed"; }
    else if (g.symmetry) {
      const pg = pointGroupOps(g.symmetry);
      if (!pg) fail(`Orientation group “${name}”: point group “${str(g.symmetry)}” is not known; use a Schoenflies symbol (Oh, D4h, …) or "operations".`);
      else { ops = pg.ops; symText = `point group ${pg.key}`; }
    } else warnings.push(`Orientation group “${name}” has no symmetry: it holds a single orientation.`);
    const grp = { id, name: name.slice(0, 40), molecule: mol.id, convention: "ZYZ", euler: eulerZYZ(R0), ops: ops.join("\n"), frame: "lab", closure: true, weights: [],
      description: str(g.description) };
    if (A) {
      const ex = DB.expandGroup(grp, mol, A);
      ex.errors.forEach(e => fail(`Orientation group “${name}”: ${e}`));
      rec(`Orientations ${name}`, `${ex.orientations.length} distinct (${symText || "no symmetry"}; ${how || "no base"})`, str(g.source), g.source ? "reported" : "unsourced", str(g.description));
    }
    s.orientations.push(grp);
    grpByName[name] = grp;
  });

  // sites
  const used = new Set();
  const makeLabel = base => {
    let b = base.replace(/[^A-Za-z0-9_]/g, "").slice(0, 10) || "S", lab = b, k = 1;
    while (used.has(lab)) { k++; lab = `${b.slice(0, 10 - String(k).length - 1)}_${k}`; }
    used.add(lab); return lab;
  };
  const firstLabel = {};
  if (!(x.sites || []).length) fail("The reply has no sites.");
  (x.sites || []).forEach((st, i) => {
    const label0 = str(st.label) || `S${i + 1}`;
    const frac = vector(st.frac, `Site ${label0} position`);
    const occs = [];
    (st.occupants || []).forEach((o, j) => {
      const what = `Site ${label0}, occupant ${j + 1}`;
      const type = str(o.type || (o.molecule ? "molecule" : o.element ? "atom" : "")).toLowerCase();
      const p = number(o.occupancy, `${label0}: occupancy of ${o.element || o.orientation_group || o.molecule || type || j + 1}`, { min: 0, fallback: (st.occupants || []).length === 1 ? 1 : undefined, fallbackNote: "single occupant; occupancy 1 assumed" });
      if (p == null) return;
      if (type === "atom") {
        const el = str(o.element || o.species);
        if (!DB.elementOf(el)) { fail(`${what}: “${el}” is not an element symbol.`); return; }
        let b = "";
        if (o.b_iso != null) b = number(o.b_iso, `${label0}: B of ${el} (Å²)`, { min: 0 });
        else if (o.u_iso != null) { const u = number(o.u_iso, `${label0}: U of ${el} (Å²)`, { min: 0 }); if (u != null) { b = +(8 * Math.PI * Math.PI * u).toFixed(4); rec(`${label0}: B of ${el} (Å²) = 8π²U`, b, "from U", "derived"); } }
        occs.push({ type: "atom", species: el.slice(0, 4), p, b: b == null ? "" : b });
      } else if (type === "molecule") {
        const gname = str(o.orientation_group || o.group);
        let grp = grpByName[gname];
        if (!grp) {
          const cand = s.orientations.filter(q => q.molecule === (molByName[str(o.molecule)] || {}).id);
          if (!gname && cand.length === 1) grp = cand[0];
        }
        if (!grp) { fail(`${what}: orientation group “${gname}” is not in "orientation_groups".`); return; }
        occs.push({ type: "molecule", group: grp.id, p, b: "" });
      } else if (type === "vacancy") occs.push({ type: "vacancy", p });
      else fail(`${what}: type “${o.type}” must be atom, molecule or vacancy.`);
    });
    if (!occs.length) { fail(`Site ${label0} has no usable occupants.`); return; }
    const tot = occs.reduce((a, o) => a + o.p, 0);
    if (tot < 1 - 1e-6) {
      const vac = occs.find(o => o.type === "vacancy");
      const rest = +(1 - tot).toFixed(6);
      if (vac) vac.p = +(vac.p + rest).toFixed(6); else occs.push({ type: "vacancy", p: rest });
      rec(`${label0}: vacancy`, rest, "1 − sum of occupancies", "derived");
    } else if (tot > 1 + 0.02) fail(`Site ${label0}: occupancies add up to ${tot.toFixed(3)}, more than 1.`);
    else if (tot > 1 + 1e-6) { occs.forEach(o => { o.p = +(o.p / tot).toFixed(6); }); warnings.push(`Site ${label0}: occupancies add up to ${tot.toFixed(4)}; rescaled to 1.`); }
    if (!frac) return;
    const bAtom = occs.find(o => o.type === "atom" && o.b !== "");
    const base = { b_iso: bAtom ? bAtom.b || 1 : 1, draw: occs.length > 1 ? "exact" : "random" };
    const positions = asym && sg ? DB.wyckoffOrbitOps(sg, frac.map(q => +q.toFixed(8)).join(","), {}) : [{ p: frac, op: "x,y,z" }];
    const setId = `p${i + 1}`;
    positions.forEach(({ p, op }) => {
      const lab = makeLabel(label0);
      if (!firstLabel[label0]) firstLabel[label0] = lab;
      const sym = op.split(",").map(q => q.replace(/[+-]?\d+(\/\d+)?$/, "").replace(/^\+/, "") || "0").join(",");
      const hasMol = occs.some(o => o.type === "molecule");
      s.sites.push({ label: lab, frac: p.map(q => +(+q).toFixed(6)), ...base, set: setId, ...(sg && asym ? { wyckoff: `${sg.n} ${sg.s} from ${label0}` } : {}),
        ...(hasMol && sym !== "x,y,z" ? { sym } : {}), occupants: JSON.parse(JSON.stringify(occs)) });
    });
    if (positions.length > 1) rec(`${label0}: symmetry-equivalent positions`, positions.length, `space group ${sg.s}`, "derived");
  });
  if (s.sites.length > 400) warnings.push(`${s.sites.length} sites per unit cell; the preview will be slow.`);

  // displacements
  const d = x.displacements || {};
  Object.entries(d.atom_sigma_A || {}).forEach(([el, v]) => {
    if (!DB.elementOf(el)) { fail(`Displacements: “${el}” is not an element symbol.`); return; }
    const q = number(v, `σ ${el} (Å)`, { min: 0 }); if (q != null) s.disorder.atomic_displacements[el] = q;
  });
  if (d.molecule_translation_sigma_A != null) { const q = number(d.molecule_translation_sigma_A, "Molecule translation σ (Å)", { min: 0 }); if (q != null) s.disorder.molecule_rigid.translation_sigma = q; }
  if (d.molecule_libration_sigma_deg != null) { const q = number(d.molecule_libration_sigma_deg, "Molecule libration σ (°)", { min: 0 }); if (q != null) s.disorder.molecule_rigid.libration_sigma_deg = q; }

  // short-range order -> swap Monte Carlo pairs
  const STRENGTH = { weak: 0.3, moderate: 0.6, strong: 1.0 };
  const sro = x.short_range_order || [];
  sro.forEach((r, k) => {
    const what = `Short-range order ${k + 1}`;
    const ia = s.sites.findIndex(q => q.label === firstLabel[str(r.site_a)]), ib = s.sites.findIndex(q => q.label === firstLabel[str(r.site_b)]);
    if (ia < 0 || ib < 0) { warnings.push(`${what}: sites “${str(r.site_a)}”/“${str(r.site_b)}” not found; set this correlation up by hand (Disorder step).`); return; }
    const t = vector(r.cell_offset || [0, 0, 0], `${what} cell offset`, { record: false });
    if (!t) return;
    if (ia === ib && t.every(q => q === 0)) { fail(`${what}: a site cannot be its own neighbour with cell offset 0 0 0.`); return; }
    let J, status = "assumed", src = str(r.source);
    if (r.J_kT != null) { J = number(r.J_kT, `${what}: J (kT)`); status = meta(r.J_kT).status; }
    else {
      const ten = str(r.tendency).toLowerCase(), mag = STRENGTH[str(r.strength).toLowerCase()] ?? STRENGTH.moderate;
      if (ten !== "like" && ten !== "unlike") { fail(`${what}: tendency must be "like" or "unlike".`); return; }
      J = ten === "like" ? -mag : mag;
      rec(`${what}: J (kT)`, J, src, "assumed", `from “${ten}, ${str(r.strength) || "moderate"}”: set the strength by comparing with the paper's data`);
    }
    if (J == null) return;
    s.disorder.correlations.enabled = true;
    s.disorder.correlations.interactions.push({ site_a: ia, site_b: ib, t: t.map(Math.round), J });
    if (t.some(q => q !== Math.round(q))) warnings.push(`${what}: the cell offset was rounded to whole cells.`);
  });
  if (s.disorder.correlations.enabled && s.sites.length > 1) warnings.push("Short-range order was attached to one site of each symmetry-equivalent set only; add the pairs for the other sites in the Disorder step if they apply.");

  // forbidden contacts
  (x.forbidden_contacts || []).forEach((r, k) => {
    const ea = str(r.element_a) || "any", eb = str(r.element_b) || "any";
    if ((ea !== "any" && !DB.elementOf(ea)) || (eb !== "any" && !DB.elementOf(eb))) { fail(`Forbidden contact ${k + 1}: elements must be element symbols or "any".`); return; }
    const dmin = number(r.min_distance_A, `Forbidden contact ${ea}–${eb} (Å)`, { positive: true });
    if (dmin == null) return;
    s.disorder.contacts.enabled = true;
    s.disorder.contacts.rules.push({ a: ea, b: eb, dmin, penalty: 100 });
  });

  // experiment
  const e = x.experiment || {};
  const rad = str(e.radiation).toLowerCase().replace(/[^a-z]/g, "");
  if (rad === "neutron" || rad === "neutrons") { s.calc.fourier.radiation = "neutron"; s.calc.pdf.radiation = "neutron"; rec("Radiation", "neutron", str(e.source), "reported"); }
  else if (rad === "xray" || rad === "xrays") rec("Radiation", "X-ray", str(e.source), "reported");
  else if (rad === "electron" || rad === "electrons") warnings.push("The paper used electrons; the builder calculates X-ray or neutron scattering only. X-ray is set.");
  if (e.wavelength_A != null) {
    const lam = number(e.wavelength_A, "Wavelength (Å)", { positive: true });
    if (lam != null && rad !== "electron" && rad !== "electrons") { s.calc.fourier.wavelength = String(lam); s.calc.pdf.wavelength = lam; }
  }
  if (s.molecules.some(m => m.atoms.some(a => a.el === "H")) && s.calc.fourier.radiation === "xray")
    warnings.push("The model has hydrogen, which barely scatters X-rays; for neutron data choose neutron radiation in the Calculations step.");

  // page defaults the user should know about
  rec("Supercell", s.supercell.join(" × "), "", "default", "page default; change it in the Cell step");

  s.paper = {
    title: str(paper.title), authors: str(paper.authors), year: paper.year != null ? str(paper.year) : "", doi: str(paper.doi),
    material: str(x.material), conditions: str(x.conditions), summary: str(x.summary),
    assumptions: (x.assumptions || []).map(str).filter(Boolean), not_representable: (x.not_representable || []).map(str).filter(Boolean),
    questions: (x.questions_for_user || []).map(str).filter(Boolean), notes: "",
  };
  if (!errors.length) {
    try { const v = DB.validate(s); v.errs.forEach(m => fail(`After conversion: ${m}`)); v.warns.forEach(m => warnings.push(m)); }
    catch (err) { fail(`After conversion: ${err.message}`); }
  }
  const order = { unsourced: 0, assumed: 1, default: 2, derived: 3, user: 4, reported: 5 };
  review.sort((a, b) => order[a.status] - order[b.status]);
  return { state: errors.length ? null : s, errors: [...new Set(errors)], warnings: [...new Set(warnings)], review, paper: s.paper };
}

// a message the user can paste back into the chatbot
function fixMessage(errors) {
  return "The DISCUS Disorder Builder could not use your JSON:\n" + errors.map(e => `- ${e}`).join("\n") +
    "\n\nPlease check these against the paper and send the corrected, complete JSON again in one ```json code block.";
}

const api = { SCHEMA, VERSION, POINT_GROUPS, pointGroupOps, buildPrompt, extractJson, fromPaper, fixMessage, eulerZYZ, arc };
if (isNode) module.exports = api; else root.DB_PAPER = api;
})(typeof window !== "undefined" ? window : globalThis);
