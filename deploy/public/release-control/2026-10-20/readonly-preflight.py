"""Read-only release readiness check. Never starts the transaction."""
import copy, hashlib, importlib.util, json, os, re, shutil, stat, subprocess, sys, time
from pathlib import Path, PurePosixPath

def manifest_sections(value):
    if type(value) is not dict or not {"candidate", "previous"} <= value.keys():
        raise ValueError("manifest_sections_required")
    result = {}
    for section in ("candidate", "previous"):
        table = value[section]
        if type(table) is not dict or not 1 <= len(table) <= 1000:
            raise ValueError("manifest_section_invalid")
        for name, digest in table.items():
            if (type(name) is not str or not name or "\\" in name or
                    PurePosixPath(name).is_absolute() or
                    any(part in ("", ".", "..") for part in name.split("/")) or
                    ":" in name or "\x00" in name):
                raise ValueError("manifest_path_invalid")
            if type(digest) is not str or re.fullmatch("[0-9a-f]{64}", digest) is None:
                raise ValueError("manifest_digest_invalid")
        result[section] = dict(table)
    return result

def command(args, timeout=3):
    result = subprocess.run(args, capture_output=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError("readonly_command_failed")
    return result.stdout.decode()

def snapshot():
    return {name: dict(line.split("=", 1) for line in command(
        ["systemctl", "show", name, "-p", "MainPID", "-p", "ActiveState", "-p", "NRestarts"]
    ).splitlines() if "=" in line) for name in
        ("chunlack.service", "tailscaled.service", "chunlack-public.service", "chunlack-https.service")}

def run(root_string, trusted):
    root = Path(root_string)
    tag = root.name.removeprefix("chunlack-release-")
    if not re.fullmatch("[0-9a-f]{12}", tag) or root != Path("/var/lib/chunlack-release-" + tag):
        raise ValueError("release_root_invalid")
    if root.is_symlink() or root.resolve(strict=True) != root:
        raise ValueError("linked_release_root")
    if (root.stat().st_uid, stat.S_IMODE(root.stat().st_mode)) != (0, 0o700):
        raise ValueError("release_root_not_private")
    before = snapshot()
    for name, expected in trusted.items():
        if hashlib.sha256((root / name).read_bytes()).hexdigest() != expected:
            raise RuntimeError("trusted_operation_source_changed")
    settings = json.loads((root / "settings.json").read_text())
    if (settings.get("tag") != tag or settings.get("serviceAccountHandoff") != "systemd-v1"
            or settings.get("releaseProfile") != "mcp-only" or settings.get("migrationContract") is not None):
        raise RuntimeError("release_scope_changed")
    spec = importlib.util.spec_from_file_location("readonly_release_gate", root / "release.py")
    gate = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(gate)
    prepared_checks = {name: gate.digest(root / name) == digest
                       for name, digest in settings["preparedHashes"].items()}
    if not all(prepared_checks.values()):
        raise RuntimeError("prepared_artifact_changed")
    expected = manifest_sections(json.loads((root / "expected-code.json").read_text()))
    staged = Path("/opt/chunlack-public/staged-" + tag + "/current")
    current = Path("/opt/chunlack-public/current")
    if gate.code_inventory(staged) != expected["candidate"]:
        raise RuntimeError("candidate_manifest_mismatch")
    if gate.code_inventory(current) != expected["previous"]:
        raise RuntimeError("previous_manifest_mismatch")
    if settings["stageHashes"] != expected["candidate"]:
        raise RuntimeError("candidate_settings_manifest_mismatch")
    candidate = json.loads((root / "candidate-config.json").read_text())
    live = json.loads(Path("/var/lib/chunlack-public/config/lack.config.json").read_text())
    approval = json.loads((root / "approved-client.json").read_text())
    if type(approval) is not list or len(approval) != 1 or approval != settings["approvedAgentClientIds"]:
        raise RuntimeError("explicit_client_approval_mismatch")
    gate.validate_release_config(candidate, "mcp-only", approval)
    live_public = live["publicRuntime"]
    if live_public["agentOAuth"]["clientIds"] != [] or live_public.get("nodeRestPublic") is not False:
        raise RuntimeError("original_access_boundary_changed")
    if live_public.get("events", {}).get("enabled") is True:
        raise RuntimeError("events_unexpectedly_enabled")
    normalized = copy.deepcopy(candidate)
    normalized["publicRuntime"]["agentOAuth"]["clientIds"] = []
    if normalized != live:
        raise RuntimeError("candidate_changes_outside_approved_allowlist")
    paths = {"configHash": "/var/lib/chunlack-public/config/lack.config.json",
             "envHash": "/etc/chunlack-public/runtime.env",
             "caddyHash": "/etc/chunlack-public/Caddyfile"}
    input_checks = {key: gate.digest(Path(value)) == settings[key] for key, value in paths.items()}
    if not all(input_checks.values()):
        raise RuntimeError("live_input_drift")
    proof = json.loads((root / "schema-compatibility-report.json").read_text())
    if proof.get("status") != "passed" or proof.get("schemaPreserved") is not True:
        raise RuntimeError("copy_compatibility_not_passed")
    destinations = {name: not value.exists() for name, value in {
        "backup": Path("/var/backups/chunlack-release-" + tag),
        "previous": Path("/opt/chunlack-public/previous-" + tag),
        "failed": Path("/opt/chunlack-public/failed-" + tag)}.items()}
    if not all(destinations.values()):
        raise RuntimeError("release_destination_occupied")
    if any(row["ActiveState"] != "active" or int(row["MainPID"]) <= 0 for row in before.values()):
        raise RuntimeError("production_service_not_active")
    available = int(next(line.split()[1] for line in Path("/proc/meminfo").read_text().splitlines()
                         if line.startswith("MemAvailable:")))
    if available < 384 * 1024 or shutil.disk_usage("/var/lib").free < 1024 ** 3:
        raise RuntimeError("resource_headroom_insufficient")
    after = snapshot()
    if after != before:
        raise RuntimeError("service_baseline_changed")
    return {"status": "passed", "candidateFiles": len(expected["candidate"]),
            "previousFiles": len(expected["previous"]), "preparedChecks": prepared_checks,
            "liveInputChecks": input_checks, "approvedClientCount": len(approval),
            "changesOnlyApprovedAllowlist": True, "migrationRepeated": False,
            "destinationsFree": destinations, "servicesBefore": before, "servicesAfter": after,
            "resourceHeadroomPassed": True, "productionMutated": False,
            "credentialsChanged": False, "relayChanged": False, "modelCalls": 0}

if __name__ == "__main__":
    started = time.monotonic()
    try:
        result = run(sys.argv[1], json.loads(sys.argv[2]))
    except Exception as error:
        result = {"status": "failed", "error": str(error) if isinstance(error, (RuntimeError, ValueError))
                  else type(error).__name__, "productionMutated": False}
    result["elapsedSeconds"] = time.monotonic() - started
    print(json.dumps(result), flush=True)
    sys.exit(0 if result["status"] == "passed" else 1)
