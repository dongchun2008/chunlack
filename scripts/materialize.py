#!/usr/bin/env python3
"""Generate embedded runtime files without running the legacy installer."""
import argparse
import ast
import json
from pathlib import Path


def embedded_sources():
    source = Path(__file__).resolve().parents[1] / "lack.py"
    tree = ast.parse(source.read_text(encoding="utf-8"))
    return {
        node.targets[0].id: ast.literal_eval(node.value)
        for node in tree.body
        if isinstance(node, ast.Assign)
        and isinstance(node.targets[0], ast.Name)
        and node.targets[0].id in {"SERVER_JS", "INDEX_HTML", "CONFIG_JSON", "BIN_LACK_JS"}
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--config", type=Path)
    args = parser.parse_args()
    sources = embedded_sources()
    files = {"server.js": "SERVER_JS", "public/index.html": "INDEX_HTML", "bin/lack.js": "BIN_LACK_JS"}
    for relative, key in files.items():
        target = args.output / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(sources[key], encoding="utf-8", newline="\n")
    config_path = args.output / "config/lack.config.json"
    if not config_path.exists():
        config = json.loads(args.config.read_text(encoding="utf-8-sig") if args.config else sources["CONFIG_JSON"])
        config_path.parent.mkdir(parents=True, exist_ok=True)
        config_path.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
    print(f"Runtime generated in {args.output}; existing configuration preserved.")


if __name__ == "__main__":
    main()
