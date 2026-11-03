#!/usr/bin/env python3
"""Disordered-structure model from the DISCUS Disorder Builder (https://jmsweng.github.io/discus-disorder-builder/).

The model is the JSON block CONFIG_JSON below; edit it or re-import this file into the web page. Everything
else (building the supercell, Monte Carlo, DISCUS runs, result files) is done by discus-python's
discuspdf.builder, so this script stays short and gets every fix of the package.

Requirements: Python >= 3.10, DISCUS_SUITE 6.23.01 for the calculations, and discus-python:
  pip install "discuspdf-starter[data] @ git+https://github.com/jmsweng/discus-python@__DISCUSPDF_REF__"

Usage
  python model.py                     # build the structure and run every enabled calculation
  python model.py --dry-run           # build and stage all DISCUS inputs, do not start DISCUS
  python model.py --numpy-preview     # also compute a quick diffuse plane with numpy (no DISCUS)
  python model.py --launcher "wsl.exe -d Ubuntu-22.04 -- discus_suite -noautorun -macro"
  python model.py --out results_dir --seed 7 --overwrite
The same model also runs without this file:  python -m discuspdf.builder run model.json
"""
import json
import sys

CONFIG_JSON = r"""__CONFIG__"""

INSTALL = 'pip install "discuspdf-starter[data] @ git+https://github.com/jmsweng/discus-python@__DISCUSPDF_REF__"'


def main(argv=None) -> int:
    if CONFIG_JSON.strip() == "__CONFIG__":
        sys.exit("No model: this is the template. Run the script the web page exports.")
    try:
        from discuspdf.builder import main as builder_main
    except ImportError:
        sys.exit("This script needs discus-python with discuspdf.builder. Install it with\n  " + INSTALL)
    return builder_main(argv, model=json.loads(CONFIG_JSON), description=__doc__)


if __name__ == "__main__":
    sys.exit(main())
