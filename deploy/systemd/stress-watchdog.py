#!/usr/bin/env python3
"""Root supervisor for named disposable services only; never restarts production."""
import json, os, pathlib, subprocess, time, urllib.request

ROOT = pathlib.Path(os.environ['STRESS_RESULTS'])
CG = pathlib.Path('/sys/fs/cgroup/system.slice')
HTTP = urllib.request.build_opener(urllib.request.ProxyHandler({}))

def value(unit, key):
    return subprocess.check_output(['systemctl', 'show', unit, '-p', key, '--value'], text=True, timeout=3).strip()

def cg(unit, name):
    p = CG / (unit + '.service') / name
    return p.read_text().strip() if p.exists() else ''

def health(port):
    start = time.monotonic()
    try:
        with HTTP.open(f'http://127.0.0.1:{port}/health', timeout=2) as r:
            ok = r.status == 200
        return ok, round((time.monotonic() - start) * 1000, 2)
    except Exception:
        return False, 2000

def cpu():
    fields = [int(x) for x in pathlib.Path('/proc/stat').read_text().splitlines()[0].split()[1:9]]
    return sum(fields), fields[3] + fields[4]

def emit(data):
    with (ROOT / 'guard.jsonl').open('a') as f:
        f.write(json.dumps(dict(time=time.time(), **data)) + '\n')

baseline = {u: value(u, 'MainPID') for u in ['chunlack', 'tailscaled']}
initial_cpu = cpu()
time.sleep(5)  # Use a meaningful interval for the first CPU delta.
consecutive = 0
start = time.monotonic()
aborted = False
try:
    while time.monotonic() - start < 1800:
        before = time.monotonic()
        mem = {line.split(':')[0]: int(line.split()[1]) for line in pathlib.Path('/proc/meminfo').read_text().splitlines()}
        now_cpu = cpu()
        busy = 100 * (1 - (now_cpu[1] - initial_cpu[1]) / max(1, now_cpu[0] - initial_cpu[0]))
        initial_cpu = now_cpu
        prod_ok, prod_ms = health(3721)
        test_ok, test_ms = health(3723)
        pids = {u: value(u, 'MainPID') for u in baseline}
        pressure = pathlib.Path('/proc/pressure/memory').read_text().splitlines()[1]
        full10 = float(pressure.split('avg10=')[1].split()[0])
        events = dict(line.split() for line in cg('chunlack-stress', 'memory.events').splitlines())
        test_mem = int(cg('chunlack-stress', 'memory.current') or 0)
        state = value('chunlack-stress-driver', 'ActiveState')
        relay = json.loads(subprocess.check_output(['tailscale', 'status', '--json'], text=True, timeout=4))
        relay_ok = relay.get('BackendState') == 'Running' and relay.get('Self', {}).get('Online') is True and not relay.get('Health')
        sample = dict(event='sample',availableMiB=mem['MemAvailable']/1024,swapUsedMiB=(mem['SwapTotal']-mem['SwapFree'])/1024,hostCpuBusy=round(busy,2),stressMiB=test_mem/1048576,productionHealthMs=prod_ms,stressHealthMs=test_ms,productionOk=prod_ok,stressOk=test_ok,relayOk=relay_ok,pids=pids,memoryFullAvg10=full10,memoryEvents=events,stressCpu=cg('chunlack-stress','cpu.stat'),driverState=state)
        emit(sample)
        immediate = pids != baseline or not relay_ok or int(events.get('oom_kill',0)) > 0 or not test_ok
        strained = mem['MemAvailable'] < 384*1024 or busy > 85 or not prod_ok or prod_ms > 1000 or test_mem > 380*1048576 or full10 > 1
        consecutive = consecutive + 1 if strained else 0
        if immediate or consecutive >= 3:
            aborted=True
            (ROOT/'abort').write_text(json.dumps(sample))
            emit(dict(event='safety_abort',immediate=immediate,consecutive=consecutive))
            break
        if state not in ['active','activating'] and time.monotonic()-start > 10:
            emit(dict(event='driver_finished',state=state))
            break
        time.sleep(max(0,5-(time.monotonic()-before)))
    else:
        aborted=True
        (ROOT/'abort').write_text('Maximum test duration reached')
        emit(dict(event='safety_abort',reason='maximum duration'))
finally:
    subprocess.run(['systemctl','stop','chunlack-stress-driver','chunlack-stress'],timeout=30,check=False)
    emit(dict(event='cleanup',aborted=aborted,productionState=value('chunlack','ActiveState'),relayState=value('tailscaled','ActiveState')))
