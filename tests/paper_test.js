// Tests of the paper import (src/paper.js): node tests/paper_test.js
const assert = require("assert");
const DB = require("../src/core.js"), P = require("../src/paper.js"), fs = require("fs");
const clone = o => JSON.parse(JSON.stringify(o));
const ice = JSON.parse(fs.readFileSync(__dirname + "/paper_ice_vii.json", "utf8"));
const deg = (u, v) => Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / DB.norm(u) / DB.norm(v)))) * 180 / Math.PI;

// Euler extraction reproduces the rotation (random, b = 0 and b = 180° cases)
const rnd = DB.rng32(7);
for (let k = 0; k < 200; k++) {
  const R = k === 0 ? DB.axisAngle([0, 0, 1], 37) : k === 1 ? DB.mul(DB.axisAngle([0, 0, 1], 20), DB.axisAngle([0, 1, 0], 180)) : DB.axisAngle([rnd() - .5, rnd() - .5, rnd() - .5], 360 * rnd());
  const e = P.eulerZYZ(R), R2 = DB.eulerMatrix("ZYZ", ...e);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) assert(Math.abs(R[i][j] - R2[i][j]) < 1e-7, `euler ${k}`);
}
// point-group shortcuts close to the right orders
const A = DB.latticeMatrix({ a: 4, b: 4, c: 4, alpha: 90, beta: 90, gamma: 90 });
const H = DB.latticeMatrix({ a: 4, b: 4, c: 6, alpha: 90, beta: 90, gamma: 120 });
const order = (name, L) => DB.closure(P.pointGroupOps(name).ops.map(o => DB.parseOp(o, L).R)).length;
for (const [n, o, L] of [["Oh", 48, A], ["m-3m", 48, A], ["O", 24, A], ["Td", 24, A], ["T", 12, A], ["Th", 24, A], ["D4h", 16, A], ["4/mmm", 16, A],
  ["C4v", 8, A], ["D2d", 8, A], ["mmm", 8, A], ["C2v", 4, A], ["-1", 2, A], ["1", 1, A], ["D6h", 24, H], ["6/mmm", 24, H], ["D3d", 12, H], ["-3m", 12, H], ["D3h", 12, H], ["C3v", 6, H]])
  assert.strictEqual(order(n, L), o, n);
assert.strictEqual(P.pointGroupOps("Q7"), null);

// the prompt carries the user's notes and the schema name
const pr = P.buildPrompt("Use the 500 K structure from Table S3.");
assert(pr.includes("Use the 500 K structure from Table S3.") && pr.includes(P.SCHEMA) && pr.includes('status "user"'));
assert(P.buildPrompt("").includes("(none)"));
// the prompt is self-contained: no links, and it names every key and value the reader understands
assert(!/https?:|www\.|github|\.io\b/i.test(pr), "the prompt must not link anywhere");
for (const key of ["schema", "version", "paper", "material", "conditions", "summary", "cell", "space_group", "sites_are", "asymmetric_unit", "all_positions",
  "sites", "label", "frac", "occupants", "occupancy", "element", "b_iso", "u_iso", "molecule", "orientation_group", "vacancy", "molecules", "atoms", "xyz",
  "anchor_atom", "centroid", "geometry_source", "orientation_groups", "primary", "secondary", "from_atom", "to_atom", "to_midpoint_of", "vector", "along",
  "along_cartesian", "towards", "towards_cartesian", "symmetry", "operations", "displacements", "atom_sigma_A", "molecule_translation_sigma_A",
  "molecule_libration_sigma_deg", "short_range_order", "site_a", "site_b", "cell_offset", "tendency", "like", "unlike", "strength", "weak", "moderate",
  "strong", "J_kT", "forbidden_contacts", "element_a", "element_b", "min_distance_A", "experiment", "radiation", "xray", "neutron", "electron",
  "wavelength_A", "assumptions", "not_representable", "questions_for_user", "reported", "derived", "assumed", "user"])
  assert(pr.includes(`"${key}"`), `prompt does not name "${key}"`);
for (const g of Object.keys(P.POINT_GROUPS)) assert(new RegExp(`[ ,:]${g}[,.]`).test(pr), `prompt does not list point group ${g}`);
JSON.parse(/FORMAT EXAMPLE[^`]*```\n([\s\S]*?)```/.exec(pr)[1]); // the example in the prompt is valid JSON

// the Markdown file is the same prompt (with the notes) under a short header that says what to do with it
{
  const md = P.promptMarkdown("Use Table S3.");
  assert(md.startsWith("# Instructions") && md.endsWith(P.buildPrompt("Use Table S3.")) && md.includes("Use Table S3."));
  assert(!/https?:|github/i.test(md));
}
// extracting JSON from replies
const body = JSON.stringify(ice);
assert.deepStrictEqual(P.extractJson("Here it is:\n```json\n" + body + "\n```\nCheck the weights.").json, ice);
assert.deepStrictEqual(P.extractJson(body).json, ice);
assert.deepStrictEqual(P.extractJson("Draft:\n```json\n{\"cell\": 1}\n```\nFinal:\n```json\n" + body + "\n```").json, ice);
assert(/not valid/.test(P.extractJson("```json\n{\"cell\": {,}}\n```").error));
assert(/No JSON/.test(P.extractJson("I could not open the PDF.").error));
assert(/empty/.test(P.extractJson("  ").error));

// plastic ice VII: three orientation families of water on a bcc lattice
{
  const r = P.fromPaper(clone(ice));
  assert.deepStrictEqual(r.errors, [], r.errors.join("\n"));
  const s = r.state;
  assert.strictEqual(s.sites.length, 2); // Im-3m 2a: (0,0,0) and (½,½,½)
  assert.deepStrictEqual(s.sites.map(q => q.frac), [[0, 0, 0], [0.5, 0.5, 0.5]]);
  assert.strictEqual(s.calc.fourier.radiation, "neutron");
  assert.strictEqual(s.disorder.contacts.rules[0].dmin, 1.5);
  assert.deepStrictEqual(DB.validate(s).errs, []);
  const L = DB.latticeMatrix(s.cell), tab = DB.orientationTable(s, L);
  const counts = s.orientations.map(g => tab[g.id].orientations.length);
  // S and E keep a mirror of Oh, so 48/4 = 12 placements each; D (H–H on a body diagonal) keeps only the C2 along
  // its bisector, so all 24 placements with H–H along a <111> and bisector along a perpendicular <110> appear
  assert.deepStrictEqual(counts, [12, 12, 24]);
  // S family: every O–H bond within 3° of a <111> cube-corner direction
  const water = DB.moleculeLocal(s.molecules[0]);
  const corners = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) corners.push([x, y, z]);
  tab.g1.orientations.forEach(o => [1, 2].forEach(i => {
    const h = DB.mv(o.R, water.xyz[i]);
    assert(Math.min(...corners.map(c => deg(h, c))) < 3, "S family O–H near <111>");
  }));
  // D family: H–H vector along a body diagonal
  tab.g3.orientations.forEach(o => {
    const hh = DB.sub(DB.mv(o.R, water.xyz[2]), DB.mv(o.R, water.xyz[1]));
    assert(Math.min(...corners.map(c => deg(hh, c))) < 1e-6, "D family H–H along <111>");
  });
  // E family: the two O–H bonds point to corners that share a cube edge (corners differ in one coordinate)
  tab.g2.orientations.forEach(o => {
    const near = [1, 2].map(i => { const h = DB.mv(o.R, water.xyz[i]); return corners.reduce((b, c) => deg(h, c) < deg(h, b) ? c : b); });
    assert.strictEqual(near[0].filter((q, i) => q !== near[1][i]).length, 1, "E family edge-sharing corners");
  });
  // review: assumed values come first, sourced values carry their source
  assert(r.review.findIndex(q => q.status === "assumed") < r.review.findIndex(q => q.status === "reported"));
  assert(r.review.some(q => q.label === "Cell a (Å)" && q.source === "D20 diffraction, Methods" && q.status === "reported"));
  assert(r.review.some(q => q.label === "σ O (Å)" && q.status === "unsourced"));
  assert.strictEqual(s.paper.doi, "10.1038/s41586-025-08750-0");
  // a script can be generated from the result
  const tpl = fs.readFileSync(__dirname + "/../engine.py", "utf8");
  assert(DB.generateScript(s, tpl).includes('"Im-3m"') || DB.generateScript(s, tpl).includes("plastic ice VII"));
}

// NaCl with a Na vacancy, U values and asymmetric-unit expansion in Fm-3m
{
  const x = { schema: P.SCHEMA, version: 1, material: "Na0.9Cl",
    cell: { a: 5.64, b: 5.64, c: 5.64, alpha: 90, beta: 90, gamma: 90 }, space_group: { symbol: "F m -3 m", number: 225 }, sites_are: "asymmetric_unit",
    sites: [{ label: "Na", frac: [0, 0, 0], occupants: [{ type: "atom", element: "Na", occupancy: 0.9, u_iso: { value: 0.0127, source: "Table 1" } }] },
      { label: "Cl", frac: [0.5, 0.5, 0.5], occupants: [{ type: "atom", element: "Cl", u_iso: 0.0127 }] }],
    short_range_order: [{ site_a: "Na", site_b: "Na", cell_offset: [1, 0, 0], tendency: "unlike", strength: "weak" }],
    experiment: { radiation: "X-ray" } };
  const r = P.fromPaper(x);
  assert.deepStrictEqual(r.errors, [], r.errors.join("\n"));
  const s = r.state;
  assert.strictEqual(s.sites.length, 8);
  const na = s.sites.filter(q => q.occupants[0].species === "Na");
  assert.strictEqual(na.length, 4);
  assert.deepStrictEqual(na[0].occupants.map(o => [o.type, o.p]), [["atom", 0.9], ["vacancy", 0.1]]);
  assert(Math.abs(na[0].occupants[0].b - 8 * Math.PI ** 2 * 0.0127) < 1e-3);
  assert.strictEqual(new Set(s.sites.map(q => q.label)).size, 8);
  assert.deepStrictEqual(s.disorder.correlations.interactions, [{ site_a: 0, site_b: 0, t: [1, 0, 0], J: 0.3 }]);
  assert(r.review.some(q => /vacancy/.test(q.label) && q.status === "derived"));
  assert(r.review.some(q => /J \(kT\)/.test(q.label) && q.status === "assumed"));
}

// errors are reported in words, and no model is returned
{
  const bad = clone(ice);
  bad.cell.a = "three point three";
  bad.sites[0].occupants[0].occupancy = 0.9; // sum 1.153
  bad.orientation_groups[0].symmetry = "Oq";
  bad.molecules[0].atoms[1].element = "Hx";
  const r = P.fromPaper(bad);
  assert.strictEqual(r.state, null);
  for (const re of [/Cell a.*not a number/, /more than 1/, /point group “Oq”/, /“Hx” is not an element/]) assert(r.errors.some(e => re.test(e)), String(re) + "\n" + r.errors.join("\n"));
  assert(P.fixMessage(r.errors).includes("```json"));
  assert.strictEqual(P.fromPaper(null).state, undefined);
  assert(P.fromPaper({}).errors.some(e => /no unit cell/.test(e)));
}
// directions do not depend on where the molecule is anchored (centroid anchor: O is no longer at the origin)
{
  const x = clone(ice); x.molecules[0].anchor_atom = "centroid";
  const r = P.fromPaper(x), s = r.state, tab = DB.orientationTable(s, DB.latticeMatrix(s.cell)), w = DB.moleculeLocal(s.molecules[0]);
  const corners = []; for (const a of [-1, 1]) for (const b of [-1, 1]) for (const c of [-1, 1]) corners.push([a, b, c]);
  tab.g1.orientations.forEach(o => [1, 2].forEach(i => {
    const oh = DB.sub(DB.mv(o.R, w.xyz[i]), DB.mv(o.R, w.xyz[0]));
    assert(Math.min(...corners.map(c => deg(oh, c))) < 3, "centroid anchor: O–H near <111>");
  }));
}
// "to_midpoint_of" uses the midpoint (from H2 to the midpoint of O and H3 along [0 0 1])
{
  const x = clone(ice); x.orientation_groups = [{ name: "S", molecule: "water", primary: { from_atom: 2, to_midpoint_of: [1, 3], along: [0, 0, 1] },
    secondary: { from_atom: 1, to_atom: 3, towards: [1, 0, 0] } }];
  x.sites[0].occupants = [{ type: "molecule", orientation_group: "S", occupancy: 1 }];
  const s = P.fromPaper(x).state, w = DB.moleculeLocal(s.molecules[0]);
  const R = DB.eulerMatrix("ZYZ", ...s.orientations[0].euler);
  const v = DB.mv(R, DB.sub(DB.scale(DB.add(w.xyz[0], w.xyz[2]), 0.5), w.xyz[1]));
  assert(deg(v, [0, 0, 1]) < 1e-5, "midpoint direction along [0 0 1]");
}
// a secondary direction parallel to the primary one is refused
{
  const bad = clone(ice);
  bad.orientation_groups[0].secondary = { from_atom: 1, to_midpoint_of: [2, 3], towards: [1, 1, 0] };
  assert(P.fromPaper(bad).errors.some(e => /secondary molecule direction is parallel/.test(e)));
}
console.log("paper import checks ok");
