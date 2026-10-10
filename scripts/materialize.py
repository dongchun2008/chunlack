#!/usr/bin/env python3
"""Generate embedded runtime files without running the legacy installer."""
import argparse
import ast
import json
import shutil
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


def check_target(root, target):
    """Refuse linked runtime paths rather than following them outside output."""
    relative = target.relative_to(root)
    current = root
    for part in (None, *relative.parts):
        if part is not None:
            current = current / part
        if current.is_symlink() or (hasattr(current, "is_junction") and current.is_junction()):
            raise ValueError("Linked runtime output is not permitted")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--config", type=Path)
    args = parser.parse_args()
    args.output = args.output.absolute()
    sources = embedded_sources()
    files = {"server.js": "SERVER_JS", "public/index.html": "INDEX_HTML", "bin/lack.js": "BIN_LACK_JS"}
    repository = Path(__file__).resolve().parents[1]
    runtime_files = []
    excluded = {"fixtures", "tests", "node_modules", "__pycache__", ".git", "db", "data", "state", "credentials"}
    for directory in ("gateway", "sdk", "identity", "collaboration", "integrations/mcp"):
        origin = repository / directory
        for source in sorted(origin.rglob("*")):
            relative = source.relative_to(origin)
            if source.suffix not in {".cjs", ".js", ".html"} or any(part in excluded for part in relative.parts[:-1]):
                continue
            if source.is_symlink() or not source.resolve().is_relative_to(origin.resolve()):
                raise ValueError("Linked runtime source is not permitted")
            if source.is_file():
                runtime_files.append((source, args.output / directory / relative))
    runtime_files.append((repository / "scripts/accounts.cjs", args.output / "scripts/accounts.cjs"))
    for name in ("package.json", "package-lock.json"):
        runtime_files.append((repository / name, args.output / name))
    config_path = args.output / "config/lack.config.json"
    # Check the complete output plan before the first write. Configuration and
    # databases already present in output are not overwritten or copied from source.
    for target in [*(args.output / relative for relative in files), *(target for _, target in runtime_files), config_path]:
        check_target(args.output, target)
    config = None
    if not config_path.exists():
        config = json.loads(args.config.read_text(encoding="utf-8-sig") if args.config else sources["CONFIG_JSON"])
    for relative, key in files.items():
        target = args.output / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(sources[key], encoding="utf-8", newline="\n")
    for source, target in runtime_files:
        if source.resolve() != target.resolve():
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
    if config is not None:
        config_path.parent.mkdir(parents=True, exist_ok=True)
        config_path.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
    print(f"Runtime generated in {args.output}; existing configuration preserved.")


if __name__ == "__main__":
    main()
