"""Local control-flow fault injection, never a VPS or systemd operation."""
import ast
import contextlib
import io
import json
import pathlib
import sys
import types

controller_path = pathlib.Path(sys.argv[1])
controller_source = controller_path.read_text(encoding="utf-8")
ast.parse(controller_source)
tail = controller_source[controller_source.index("started=time.monotonic();result=None"):]
FIXTURE_COMMIT = "fixture-source-commit"


class FakePath:
    def __init__(self, name, case):
        self.name = name
        self.case = case

    def __truediv__(self, name):
        return FakePath(name, self.case)

    def resolve(self):
        return self

    def stat(self):
        return types.SimpleNamespace(st_uid=0, st_mode=0o700)

    def read_text(self):
        if self.name == "trial-owner.json":
            return json.dumps({
                "kind": "fixture",
                "nonce": "wrong" if self.case == "owner_changed" else "fixture",
                "commit": FIXTURE_COMMIT,
            })
        if self.name == "trial-report-r1.json":
            return "{" if self.case == "malformed_report" else json.dumps({"status": "verified"})
        raise FileNotFoundError(self.name)

    def __str__(self):
        return self.name


def scenario(case):
    state = {"loaded": False, "stopped": False, "poll": 0, "written": None, "actions": []}
    root = FakePath("ROOT", case)
    # The previously failed fixture omitted commit. Both fake owner sources now
    # carry it; ownership mismatch remains a nonce mismatch, not a schema error.
    owner = {"kind": "fixture", "nonce": "fixture", "commit": FIXTURE_COMMIT}
    unit = "owned-fixture.service"
    description = "owned fixture"

    def props(name):
        assert name == unit, "unowned unit queried"
        if not state["loaded"]:
            return {"LoadState": "not-found"}
        state["poll"] += 1
        if case == "poll_exception" and state["poll"] == 1:
            raise OSError("synthetic poll failure")
        running = not state["stopped"] and case in ("launch_exception", "poll_exception")
        return {
            "LoadState": "loaded",
            "MainPID": "123" if running else "0",
            "ExecMainExitTimestampMonotonic": "1",
            "ExecMainStatus": "0",
            "FragmentPath": "/run/systemd/transient/" + unit,
            "Description": description,
            "ActiveState": "inactive" if state["stopped"] else "active",
            "MemoryPeak": "1",
            "MemorySwapPeak": "0",
        }

    def run(args):
        if args[0] == "systemd-run":
            state["loaded"] = True
            if case == "launch_exception":
                raise RuntimeError("synthetic launch observation failure")
        elif args == ["systemctl", "stop", unit]:
            state["stopped"] = True
            state["actions"].append("stop_owned")
        else:
            raise AssertionError("unowned action")

    class Capture(io.StringIO):
        def close(self):
            state["written"] = json.loads(self.getvalue())
            super().close()

    def opened(file, mode):
        assert str(file) == "host-result-r1.json" and mode == "x"
        assert state["stopped"], "host report write precedes owned-unit cleanup"
        state["actions"].append("write_host_report")
        if case == "report_write_exception":
            raise OSError("synthetic write failure")
        return Capture()

    before = {
        "services": {"original.service": {
            "MainPID": "9", "NRestarts": "0", "ActiveState": "active", "SubState": "running",
        }},
        "unitFileSha256": {"original.service": "fixture"},
        "public443Listening": False,
    }
    context = {
        "ROOT": root, "UNIT": unit, "description": description, "owner": owner,
        "props": props, "run": run, "before": before, "baseline": lambda: before,
        "cmd": ["systemd-run"],
        "time": types.SimpleNamespace(monotonic=lambda: 0, sleep=lambda seconds: None),
        "json": json, "open": opened,
    }
    output = io.StringIO()
    status = None
    try:
        with contextlib.redirect_stdout(output):
            exec(compile(tail, "actual-controller-tail", "exec"), context)
    except SystemExit as error:
        status = error.code
    except AssertionError:
        assert case == "owner_changed" and not state["stopped"]
        assert state["written"] is None and state["actions"] == []
        return {"case": case, "passed": True, "changedOwnerFailClosed": True}

    assert state["stopped"] and context["owned_stopped"]
    assert state["actions"] == ["stop_owned", "write_host_report"]
    emitted = json.loads(output.getvalue())
    assert emitted["ownedUnitStopped"] is True
    if case == "success":
        assert status == 0 and state["written"]["errors"] == [] and emitted["errors"] == []
    else:
        assert status == 1 and emitted["errors"]
        if case != "report_write_exception":
            assert state["written"]["errors"]
        else:
            assert state["written"] is None
            assert "host_report_write_failed_OSError" in emitted["errors"]
    return {"case": case, "passed": True, "ownedUnitStoppedBeforeReportWrite": True}


cases = [
    "success", "launch_exception", "poll_exception", "malformed_report",
    "report_write_exception", "owner_changed",
]
results = [scenario(case) for case in cases]
print(json.dumps({
    "kind": "LOCAL_CONTROLLER_CONTROL_FLOW_INJECTION",
    "cases": results,
    "passed": len(results),
    "failed": 0,
    "vpsAccess": False,
    "realSystemdOperations": 0,
    "productionCutover": False,
}, indent=2))
