# DISCUS Disorder Builder

A static web page (live at https://jmsweng.github.io/discus-disorder-builder/) for building disordered crystal models and exporting a Python script that runs them through
[discus-python](https://github.com/jmsweng/discus-python) and DISCUS_SUITE 6.23.01.

## What it does

- **Start from a paper** ("From a paper" in the header): the page gives you a prompt to paste, together with the
  paper's PDF (and SI/CIF), into Claude, ChatGPT or a similar assistant (or to download as
  `disorder_builder_prompt.md` and attach to the chat instead of pasting), with an optional box for your own notes
  (phase, table to use, what the disorder is …), which go into the prompt. The chatbot only transcribes what the paper
  reports, as a small JSON format in which every number can carry its source and a status (reported / derived /
  assumed / your note). You paste the answer back; the page expands the space-group symmetry, computes the
  orientation matrices from directions ("this bond along [111]", never Euler angles from the chatbot), checks the
  result and lists every value with its source, unreported ones first, before you load it. Problems can be copied
  back to the chat as a ready-made message. The paper, your notes, assumptions and what the model cannot represent
  are kept with the model (Cell step).
- **Cell and crystal**: lattice parameters (discus-python convention, a ∥ x, b in xy) and supercell size.
- **Molecule builder**: atoms in Cartesian Å, templates (H2O, CO2, NH4+, CH4, C6H6, SF6, NO3-, …), pasted XYZ, or
  click-to-draw in a rotatable 3D view; anchor at centroid, centre of mass or one atom.
- **Orientation library**: a group is a base orientation (ZYZ / ZXZ / XYZ Euler angles) plus symmetry operations
  (`C4 [0 0 1]`, `S4 [001]`, `m [1 -1 0]`, `-1`, `R 30 [1 1 1]`, Jones symbols `-y,x,z`, explicit matrices), with
  optional group closure. Placements that coincide because of the molecule's own symmetry are merged. Each
  orientation has a relative weight.
- **Space groups**: pick any of the 230 space groups (standard settings) and a Wyckoff position; the builder adds
  a site at every symmetry-equivalent position, with a new atom or the occupants copied from another site.
- **Atom types and isotopes** (Calculations): how DISCUS reads each atom name — elements, its ions (`Fe3+`, `O2-`)
  and deuterium `D`; any other name is read as the element it starts with (`Ni62` → Ni, `C1` → C). An isotope gets
  its own neutron scattering length, which the script passes to DISCUS with `scat NAME, 0,0,0,0,0,0,0,0, b`
  (in the fourier menu, also before the powder run). The name table `src/discus_names.js` is generated from
  discus-python (`discuspdf.atom_names`, itself generated from DISCUS 6.23.01 `lib_f90/element_data_mod.f90`) by
  `tools/gen_tables.py`.
- **Sites**: each site holds one occupant per cell (atom, molecule in one orientation of a group, or vacancy) with
  given probabilities, drawn independently or with exact composition.
- **Disorder**: correlated occupants (composition-conserving swap Monte Carlo with pair energies along neighbour
  vectors; works for atoms, vacancies and molecule orientations), rigid-body translation and libration of
  molecules, Gaussian atomic displacements, and a contact check.
- **DISCUS Monte Carlo** (atom-only models): neighbourhoods, occupational / displacement / spring / Lennard-Jones
  targets and moves, through `discuspdf.mc.MCConfig`.
- **Calculations**: 3D diffuse scattering with Bragg subtraction (`FourierConfig`, `set aver`, LOTS, X-ray or neutron,
  wavelength as a DISCUS symbol or Å), 3D-ΔPDF by the
  fractional FFT, optional total scattering and 3D-PDF (Patterson), and the 1D powder PDF of the supercell.
- **Preview**: a rotatable view of a random draw of the crystal (coloured by orientation, element or site) and an
  in-browser direct-sum diffuse plane (approximate: f = Z, no Debye–Waller, averaged over several random crystals).

## The generated script

The page is the user interface; the work is done by discus-python's `discuspdf.builder`. The exported script is
the model as JSON plus a call into that back end (re-import the `.py` or the exported `.json` into the page). The
script pins the discus-python version it was written for (`DISCUSPDF_REF` in `src/core.js`).

```
pip install "discuspdf-starter[data] @ git+https://github.com/jmsweng/discus-python@<ref>"
python model.py --dry-run          # build the crystal and stage every DISCUS run, no DISCUS needed
python model.py --numpy-preview    # also a numpy diffuse plane (real X-ray f0 with xraydb, or neutron b)
python model.py                    # full run; --launcher "…" to change how DISCUS is started
python -m discuspdf.builder run model.json   # the downloaded model JSON, without the script
```

Outputs: `supercell.stru`, `supercell.xyz`, `structure_summary.json`, one run folder per DISCUS job with its
macro, inputs and log, and the result formats chosen in the Script step: HDF5 volumes (`diffuse.h5`,
`delta_pdf.h5`, …), `pdf_1d.csv` and PNG plots by default; VTK (`.vts`), numpy `.npz` and `pdf_1d.txt` on request.
See discus-python's `docs/DISORDER_BUILDER.md`.

How the crystal reaches DISCUS: every unit cell lists the same number of atoms (DISCUS `ncell` layout). When a site's
occupants need different atom counts (molecules of different size, vacancies), the unused slots are filled with
DISCUS's non-scattering `VOID` atoms placed where the site's largest occupant would put its atoms.

## Files

- `index.html` – the whole app in one file, built by `build.py` (committed so it also opens straight from a checkout).
- `src/` – sources: `core.js` (maths, orientations, in-page realisation and preview, export), `viewer.js`, `app.js`,
  `examples.js`, `paper.js`, `style.css`, `shell.html`. The page keeps its own JavaScript copy of the realisation
  so that it can preview instantly without a server; the script always uses discus-python.
- `src/spacegroups.js` – symmetry operations and Wyckoff positions of the 230 space groups, generated with
  [PyXtal](https://github.com/MaterSim/PyXtal) 1.1.5 (MIT licence).
- `engine.py` – the template of the exported script (the model JSON and a call to `discuspdf.builder.main`).
- `tools/gen_tables.py` – regenerates `src/discus_names.js` from discus-python and checks the wavelength symbols
  (`--check` only compares).
- `tests/discuspdf_parity.py` – page ↔ discus-python checks: atom names, generated tables, and a dry run of every
  example's exported script (needs node and discus-python).
- `build.py` – inlines `src/` and `engine.py` into `index.html`. Run it after editing anything in `src/` or `engine.py`.
- `src/paper.js` – the "From a paper" prompt, the reader of the chatbot's JSON and its conversion into a model.
- `tests/paper_test.js` – checks of `paper.js` (run `node tests/paper_test.js`), with `tests/paper_ice_vii.json`, an
  extract of plastic ice VII (Rescigno et al., Nature 2025) in the format the prompt asks for.
- `tests/node_test.js` – Node checks of the core; writes the generated example scripts to `$OUT` (default: the temp
  folder), which you can then run with `--dry-run`.

## Hosting on GitHub Pages

`index.html` sits at the repository root, so Pages can serve the branch directly: Settings → Pages → Build and
deployment → Source: **Deploy from a branch**, branch `main`, folder `/ (root)`. The site is then at
`https://<owner>.github.io/<repo>/`. `.nojekyll` stops GitHub from running Jekyll over the files. After editing
anything in `src/` or `engine.py`, run `python build.py` and commit the new `index.html`.

## Verification against DISCUS

The structure building, staged macros and file formats are tested with dry runs. `VOID` padding atoms, own
scattering lengths (`scat`) and the 1D PDF from `read stru` are covered by a pre-registered DISCUS probe in
discus-python (`benchmarks/discus_6_23_01/e_builder_backend`). The Windows → WSL launcher has not been run.
