"""Page ↔ discus-python checks (needs node and discuspdf with discuspdf.builder importable).

    python tests/discuspdf_parity.py

1. The page's atom-name functions (core.js discusInfo / elementOf / massNumber) agree with discuspdf.atom_names
   for every DISCUS name and a set of labels.
2. src/discus_names.js and the wavelength symbols are the generated tables (tools/gen_tables.py --check).
3. Every example's exported script runs (--dry-run: builds the crystal, stages every DISCUS input) through
   discuspdf.builder, and `python -m discuspdf.builder run` on the same model JSON writes the same supercell.
"""
from __future__ import annotations

import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

LABELS = ["Ni62", "ni62", "C1", "Fe2", "FE3+", "Fe3+", "O2-", "OH", "D", "d", "D1-", "H2", "Li7", "U238", "B11",
          "XX", "X1", "Q", "VOID", "Void", "E1-", "CENT", "CF", "ES", "FM", "Na+", "NA3+", "CU63", "O18", "HO",
          "W", "SI.", "C.", "Au197", "Ni-", "MN4+", " ni ", "Zn64", "Al3+"]

JS = r"""
const DB = require(process.argv[1] + "/src/core.js"), EX = require(process.argv[1] + "/src/examples.js");
const fs = require("fs");
const names = JSON.parse(fs.readFileSync(0, "utf8"));
const info = names.map(n => { const i = DB.discusInfo(n); return [n, i ? [i.name, i.known, i.as, i.el, i.b] : null, DB.elementOf(n), DB.massNumber(n)]; });
const merge = (d, x) => { if (x == null) return d; if (typeof d !== "object" || Array.isArray(d)) return x; const o = { ...d }; for (const k in x) o[k] = merge(d[k], x[k]); return o; };
const tpl = fs.readFileSync(process.argv[1] + "/engine.py", "utf8");
const scripts = {};
for (const [k, e] of Object.entries(EX)) if (k !== "blank") {
  const s = merge(EX.blank.make(), e.make());
  s.calc.fourier.enabled = true; s.calc.fourier.total = true; s.calc.pdf.enabled = true; s.calc.pdf.qmax = 7;
  if (s.mmc) s.mmc.enabled = false;
  scripts[k] = { py: DB.generateScript(s, tpl), json: DB.buildConfig(s) };
}
console.log(JSON.stringify({ info, scripts }));
"""


def main() -> int:
    from discuspdf.atom_names import discus_atom_name, discus_name_rows, element_of, mass_number
    import gen_tables
    failures = []
    names = [r[0] for r in discus_name_rows(scattering_only=False)] + LABELS
    out = subprocess.run(["node", "-e", JS, str(ROOT)], input=json.dumps(names), capture_output=True, text=True,
                         check=True)
    data = json.loads(out.stdout)
    for n, js_info, js_el, js_mass in data["info"]:
        i = discus_atom_name(n)
        py = [[i.name, i.known, i.read_as, i.element, i.b] if i else None, element_of(n), mass_number(n)]
        if py != [js_info, js_el, js_mass]:
            failures.append(f"atom name {n!r}: page {[js_info, js_el, js_mass]} vs discuspdf {py}")
    print(f"atom names: {len(data['info'])} compared")
    if gen_tables.main(["--check"]):
        failures.append("generated tables are out of date")
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        for k, s in data["scripts"].items():
            (tmp / f"{k}.py").write_text(s["py"], encoding="utf-8")
            (tmp / f"{k}.json").write_text(json.dumps(s["json"]), encoding="utf-8")
            r1 = subprocess.run([sys.executable, str(tmp / f"{k}.py"), "--dry-run", "--out", str(tmp / f"{k}_py")],
                                capture_output=True, text=True)
            r2 = subprocess.run([sys.executable, "-m", "discuspdf.builder", "run", str(tmp / f"{k}.json"),
                                 "--dry-run", "--out", str(tmp / f"{k}_cli")], capture_output=True, text=True)
            if r1.returncode or r2.returncode:
                failures.append(f"example {k}: script exit {r1.returncode}, cli exit {r2.returncode}: "
                                f"{(r1.stderr or r2.stderr)[-400:]}")
                continue
            h = [hashlib.sha256((tmp / f"{k}_{w}" / "supercell.stru").read_bytes()).hexdigest() for w in ("py", "cli")]
            n3d = len(list((tmp / f"{k}_py" / "runs_3d").glob("*/run.mac")))
            npdf = len(list((tmp / f"{k}_py" / "runs_pdf").glob("*/run.mac")))
            if h[0] != h[1] or n3d != 2 or npdf != 1:
                failures.append(f"example {k}: supercell differs or runs missing (3D {n3d}, PDF {npdf})")
            print(f"example {k}: script and CLI dry runs agree, 3D runs {n3d}, PDF runs {npdf}")
    for f in failures:
        print("FAIL:", f)
    print("PASS" if not failures else f"{len(failures)} failure(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
