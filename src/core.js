/* Disorder Builder core: lattice maths, orientations, random realisation, diffuse preview and
   script generation. No DOM access, so it runs in Node for tests as well as in the page. */
(function (root) {
"use strict";

// ---------------------------------------------------------------------------------- elements
const SYMBOLS = ("H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr " +
  "Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W " +
  "Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm").split(" ");
const Z = {};
SYMBOLS.forEach((s, i) => { Z[s] = i + 1; });
// covalent radii (Å, Cordero et al. 2008) for the common elements; others fall back to 1.5 Å
const COV = { H: .31, He: .28, Li: 1.28, Be: .96, B: .84, C: .76, N: .71, O: .66, F: .57, Ne: .58, Na: 1.66, Mg: 1.41,
  Al: 1.21, Si: 1.11, P: 1.07, S: 1.05, Cl: 1.02, Ar: 1.06, K: 2.03, Ca: 1.76, Sc: 1.70, Ti: 1.60, V: 1.53, Cr: 1.39,
  Mn: 1.39, Fe: 1.32, Co: 1.26, Ni: 1.24, Cu: 1.32, Zn: 1.22, Ga: 1.22, Ge: 1.20, As: 1.19, Se: 1.20, Br: 1.20,
  Kr: 1.16, Rb: 2.20, Sr: 1.95, Y: 1.90, Zr: 1.75, Nb: 1.64, Mo: 1.54, Ag: 1.45, Cd: 1.44, In: 1.42, Sn: 1.39,
  Sb: 1.39, Te: 1.38, I: 1.39, Xe: 1.40, Cs: 2.44, Ba: 2.15, La: 2.07, Pt: 1.36, Au: 1.36, Hg: 1.32, Pb: 1.46, Bi: 1.48,
  U: 1.96 };
const COLORS = { H: "#e8ecef", C: "#5b6670", N: "#3d6fd6", O: "#e0412f", F: "#7fd34e", Cl: "#2fbf5a", Br: "#a3392b",
  I: "#7b3fa8", S: "#e6c229", P: "#f08a24", Na: "#8a5cf0", K: "#9f6ae6", Cs: "#5a2d9c", Li: "#c086ff", Mg: "#4fa36b",
  Ca: "#57b884", Si: "#d9b38c", Al: "#b9a6a6", Fe: "#d2722e", Cu: "#c8803c", Ag: "#b9c2cc", Au: "#e3b43c",
  Zn: "#7d80b0", Ni: "#4fbf6a", Co: "#e07ba0", Ti: "#9aa3ab", Zr: "#7fbfbf", Pb: "#57595f", Sn: "#7b8c99",
  B: "#e9a3a3", Ba: "#2fae8e", Sr: "#3fbf9f", Mn: "#a67fd6", Cr: "#8a9bd6", V: "#a6a6ab", La: "#5fb3d6", U: "#2f8fd6" };
function elementOf(sp) { const m = /^([A-Z][a-z]?)/.exec(sp || ""); return m && Z[m[1]] ? m[1] : null; }
function zOf(sp) { const e = elementOf(sp); return e ? Z[e] : 0; }
function colorOf(sp) {
  const e = elementOf(sp);
  if (e && COLORS[e]) return COLORS[e];
  const z = e ? Z[e] : 7; return `hsl(${(z * 47) % 360} 45% 55%)`;
}
function covOf(sp) { const e = elementOf(sp); return (e && COV[e]) || 1.5; }

// ---------------------------------------------------------------------------------- 3x3 maths
const I3 = () => [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
function mul(A, B) {
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i][j] = A[i][0] * B[0][j] + A[i][1] * B[1][j] + A[i][2] * B[2][j];
  return C;
}
function tr(A) { return [[A[0][0], A[1][0], A[2][0]], [A[0][1], A[1][1], A[2][1]], [A[0][2], A[1][2], A[2][2]]]; }
function mv(A, v) { return [A[0][0] * v[0] + A[0][1] * v[1] + A[0][2] * v[2], A[1][0] * v[0] + A[1][1] * v[1] + A[1][2] * v[2], A[2][0] * v[0] + A[2][1] * v[1] + A[2][2] * v[2]]; }
function det(A) {
  return A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) - A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) + A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);
}
function inv(A) {
  const d = det(A);
  if (Math.abs(d) < 1e-14) throw new Error("singular matrix");
  const m = [[A[1][1] * A[2][2] - A[1][2] * A[2][1], A[0][2] * A[2][1] - A[0][1] * A[2][2], A[0][1] * A[1][2] - A[0][2] * A[1][1]],
    [A[1][2] * A[2][0] - A[1][0] * A[2][2], A[0][0] * A[2][2] - A[0][2] * A[2][0], A[0][2] * A[1][0] - A[0][0] * A[1][2]],
    [A[1][0] * A[2][1] - A[1][1] * A[2][0], A[0][1] * A[2][0] - A[0][0] * A[2][1], A[0][0] * A[1][1] - A[0][1] * A[1][0]]];
  return m.map(r => r.map(x => x / d));
}
function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function scale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
function norm(a) { return Math.hypot(a[0], a[1], a[2]); }
function maxDiff(A, B) { let m = 0; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) m = Math.max(m, Math.abs(A[i][j] - B[i][j])); return m; }
function isOrthogonal(R, tol = 1e-6) { return maxDiff(mul(R, tr(R)), I3()) < tol; }
function clean(R) { return R.map(r => r.map(x => (Math.abs(x) < 1e-12 ? 0 : x))); }

// rows a, b, c in the discuspdf canonical orientation (a ∥ x, b in xy, right-handed)
function latticeMatrix(cell) {
  const d = Math.PI / 180, { a, b, c } = cell;
  const ca = Math.cos(cell.alpha * d), cb = Math.cos(cell.beta * d), cg = Math.cos(cell.gamma * d), sg = Math.sin(cell.gamma * d);
  const cx = c * cb, cy = c * (ca - cb * cg) / sg, cz2 = c * c - cx * cx - cy * cy;
  if (!(cz2 > 0) || !(a > 0 && b > 0 && c > 0)) throw new Error("invalid unit cell");
  return [[a, 0, 0], [b * cg, b * sg, 0], [cx, cy, Math.sqrt(cz2)]];
}
const frac2cart = (A, f) => [f[0] * A[0][0] + f[1] * A[1][0] + f[2] * A[2][0], f[0] * A[0][1] + f[1] * A[1][1] + f[2] * A[2][1], f[0] * A[0][2] + f[1] * A[1][2] + f[2] * A[2][2]];

function axisAngle(axis, deg) {
  const n = norm(axis);
  if (!(n > 0)) throw new Error("zero rotation axis");
  const [x, y, z] = scale(axis, 1 / n), t = deg * Math.PI / 180, c = Math.cos(t), s = Math.sin(t), C = 1 - c;
  return [[c + x * x * C, x * y * C - z * s, x * z * C + y * s], [y * x * C + z * s, c + y * y * C, y * z * C - x * s], [z * x * C - y * s, z * y * C + x * s, c + z * z * C]];
}
const Rx = d => axisAngle([1, 0, 0], d), Ry = d => axisAngle([0, 1, 0], d), Rz = d => axisAngle([0, 0, 1], d);
// active rotations; intrinsic convention (R = R1(α) R2(β) R3(γ))
function eulerMatrix(conv, a, b, g) {
  if (conv === "ZXZ") return mul(mul(Rz(a), Rx(b)), Rz(g));
  if (conv === "XYZ") return mul(mul(Rx(a), Ry(b)), Rz(g));
  return mul(mul(Rz(a), Ry(b)), Rz(g)); // ZYZ
}

// ---------------------------------------------------------------------------------- symmetry operations
// Syntax (one per line):
//   -y,x,z            Jones symbol in crystal fractions (translations ignored)
//   C4 [0 0 1]        n-fold rotation about a lattice direction [u v w] (or Cartesian <x y z>)
//   S4 [0 0 1]        rotoreflection;  m [1 -1 0]  mirror with that normal;  -1  inversion;  E  identity
//   R 30 [1 1 1]      rotation by an angle in degrees
//   M a b c d e f g h i   explicit Cartesian 3x3 matrix (rows)
function parseDirection(txt, A) {
  const m = /([\[<])\s*([-+\d.eE\s,]+)\s*[\]>]/.exec(txt);
  if (!m) throw new Error(`no direction in "${txt}" (write [u v w] or <x y z>)`);
  const v = m[2].trim().split(/[\s,]+/).map(Number);
  if (v.length !== 3 || v.some(x => !isFinite(x))) throw new Error(`direction needs three numbers in "${txt}"`);
  return m[1] === "[" ? frac2cart(A, v) : v;
}
function parseJones(txt, A) {
  const parts = txt.split(",").map(s => s.trim().toLowerCase());
  if (parts.length !== 3) throw new Error(`"${txt}" needs three comma-separated parts`);
  const M = parts.map(p => {
    const row = [0, 0, 0];
    const re = /([+-]?)\s*(\d*\.?\d*(?:\/\d+)?)\s*\*?\s*([xyz])?/g;
    let m, any = false;
    const s = p.replace(/\s+/g, "");
    while ((m = re.exec(s)) !== null) {
      if (m[0] === "") { re.lastIndex++; continue; }
      if (!m[3]) continue; // translation part, ignored
      any = true;
      let coef = 1;
      if (m[2]) coef = m[2].includes("/") ? Number(m[2].split("/")[0]) / Number(m[2].split("/")[1]) : Number(m[2]);
      if (m[1] === "-") coef = -coef;
      row["xyz".indexOf(m[3])] += coef;
    }
    if (!any) throw new Error(`"${p}" has no x, y or z`);
    return row;
  });
  const At = tr(A);
  return mul(mul(At, M), inv(At));
}
function parseOp(line, A) {
  const txt = line.trim();
  if (!txt || txt.startsWith("#")) return null;
  let R, kind;
  let m;
  if (/^(E|1|id|identity)$/i.test(txt)) { R = I3(); kind = "E"; }
  else if (/^(-1|i|inv|inversion)$/i.test(txt)) { R = scale3(I3(), -1); kind = "-1"; }
  else if ((m = /^C(\d+)\s*(.*)$/i.exec(txt))) { R = axisAngle(parseDirection(m[2], A), 360 / Number(m[1])); kind = `C${m[1]}`; }
  else if ((m = /^S(\d+)\s*(.*)$/i.exec(txt))) {
    const d = parseDirection(m[2], A);
    R = mul(mirror(d), axisAngle(d, 360 / Number(m[1]))); kind = `S${m[1]}`;
  }
  else if ((m = /^m\s*(.*)$/i.exec(txt)) && /[\[<]/.test(m[1])) { R = mirror(parseDirection(m[1], A)); kind = "m"; }
  else if ((m = /^R\s+([-+\d.eE]+)\s*(.*)$/i.exec(txt))) { R = axisAngle(parseDirection(m[2], A), Number(m[1])); kind = "R"; }
  else if ((m = /^M\s+(.*)$/i.exec(txt))) {
    const v = m[1].trim().split(/[\s,]+/).map(Number);
    if (v.length !== 9 || v.some(x => !isFinite(x))) throw new Error("M needs nine numbers");
    R = [v.slice(0, 3), v.slice(3, 6), v.slice(6, 9)]; kind = "M";
  }
  else if (/[xyz]/i.test(txt) && txt.includes(",")) { R = parseJones(txt, A); kind = "jones"; }
  else throw new Error(`cannot read "${txt}"`);
  if (!isOrthogonal(R, 1e-5)) {
    throw new Error(kind === "jones"
      ? `"${txt}" is not a symmetry of this lattice (the Cartesian matrix is not orthogonal)`
      : `"${txt}" is not orthogonal`);
  }
  return { R: clean(R), text: txt, improper: det(R) < 0 };
}
function scale3(M, s) { return M.map(r => r.map(x => x * s)); }
function mirror(n) {
  const l = norm(n), u = scale(n, 1 / l);
  return [[1 - 2 * u[0] * u[0], -2 * u[0] * u[1], -2 * u[0] * u[2]], [-2 * u[1] * u[0], 1 - 2 * u[1] * u[1], -2 * u[1] * u[2]], [-2 * u[2] * u[0], -2 * u[2] * u[1], 1 - 2 * u[2] * u[2]]];
}
function closure(gens, limit = 240) {
  const G = [I3()];
  const has = M => G.some(X => maxDiff(X, M) < 1e-6);
  let grew = true;
  while (grew) {
    grew = false;
    for (const X of G.slice()) for (const g of gens) {
      const Y = clean(mul(g, X));
      if (!has(Y)) { G.push(Y); grew = true; if (G.length > limit) throw new Error(`group closure exceeds ${limit} operations; check the generators`); }
    }
  }
  return G;
}

// ---------------------------------------------------------------------------------- molecules and orientations
function moleculeLocal(mol) {
  const xyz = mol.atoms.map(a => a.xyz.map(Number));
  let o = [0, 0, 0];
  if (mol.anchor === "com") {
    let mt = 0;
    mol.atoms.forEach((a, i) => { const m = massOf(a.el); mt += m; o = add(o, scale(xyz[i], m)); });
    o = scale(o, 1 / mt);
  } else if (typeof mol.anchor === "number") o = xyz[mol.anchor] || [0, 0, 0];
  else { xyz.forEach(p => { o = add(o, p); }); o = scale(o, 1 / Math.max(1, xyz.length)); }
  return { species: mol.atoms.map(a => a.el), xyz: xyz.map(p => sub(p, o)) };
}
function massOf(sp) { const z = zOf(sp); return z === 1 ? 1.008 : 2 * z + (z > 20 ? 0.5 : 0); }
function bondsOf(species, xyz, tol = 0.45) {
  const out = [];
  for (let i = 0; i < xyz.length; i++) for (let j = i + 1; j < xyz.length; j++) {
    const d = norm(sub(xyz[i], xyz[j]));
    if (d > 0.4 && d < covOf(species[i]) + covOf(species[j]) + tol) out.push([i, j]);
  }
  return out;
}
// same molecule placement? (rotated atom sets coincide, species respected)
function samePlacement(species, xyz, R1, R2, tol = 0.02) {
  const P1 = xyz.map(p => mv(R1, p)), P2 = xyz.map(p => mv(R2, p));
  const used = new Array(P2.length).fill(false);
  for (let i = 0; i < P1.length; i++) {
    let found = -1;
    for (let j = 0; j < P2.length; j++) if (!used[j] && species[j] === species[i] && norm(sub(P1[i], P2[j])) < tol) { found = j; break; }
    if (found < 0) return false;
    used[found] = true;
  }
  return true;
}
// expand an orientation group: base Euler orientation, then symmetry operations
function expandGroup(group, mol, A) {
  const local = moleculeLocal(mol);
  const R0 = eulerMatrix(group.convention || "ZYZ", +group.euler[0] || 0, +group.euler[1] || 0, +group.euler[2] || 0);
  const errors = [], ops = [];
  (group.ops || "").split("\n").forEach((line, k) => {
    try { const op = parseOp(line, A); if (op) ops.push(op); } catch (e) { errors.push(`line ${k + 1}: ${e.message}`); }
  });
  let G;
  if (group.closure) {
    try { G = closure(ops.map(o => o.R)); } catch (e) { errors.push(e.message); G = [I3()]; }
  } else G = [I3(), ...ops.map(o => o.R)];
  const out = [];
  for (const g of G) {
    const R = clean(group.frame === "molecule" ? mul(R0, g) : mul(g, R0));
    const dup = out.findIndex(o => samePlacement(local.species, local.xyz, o.R, R));
    if (dup >= 0) { out[dup].multiplicity++; continue; }
    out.push({ R, improper: det(R) < 0, multiplicity: 1 });
  }
  return { orientations: out, errors, nOps: G.length };
}

// ---------------------------------------------------------------------------------- random numbers
function rng32(seed) {
  let a = (seed >>> 0) || 1;
  const next = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  next.normal = () => { let u = 0; while (u === 0) u = next(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next()); };
  next.int = n => Math.floor(next() * n);
  return next;
}

// ---------------------------------------------------------------------------------- model → classes
function orientationTable(state, A) {
  const tab = {};
  for (const g of state.orientations) {
    const mol = state.molecules.find(m => m.id === g.molecule);
    if (!mol) continue;
    const ex = expandGroup(g, mol, A);
    const w = ex.orientations.map((o, k) => {
      const v = g.weights && g.weights[k] != null ? +g.weights[k] : 1;
      return isFinite(v) && v >= 0 ? v : 0;
    });
    tab[g.id] = { group: g, mol, orientations: ex.orientations, weights: w, errors: ex.errors, nOps: ex.nOps };
  }
  return tab;
}
function siteClasses(site, otab) {
  const cls = [];
  for (const o of site.occupants) {
    const p = +o.p;
    if (!(p > 0)) continue;
    const ov = k => (o[k] === "" || o[k] == null || !isFinite(+o[k]) ? null : +o[k]);
    const over = { sigma: ov("sigma"), trans: ov("trans"), lib: ov("lib") };
    if (o.type === "atom") cls.push({ type: "atom", species: o.species, p, b: o.b, key: "atom:" + o.species, ...over });
    else if (o.type === "vacancy") cls.push({ type: "vacancy", p, key: "vacancy" });
    else if (o.type === "molecule") {
      const t = otab[o.group];
      if (!t) continue;
      const ws = t.weights.reduce((x, y) => x + y, 0) || 1;
      t.orientations.forEach((or, k) => {
        if (t.weights[k] > 0) cls.push({ type: "molecule", group: o.group, index: k, R: or.R, mol: t.mol, p: p * t.weights[k] / ws, b: o.b, key: `mol:${o.group}:${k}`, ...over });
      });
    }
  }
  return cls;
}

// ---------------------------------------------------------------------------------- realisation (preview)
function realize(state, opts = {}) {
  const n = opts.n || state.supercell.map(Number);
  const A = latticeMatrix(state.cell);
  const otab = orientationTable(state, A);
  const rnd = rng32(opts.seed != null ? opts.seed : +state.seed || 1);
  const classes = state.sites.map(s => siteClasses(s, otab));
  const ncell = n[0] * n[1] * n[2];
  const idx = (x, y, z) => x + n[0] * (y + n[1] * z);
  const choice = classes.map((cl, s) => {
    const arr = new Int32Array(ncell);
    const p = cl.map(c => c.p), tot = p.reduce((a, b) => a + b, 0);
    if (!cl.length) return arr;
    if (state.sites[s].draw === "exact") {
      const counts = p.map(x => Math.floor(x / tot * ncell));
      let rest = ncell - counts.reduce((a, b) => a + b, 0);
      const order = p.map((x, i) => [x / tot * ncell - counts[i] + rnd() * 1e-9, i]).sort((a, b) => b[0] - a[0]);
      for (let k = 0; k < rest; k++) counts[order[k][1]]++;
      let pos = 0; counts.forEach((c, i) => { for (let k = 0; k < c; k++) arr[pos++] = i; });
      for (let i = ncell - 1; i > 0; i--) { const j = rnd.int(i + 1); const t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
    } else {
      for (let c = 0; c < ncell; c++) { let u = rnd() * tot, k = 0; while (k < p.length - 1 && u >= p[k]) { u -= p[k]; k++; } arr[c] = k; }
    }
    return arr;
  });
  // ordering Monte Carlo: neighbour energies J (same / different occupant) and contact penalties
  // (same model as the Python script; separate random stream)
  const ord = orderingMC(state, A, classes, choice, n, rnd, opts);
  const report = ord.report, contactReport = ord.contactReport;
  // place atoms
  const rig = state.disorder.molecule_rigid || {}, tS = +rig.translation_sigma || 0, lS = +rig.libration_sigma_deg || 0;
  const disp = state.disorder.atomic_displacements || {};
  const atoms = [];
  let molCount = 0;
  for (let z = 0; z < n[2]; z++) for (let y = 0; y < n[1]; y++) for (let x = 0; x < n[0]; x++) {
    const c = idx(x, y, z);
    state.sites.forEach((site, s) => {
      const cl = classes[s][choice[s][c]];
      if (!cl) return;
      const centre = frac2cart(A, add([x, y, z], site.frac.map(Number)));
      if (cl.type === "atom") atoms.push({ el: cl.species, p: centre, cell: [x, y, z], site: s, cls: choice[s][c], mol: -1, sigma: cl.sigma });
      else if (cl.type === "molecule") {
        const loc = moleculeLocal(cl.mol);
        let R = cl.R;
        const l = cl.lib == null ? lS : cl.lib, t = cl.trans == null ? tS : cl.trans;
        if (l > 0) { const ax = [rnd.normal(), rnd.normal(), rnd.normal()]; R = mul(R, axisAngle(ax, rnd.normal() * l)); }
        const sh = t > 0 ? [rnd.normal() * t, rnd.normal() * t, rnd.normal() * t] : [0, 0, 0];
        loc.xyz.forEach((p, j) => atoms.push({ el: loc.species[j], p: add(add(centre, sh), mv(R, p)), cell: [x, y, z], site: s, cls: choice[s][c], mol: molCount, orient: cl.index, group: cl.group, sigma: cl.sigma }));
        molCount++;
      }
    });
  }
  for (const a of atoms) { const s = a.sigma != null ? a.sigma : (+disp[a.el] || 0); if (s > 0) a.p = add(a.p, [rnd.normal() * s, rnd.normal() * s, rnd.normal() * s]); }
  return { atoms, n, A, report, contactReport, classes, nMolecules: molCount };
}

// ---------------------------------------------------------------------------------- forbidden contacts
const PENALTY = { forbidden: 100, strong: 10, mild: 2 };
// van der Waals radii (Å, Bondi 1964 / Alvarez 2013 for a few) used to suggest contact rules
const VDW = { H: 1.20, C: 1.70, N: 1.55, O: 1.52, F: 1.47, P: 1.80, S: 1.80, Cl: 1.75, Br: 1.85, I: 1.98, Se: 1.90, Si: 2.10,
  B: 1.92, As: 1.85, Te: 2.06, Xe: 2.16, Kr: 2.02, Ar: 1.88, Ne: 1.54, He: 1.40 };
function ruleMatch(r, e1, e2) {
  const m = (x, y) => x === "any" || x === y;
  return (m(r.a, e1) && m(r.b, e2)) || (m(r.a, e2) && m(r.b, e1));
}
// For every pair of neighbouring site positions, a table of penalties (and contact counts) for each pair of
// occupants. Atoms are placed at their ideal positions (no translation / libration / displacement noise).
function contactModel(state, A, classes) {
  const con = state.disorder.contacts || {};
  const rules = (con.rules || []).filter(r => +r.dmin > 0 && +r.penalty > 0).map(r => ({ a: r.a, b: r.b, d2: (+r.dmin) ** 2, pen: +r.penalty }));
  const sites = state.sites;
  if (!rules.length) return { entries: sites.map(() => []), pairs: [], rules };
  const otab = {};
  const shapes = classes.map(cl => cl.map(c => {
    if (c.type === "atom") return { el: [elementOf(c.species) || c.species], p: [[0, 0, 0]] };
    if (c.type === "molecule") { const loc = moleculeLocal(c.mol); return { el: loc.species, p: loc.xyz.map(q => mv(c.R, q)) }; }
    return { el: [], p: [] };
  }));
  void otab;
  const R = shapes.map(sh => Math.max(0, ...sh.flatMap(x => x.p.map(norm))));
  const dmax = Math.sqrt(Math.max(...rules.map(r => r.d2)));
  const Ainv = inv(A), recip = [0, 1, 2].map(k => Math.hypot(Ainv[0][k], Ainv[1][k], Ainv[2][k]));
  const entries = sites.map(() => []), pairs = [];
  sites.forEach((s1, i) => sites.forEach((s2, j) => {
    const cut = R[i] + R[j] + dmax, m = recip.map(r => Math.ceil(cut * r) + 1);
    for (let tx = -m[0]; tx <= m[0]; tx++) for (let ty = -m[1]; ty <= m[1]; ty++) for (let tz = -m[2]; tz <= m[2]; tz++) {
      if (i === j && !tx && !ty && !tz) continue;
      const off = frac2cart(A, [tx + +s2.frac[0] - +s1.frac[0], ty + +s2.frac[1] - +s1.frac[1], tz + +s2.frac[2] - +s1.frac[2]]);
      const dist = norm(off);
      if (dist > cut + 1e-9) continue;
      const K = classes[i].length, L = classes[j].length;
      const table = new Float64Array(K * L), count = new Int32Array(K * L);
      let any = false;
      for (let k = 0; k < K; k++) for (let l = 0; l < L; l++) {
        const a = shapes[i][k], b = shapes[j][l];
        let e = 0, c = 0;
        for (let u = 0; u < a.p.length; u++) for (let v = 0; v < b.p.length; v++) {
          const dx = off[0] + b.p[v][0] - a.p[u][0], dy = off[1] + b.p[v][1] - a.p[u][1], dz = off[2] + b.p[v][2] - a.p[u][2];
          const d2 = dx * dx + dy * dy + dz * dz;
          let hit = false;
          for (const r of rules) if (d2 < r.d2 && ruleMatch(r, a.el[u], b.el[v])) { e += r.pen; hit = true; }
          if (hit) c++;
        }
        table[k * L + l] = e; count[k * L + l] = c; if (e) any = true;
      }
      if (any) { entries[i].push({ o: j, t: [tx, ty, tz], table, count, L }); if (i <= j) pairs.push({ i, j, t: [tx, ty, tz], dist, table, count, K, L }); }
    }
  }));
  return { entries, pairs, rules };
}

function orderingMC(state, A, classes, choice, n, rnd, opts) {
  const corr = state.disorder.correlations || {}, con = state.disorder.contacts || {};
  const ncell = n[0] * n[1] * n[2];
  const potts = corr.enabled ? corr.interactions.filter(it => +it.J !== 0) : [];
  const cm = con.enabled ? contactModel(state, A, classes) : { entries: state.sites.map(() => []), pairs: [] };
  const useContacts = cm.pairs.length > 0;
  const report = [];
  if (!potts.length && !useContacts) return { report, contactReport: null };
  const byGroup = corr.match === "group";
  const ids = {};
  const key = classes.map(cl => Int32Array.from(cl.map(c => { const k = byGroup && c.group ? c.group : c.key; if (!(k in ids)) ids[k] = Object.keys(ids).length; return ids[k]; })));
  const change = con.change || (con.reorient === false ? "none" : "orientation");
  // occupants a run may turn into each other: orientations of one group, or every molecule of the site
  const fam = classes.map(cl => cl.map(c => (c.type === "molecule" ? (change === "group" ? "mol" : "mol:" + c.group) : c.key)));
  const wrap = (v, m) => ((v % m) + m) % m;
  const shiftMap = t => { const mp = new Int32Array(ncell);
    for (let z = 0; z < n[2]; z++) for (let y = 0; y < n[1]; y++) for (let x = 0; x < n[0]; x++)
      mp[x + n[0] * (y + n[1] * z)] = wrap(x + t[0], n[0]) + n[0] * (wrap(y + t[1], n[1]) + n[1] * wrap(z + t[2], n[2]));
    return mp; };
  const maps = {};
  const mapOf = t => (maps[t.join(",")] = maps[t.join(",")] || shiftMap(t));
  const nb = state.sites.map(() => []);
  potts.forEach(it => {
    const a = +it.site_a, b = +it.site_b, t = it.t.map(Number), J = +it.J;
    nb[a].push({ o: b, map: mapOf(t), J });
    nb[b].push({ o: a, map: mapOf(t.map(x => -x)), J });
  });
  cm.entries.forEach((list, i) => list.forEach(e => nb[i].push({ o: e.o, map: mapOf(e.t), table: e.table, count: e.count, L: e.L })));
  const term = (s, e, k, k2) => (e.table ? e.table[k * e.L + k2] : (key[s][k] === key[e.o][k2] ? e.J : 0));
  const local = (s, c, k, excl) => {
    let E = 0;
    for (const e of nb[s]) { const c2 = e.map[c]; if (e.o === s && c2 === excl) continue; E += term(s, e, k, choice[e.o][c2]); }
    return E;
  };
  const bond = (s, c1, k1, c2, k2) => { let E = 0; for (const e of nb[s]) if (e.o === s && e.map[c1] === c2) E += term(s, e, k1, k2); return E; };
  const measure = () => potts.map(it => {
    const a = +it.site_a, b = +it.site_b, mp = mapOf(it.t.map(Number)); let same = 0;
    for (let c = 0; c < ncell; c++) if (key[a][choice[a][c]] === key[b][choice[b][mp[c]]]) same++;
    return same / ncell;
  });
  const contacts = () => { let tot = 0;
    cm.entries.forEach((list, i) => list.forEach(e => { const mp = mapOf(e.t); for (let c = 0; c < ncell; c++) tot += e.count[choice[i][c] * e.L + choice[e.o][mp[c]]]; }));
    return tot / 2; };
  const before = measure(), cBefore = useContacts ? contacts() : 0;
  const kT = +corr.kT || 1, sweeps = Math.min(+corr.sweeps || 0, opts.maxSweeps || 1e9);
  const reorient = useContacts && change !== "none", anneal = useContacts && con.anneal !== false;
  const famIdx = classes.map((cl, s) => { const g = {}; cl.forEach((c, k) => { (g[fam[s][k]] = g[fam[s][k]] || []).push(k); }); return cl.map((c, k) => g[fam[s][k]]); });
  for (let sw = 0; sw < sweeps; sw++) {
    const T = anneal ? kT * Math.pow(10, Math.max(0, 1 - sw / Math.max(1, 0.6 * sweeps))) : kT;
    for (let s = 0; s < classes.length; s++) {
      if (!nb[s].length || classes[s].length < 2) continue;
      const cls = classes[s];
      for (let it = 0; it < ncell; it++) {
        if (reorient) { // pick a new orientation of the same molecule group, proposed with the group's weights
          const c = rnd.int(ncell), x = choice[s][c], opts2 = famIdx[s][x];
          if (opts2.length > 1) {
            let u = rnd() * opts2.reduce((a, k) => a + cls[k].p, 0), y = opts2[0];
            for (const k of opts2) { u -= cls[k].p; if (u <= 0) { y = k; break; } }
            if (y !== x) {
              const dE = local(s, c, y, -1) - local(s, c, x, -1);
              if (dE <= 0 || rnd() < Math.exp(-dE / T)) choice[s][c] = y;
            }
          }
        }
        const c1 = rnd.int(ncell), c2 = rnd.int(ncell), x1 = choice[s][c1], x2 = choice[s][c2];
        if (c1 === c2 || fam[s][x1] === fam[s][x2] && (reorient || key[s][x1] === key[s][x2])) continue;
        if (!useContacts && key[s][x1] === key[s][x2]) continue;
        const e0 = local(s, c1, x1, c2) + local(s, c2, x2, c1) + bond(s, c1, x1, c2, x2);
        choice[s][c1] = x2; choice[s][c2] = x1;
        const dE = local(s, c1, x2, c2) + local(s, c2, x1, c1) + bond(s, c1, x2, c2, x1) - e0;
        if (!(dE <= 0 || rnd() < Math.exp(-dE / T))) { choice[s][c1] = x1; choice[s][c2] = x2; }
      }
    }
  }
  const after = measure();
  potts.forEach((it, i) => report.push({ it, before: before[i], after: after[i] }));
  let contactReport = null;
  if (useContacts) {
    const pop = classes.map((cl, s) => { const h = new Array(cl.length).fill(0); for (let c = 0; c < ncell; c++) h[choice[s][c]]++; return h.map(x => x / ncell); });
    contactReport = { before: cBefore, after: contacts(), pairs: cm.pairs, populations: pop, cells: ncell };
  }
  return { report, contactReport };
}

// ---------------------------------------------------------------------------------- diffuse preview (f = Z)
// I_diff(h) = (|Σ f e^{2πi h·x}|² − |Σ_cells e^{2πi h·R} ⟨F_cell⟩|²) / N_cells, x in unit-cell fractions.
function diffusePlaneRows(real, plane) {
  const { atoms, n, A } = real;
  const Ainv = inv(A), ncell = n[0] * n[1] * n[2];
  const loc = new Float64Array(atoms.length * 3), f = new Float64Array(atoms.length), cid = new Int32Array(atoms.length);
  atoms.forEach((a, i) => {
    const fr = [a.p[0] * Ainv[0][0] + a.p[1] * Ainv[1][0] + a.p[2] * Ainv[2][0], a.p[0] * Ainv[0][1] + a.p[1] * Ainv[1][1] + a.p[2] * Ainv[2][1], a.p[0] * Ainv[0][2] + a.p[1] * Ainv[1][2] + a.p[2] * Ainv[2][2]];
    loc[3 * i] = fr[0] - a.cell[0]; loc[3 * i + 1] = fr[1] - a.cell[1]; loc[3 * i + 2] = fr[2] - a.cell[2];
    f[i] = zOf(a.el); cid[i] = a.cell[0] + n[0] * (a.cell[1] + n[1] * a.cell[2]);
  });
  const step = 1 / Math.max(...n), m = Math.round(plane.range / step), t = [];
  for (let k = -m; k <= m; k++) t.push(k * step);
  const P = t.length, u = plane.u.map(Number), v = plane.v.map(Number), o = (plane.origin || [0, 0, 0]).map(x => +x || 0);
  const Fr = new Float64Array(ncell * P), Fi = new Float64Array(ncell * P);
  const rows = [];
  function row(a) {
    Fr.fill(0); Fi.fill(0);
    const ta = t[a];
    for (let i = 0; i < atoms.length; i++) {
      const base = cid[i] * P, x = loc[3 * i], y = loc[3 * i + 1], z = loc[3 * i + 2];
      const p0 = o[0] * x + o[1] * y + o[2] * z + ta * (u[0] * x + u[1] * y + u[2] * z), dp = v[0] * x + v[1] * y + v[2] * z;
      for (let b = 0; b < P; b++) { const ph = 2 * Math.PI * (p0 + t[b] * dp); Fr[base + b] += f[i] * Math.cos(ph); Fi[base + b] += f[i] * Math.sin(ph); }
    }
    const out = new Float64Array(P);
    for (let b = 0; b < P; b++) {
      const H = [o[0] + ta * u[0] + t[b] * v[0], o[1] + ta * u[1] + t[b] * v[1], o[2] + ta * u[2] + t[b] * v[2]];
      let sr = 0, si = 0, mr = 0, mi = 0, lr = 0, li = 0;
      for (let c = 0; c < ncell; c++) {
        const cx = c % n[0], cy = Math.floor(c / n[0]) % n[1], cz = Math.floor(c / (n[0] * n[1]));
        const ph = 2 * Math.PI * (H[0] * cx + H[1] * cy + H[2] * cz), co = Math.cos(ph), sn = Math.sin(ph);
        const fr = Fr[c * P + b], fi = Fi[c * P + b];
        sr += fr * co - fi * sn; si += fr * sn + fi * co;
        mr += fr; mi += fi; lr += co; li += sn;
      }
      mr /= ncell; mi /= ncell;
      const ar = mr * lr - mi * li, ai = mr * li + mi * lr;
      out[b] = (sr * sr + si * si - ar * ar - ai * ai) / ncell;
    }
    return out;
  }
  return { t, P, row };
}

// ---------------------------------------------------------------------------------- space groups
// "x,-y+1/2,z+1/4" or "2x,x,1/4" -> { M (3×3 on x, y, z), t (translation) }
function parseAffine(str) {
  const parts = String(str).replace(/\s+/g, "").split(",");
  if (parts.length !== 3) throw new Error(`"${str}" needs three comma-separated parts`);
  const M = [], t = [];
  parts.forEach(p => {
    const row = [0, 0, 0]; let tr0 = 0;
    const re = /([+-]?)(\d*\.?\d*(?:\/\d+)?)(\*?)([xyz]?)/gi;
    let m;
    while ((m = re.exec(p)) !== null) {
      if (m[0] === "") { re.lastIndex++; if (re.lastIndex > p.length) break; continue; }
      let c = m[2] === "" ? 1 : m[2].includes("/") ? Number(m[2].split("/")[0] || 1) / Number(m[2].split("/")[1]) : Number(m[2]);
      if (!isFinite(c)) throw new Error(`cannot read "${p}"`);
      if (m[1] === "-") c = -c;
      if (m[4]) row["xyz".indexOf(m[4].toLowerCase())] += c; else if (m[2] !== "") tr0 += c;
    }
    M.push(row); t.push(tr0);
  });
  return { M, t };
}
// which of x, y, z are free in a Wyckoff representative ("x,x,1/4" -> ["x"])
function freeParams(rep) { const { M } = parseAffine(rep); return ["x", "y", "z"].filter((v, k) => M.some(r => r[k] !== 0)); }
// all positions in [0, 1)³ generated from a Wyckoff representative with given free parameters
function wyckoffOrbit(sg, rep, free, tol = 1e-4) {
  const { M, t } = parseAffine(rep), x = [+free.x || 0, +free.y || 0, +free.z || 0];
  const p0 = [0, 1, 2].map(i => M[i][0] * x[0] + M[i][1] * x[1] + M[i][2] * x[2] + t[i]);
  const out = [];
  const w = v => { let r = v - Math.floor(v); if (r > 1 - tol) r = 0; return Math.abs(r) < tol ? 0 : r; };
  for (const g of sg.g) {
    const { M: R, t: s } = parseAffine(g);
    const p = [0, 1, 2].map(i => w(R[i][0] * p0[0] + R[i][1] * p0[1] + R[i][2] * p0[2] + s[i]));
    if (!out.some(q => q.every((v, i) => { const d = Math.abs(v - p[i]); return Math.min(d, 1 - d) < tol; }))) out.push(p.map(v => +v.toFixed(6)));
  }
  return out;
}
// crystal system of a space-group number and whether a cell fits it
function crystalSystem(n) {
  return n <= 2 ? "triclinic" : n <= 15 ? "monoclinic" : n <= 74 ? "orthorhombic" : n <= 142 ? "tetragonal" : n <= 167 ? "trigonal" : n <= 194 ? "hexagonal" : "cubic";
}
function fitCell(n, cell) {
  const c = { ...cell }, sys = crystalSystem(n), r = x => +(+x).toFixed(6);
  if (sys === "monoclinic") { c.alpha = 90; c.gamma = 90; }
  if (sys === "orthorhombic") { c.alpha = c.beta = c.gamma = 90; }
  if (sys === "tetragonal") { c.b = c.a; c.alpha = c.beta = c.gamma = 90; }
  if (sys === "trigonal" || sys === "hexagonal") { c.b = c.a; c.alpha = c.beta = 90; c.gamma = 120; }
  if (sys === "cubic") { c.b = c.c = c.a; c.alpha = c.beta = c.gamma = 90; }
  Object.keys(c).forEach(k => { c[k] = r(c[k]); });
  return c;
}
function cellFits(n, cell) {
  const f = fitCell(n, cell);
  return ["a", "b", "c", "alpha", "beta", "gamma"].every(k => Math.abs(+f[k] - +cell[k]) < 1e-4);
}

// ---------------------------------------------------------------------------------- plane geometry
// Reciprocal vectors (Å⁻¹, 2π convention) of hkl directions u and v, expressed in an orthonormal basis of the
// plane: e1 along u. Used to draw a preview plane with its true proportions and angle.
function planeGeometry(A, u, v) {
  const B = tr(inv(A)).map(r => r.map(x => 2 * Math.PI * x));        // rows a*, b*, c*
  const g = h => [0, 1, 2].map(k => h[0] * B[0][k] + h[1] * B[1][k] + h[2] * B[2][k]);
  const gu = g(u.map(Number)), gv = g(v.map(Number));
  const lu = norm(gu), lv = norm(gv);
  if (!(lu > 0) || !(lv > 0)) throw new Error("u and v must not be zero");
  const e1 = scale(gu, 1 / lu), x = gv[0] * e1[0] + gv[1] * e1[1] + gv[2] * e1[2];
  const perp = sub(gv, scale(e1, x)), y = norm(perp);
  if (y < 1e-9 * lv) throw new Error("u and v are parallel");
  return { u2: [lu, 0], v2: [x, y], lu, lv, angle: Math.acos(Math.max(-1, Math.min(1, x / lv))) * 180 / Math.PI };
}
function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a; }
// Reciprocal-lattice layer {H : H · [n] = L} for an integer direction n = [n1 n2 n3]: a reduced integer basis
// u, v of the layer (shortest vectors in Å⁻¹) and an offset point of the layer.
function zonePlane(A, n, L = 0) {
  n = n.map(x => Math.round(+x));
  if (n.every(x => x === 0)) throw new Error("the plane normal must not be 0 0 0");
  const B = tr(inv(A));
  const len = h => norm([0, 1, 2].map(k => h[0] * B[0][k] + h[1] * B[1][k] + h[2] * B[2][k]));
  const R = 8, cand = [];
  for (let h = -R; h <= R; h++) for (let k = -R; k <= R; k++) for (let l = -R; l <= R; l++) {
    if (!h && !k && !l) continue;
    if (h * n[0] + k * n[1] + l * n[2] === 0) cand.push({ h: [h, k, l], len: len([h, k, l]) });
  }
  if (cand.length < 2) throw new Error("no lattice vectors in this plane within ±8; use smaller indices");
  const g = gcd(gcd(n[0], n[1]), n[2]), target = n.map(x => x / g);
  cand.sort((a, b) => a.len - b.len || (b.h[0] - a.h[0]) || (b.h[1] - a.h[1]) || (b.h[2] - a.h[2]));
  const u = cand[0].h;
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  // v: shortest vector that completes u to a basis of the layer, preferring an obtuse-free (reduced) angle
  let v = null;
  for (const c of cand) {
    const x = cross(u, c.h);
    if (x.every((q, i) => q === target[i]) || x.every((q, i) => q === -target[i])) {
      const w = x.every((q, i) => q === target[i]) ? c.h : c.h.map(q => -q);
      if (!v || c.len < v.len - 1e-9) v = { h: w, len: c.len };
    }
  }
  if (!v) throw new Error("could not find a basis for this plane");
  // prefer the acute pair (60° rather than 120°); u + v spans the same layer with the same handedness
  const g3 = h => [0, 1, 2].map(k => h[0] * B[0][k] + h[1] * B[1][k] + h[2] * B[2][k]);
  const gu = g3(u), gv = g3(v.h);
  if (gu[0] * gv[0] + gu[1] * gv[1] + gu[2] * gv[2] < -1e-12) { const w = v.h.map((q, i) => q + u[i]); if (len(w) <= v.len + 1e-9) v = { h: w, len: len(w) }; }
  // offset: an integer point of layer L if one exists (L a multiple of gcd), else L·n/|n|²
  let origin = [0, 0, 0];
  if (+L) {
    let best = null;
    if (Number.isInteger(+L) && +L % g === 0) {
      for (let h = -R; h <= R; h++) for (let k = -R; k <= R; k++) for (let l = -R; l <= R; l++)
        if (h * n[0] + k * n[1] + l * n[2] === +L) { const d = len([h, k, l]); if (!best || d < best.d) best = { h: [h, k, l], d }; }
    }
    origin = best ? best.h : n.map(x => +((+L * x) / (n[0] * n[0] + n[1] * n[1] + n[2] * n[2])).toFixed(6));
  }
  return { u, v: v.h, origin };
}

// ---------------------------------------------------------------------------------- validation
function validate(state) {
  const errs = [], warns = [];
  let A;
  try { A = latticeMatrix(state.cell); } catch (e) { errs.push(e.message); return { errs, warns }; }
  const n = state.supercell.map(Number);
  if (n.some(x => !(Number.isInteger(x) && x >= 1))) errs.push("Supercell needs three whole numbers ≥ 1.");
  if (!state.sites.length) errs.push("Add at least one site.");
  const otab = orientationTable(state, A);
  Object.values(otab).forEach(t => t.errors.forEach(e => errs.push(`Orientation group “${t.group.name}”: ${e}`)));
  state.molecules.forEach(m => {
    if (!m.atoms.length) errs.push(`Molecule “${m.name}” has no atoms.`);
    m.atoms.forEach((a, i) => { if (!elementOf(a.el)) errs.push(`Molecule “${m.name}”, atom ${i + 1}: “${a.el}” is not an element symbol.`); });
  });
  const labels = new Set();
  state.sites.forEach(s => {
    if (!/^[A-Za-z0-9_]{1,10}$/.test(s.label)) errs.push(`Site label “${s.label}”: use 1–10 letters, digits or _.`);
    if (labels.has(s.label)) errs.push(`Site label “${s.label}” is used twice.`);
    labels.add(s.label);
    const tot = s.occupants.reduce((a, o) => a + (+o.p || 0), 0);
    if (Math.abs(tot - 1) > 1e-6) errs.push(`Site ${s.label}: probabilities add up to ${tot.toFixed(4)}, not 1.`);
    s.occupants.forEach(o => {
      if (o.type === "atom") {
        if (!elementOf(o.species)) errs.push(`Site ${s.label}: “${o.species}” is not an element symbol.`);
        else if (o.species.length > 4) errs.push(`Site ${s.label}: species names longer than 4 characters break DISCUS.`);
      }
      if (o.type === "molecule") {
        const t = otab[o.group];
        if (!t) errs.push(`Site ${s.label}: pick an orientation group for the molecule.`);
        else if (!t.weights.some(w => w > 0)) errs.push(`Site ${s.label}: group “${t.group.name}” has no orientation with weight > 0.`);
        else if (t.orientations.some((x, k) => x.improper && t.weights[k] > 0)) warns.push(`Group “${t.group.name}” uses improper operations: those orientations are mirror images of the molecule.`);
      }
      if (+o.p < 0) errs.push(`Site ${s.label}: negative probability.`);
      ["sigma", "trans", "lib"].forEach(k => { if (o[k] !== "" && o[k] != null && !(+o[k] >= 0)) errs.push(`Site ${s.label}: disorder values must be ≥ 0.`); });
    });
  });
  const con = state.disorder.contacts || {};
  if (con.enabled) {
    if (!(con.rules || []).length) errs.push("Forbidden contacts: add at least one rule or switch them off.");
    (con.rules || []).forEach((r, i) => {
      if (!(+r.dmin > 0)) errs.push(`Forbidden contacts, rule ${i + 1}: the minimum distance must be > 0.`);
      if (!(+r.penalty > 0)) errs.push(`Forbidden contacts, rule ${i + 1}: the penalty must be > 0.`);
      [r.a, r.b].forEach(e => { if (e !== "any" && !Z[e]) errs.push(`Forbidden contacts, rule ${i + 1}: “${e}” is not an element.`); });
    });
    if (!(+(state.disorder.correlations || {}).sweeps > 0)) errs.push("Forbidden contacts need at least one Monte Carlo sweep (Disorder → sweeps).");
  }
  const hasMol = state.sites.some(s => s.occupants.some(o => o.type === "molecule" && +o.p > 0));
  if (state.mmc.enabled && hasMol) errs.push("DISCUS Monte Carlo works on atom-only models; switch it off or remove molecules.");
  if (state.mmc.enabled) {
    const nfb = state.mmc.targets.filter(t => t.mode === "correlation" && (t.type === "occupational" || t.type === "displacement")).length;
    if (nfb > 1) errs.push("Monte Carlo: only one target may use a correlation (feedback); give the others energies.");
    if (n.some(x => x < 2)) errs.push("Monte Carlo needs at least 2 cells along every axis.");
    if (!state.mmc.targets.length) errs.push("Monte Carlo: add a target.");
  }
  const f3 = state.calc.fourier;
  if (f3.enabled) {
    f3.steps.forEach((s, k) => {
      const per = 1 / +s;
      if (!(+s > 0)) errs.push("3D grid steps must be positive.");
      else if (Math.abs(per - Math.round(per)) > 1e-6 || n[k] % Math.round(per) !== 0)
        warns.push(`3D grid step along ${"hkl"[k]} (${(+s).toPrecision(4)}) is not 1/m with m dividing the supercell (${n[k]}); the diffuse pattern will show finite-size ripples. Use 1/${n[k]} or 1/${n[k] / 2 || 1}.`);
    });
    const shape = f3.steps.map((s, k) => 2 * Math.round(+f3.hmax[k] / +s) + 1);
    const vox = shape.reduce((a, b) => a * b, 1);
    if (vox > 3e7) warns.push(`3D grid has ${(vox / 1e6).toFixed(0)} million points; the HDF5 file and the FFT will be large.`);
    if (f3.lots.enabled && f3.lots.size.some((s, k) => +s > n[k])) errs.push("LOTS larger than the crystal (DISCUS error −101).");
  }
  const p = state.calc.pdf;
  if (p.enabled) {
    const lam = +p.wavelength || (p.radiation === "neutron" ? 1.54 : 1.5406);
    if (+p.qmax * lam > 12) warns.push(`1D PDF: DISCUS 6.23.01 cannot use Q above ≈ ${(12.3 / lam).toFixed(1)} Å⁻¹ at λ = ${lam} Å; Qmax ${p.qmax} behaves like ${(12.3 / lam).toFixed(1)}.`);
    const r = +p.rmax / +p.dr;
    if (Math.abs(r - Math.round(r)) > 1e-7) errs.push("1D PDF: rmax must be a whole number of dr steps.");
    const L = Math.min(...n.map((x, k) => x * norm(A[k])));
    if (+p.rmax > L / 2) warns.push(`1D PDF: rmax ${p.rmax} Å exceeds half the smallest crystal dimension (${(L / 2).toFixed(1)} Å); DISCUS's Debye sum treats the supercell as a finite particle.`);
  }
  if (state.calc.debye_waller) {
    const bad = state.sites.some(s => (+s.b_iso || 0) < 0.001) || state.sites.some(s => s.occupants.some(o => o.b != null && o.b !== "" && +o.b < 0.001));
    if (bad) errs.push("Debye–Waller on: every B must be ≥ 0.001 Å² (DISCUS replaces smaller values by 1).");
  }
  return { errs, warns };
}

// ---------------------------------------------------------------------------------- export
function buildConfig(state) {
  const A = latticeMatrix(state.cell);
  const otab = orientationTable(state, A);
  const molecules = {}, orientations = {};
  state.molecules.forEach(m => { molecules[m.id] = { name: m.name, anchor: m.anchor, atoms: m.atoms.map(a => ({ el: a.el, xyz: a.xyz.map(Number) })) }; });
  Object.entries(otab).forEach(([gid, t]) => {
    orientations[gid] = {
      molecule: t.mol.id, name: t.group.name,
      matrices: t.orientations.map(o => o.R.map(r => r.map(x => +x.toFixed(12)))),
      weights: t.weights,
      definition: { convention: t.group.convention, euler_deg: t.group.euler.map(Number), ops: t.group.ops, frame: t.group.frame, closure: !!t.group.closure },
    };
  });
  const num = v => (v === "" || v == null ? null : +v);
  return {
    schema: "discuspdf-disorder-builder", version: 1, title: state.title, seed: +state.seed,
    output_dir: state.output_dir || "discus_model_out",
    cell: Object.fromEntries(["a", "b", "c", "alpha", "beta", "gamma"].map(k => [k, +state.cell[k]])),
    supercell: state.supercell.map(Number), molecules, orientations,
    sites: state.sites.map(s => ({
      label: s.label, frac: s.frac.map(Number), b_iso: +s.b_iso || 1, draw: s.draw,
      occupants: s.occupants.map(o => o.type === "atom" ? { type: "atom", species: o.species, p: +o.p, b: num(o.b), sigma: num(o.sigma) }
        : o.type === "molecule" ? { type: "molecule", group: o.group, p: +o.p, b: num(o.b), sigma: num(o.sigma), trans: num(o.trans), lib: num(o.lib) }
        : { type: "vacancy", p: +o.p }),
    })),
    disorder: {
      atomic_displacements: Object.fromEntries(Object.entries(state.disorder.atomic_displacements).filter(([, v]) => +v > 0).map(([k, v]) => [k, +v])),
      molecule_rigid: { translation_sigma: +state.disorder.molecule_rigid.translation_sigma || 0, libration_sigma_deg: +state.disorder.molecule_rigid.libration_sigma_deg || 0 },
      clash_threshold: +state.disorder.clash_threshold || 0.8,
      contacts: { enabled: !!(state.disorder.contacts || {}).enabled, change: (state.disorder.contacts || {}).change || "orientation",
        anneal: (state.disorder.contacts || {}).anneal !== false,
        rules: ((state.disorder.contacts || {}).rules || []).map(r => ({ a: r.a, b: r.b, dmin: +r.dmin, penalty: +r.penalty })) },
      correlations: { ...state.disorder.correlations, sweeps: +state.disorder.correlations.sweeps, kT: +state.disorder.correlations.kT,
        interactions: state.disorder.correlations.interactions.map(i => ({ site_a: +i.site_a, site_b: +i.site_b, t: i.t.map(Number), J: +i.J })) },
    },
    mmc: state.mmc.enabled ? JSON.parse(JSON.stringify(state.mmc)) : { enabled: false },
    calc: JSON.parse(JSON.stringify(state.calc)),
    builder_state: JSON.parse(JSON.stringify(state)),
  };
}
function generateScript(state, template) {
  const cfg = buildConfig(state);
  const json = JSON.stringify(cfg, null, 1);
  if (!template.includes('CONFIG_JSON = r"""__CONFIG__"""')) throw new Error("script template is damaged");
  return template.replace('CONFIG_JSON = r"""__CONFIG__"""', () => 'CONFIG_JSON = r"""\n' + json + '\n"""');
}

const api = { SYMBOLS, Z, elementOf, zOf, colorOf, covOf, I3, mul, tr, mv, det, inv, add, sub, scale, norm, latticeMatrix,
  frac2cart, axisAngle, eulerMatrix, parseOp, closure, moleculeLocal, bondsOf, samePlacement, expandGroup, rng32,
  orientationTable, siteClasses, realize, parseAffine, freeParams, wyckoffOrbit, crystalSystem, fitCell, cellFits, planeGeometry, zonePlane, contactModel, PENALTY, VDW, diffusePlaneRows, validate, buildConfig, generateScript, isOrthogonal };
if (typeof module !== "undefined" && module.exports) module.exports = api; else root.DB = api;
})(typeof window !== "undefined" ? window : globalThis);
