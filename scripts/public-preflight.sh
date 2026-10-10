#!/bin/sh
# Read-only deployment baseline. This script never installs, starts, stops or
# reconfigures services and deliberately does not collect environment/secrets.
set -eu
export LC_ALL=C

if [ "$(uname -s)" != Linux ]; then
  printf 'PREFLIGHT=UNSUPPORTED_SYSTEM\n'
  exit 2
fi
for command in awk getconf df ss; do
  if ! command -v "$command" >/dev/null 2>&1; then
    printf 'PREFLIGHT=MISSING_TOOL:%s\n' "$command"
    exit 2
  fi
done

printf '=== READ_ONLY_BASELINE ===\n'
printf 'CPU_COUNT=%s\n' "$(getconf _NPROCESSORS_ONLN)"
memory=$(awk '/^MemTotal:/ {total=$2} /^MemAvailable:/ {available=$2} /^SwapTotal:/ {swap=$2} /^SwapFree:/ {free=$2} END {printf "%d %d %d %d",total,available,swap,free}' /proc/meminfo)
set -- $memory
printf 'MEM_TOTAL_KIB=%s\nMEM_AVAILABLE_KIB=%s\nSWAP_TOTAL_KIB=%s\nSWAP_FREE_KIB=%s\n' "$1" "$2" "$3" "$4"
available=$2
printf '=== DISK_KIB ===\n'
df -Pk / /var/lib /opt

printf '=== TCP_LISTENERS ===\n'
ss -H -ltn
printf '=== UDP_LISTENERS_BASELINE ===\n'
ss -H -lun

printf '=== EXISTING_SERVICES ===\n'
if command -v systemctl >/dev/null 2>&1; then
  for unit in chunlack.service chunlack-public.service chunlack-ingress.service tailscaled.service caddy.service nginx.service; do
    printf 'UNIT=%s\n' "$unit"
    systemctl show "$unit" --no-pager --property=LoadState,ActiveState,SubState,MemoryCurrent,CPUUsageNSec 2>/dev/null || printf 'UNIT_STATUS=UNKNOWN\n'
  done
else
  printf 'SERVICE_MANAGER=UNKNOWN\n'
fi

blocked=0
if [ "$available" -lt 409600 ]; then
  printf 'RESOURCE_GATE=REQUIRES_REVIEW_LOW_AVAILABLE_MEMORY\n'
  blocked=1
else
  printf 'RESOURCE_GATE=BASELINE_ONLY_NOT_LOAD_ACCEPTANCE\n'
fi
https=$(ss -H -ltn '( sport = :443 )')
if [ -n "$https" ]; then
  printf 'PUBLIC_443_GATE=OCCUPIED_DO_NOT_REPLACE\n'
  blocked=1
else
  printf 'PUBLIC_443_GATE=FREE_AT_CHECK_TIME\n'
fi
printf 'NETWORK_GATE=DNS_CERTIFICATE_FIREWALL_AND_RELAY_FUNCTION_NOT_VERIFIED\n'
if [ "$blocked" -ne 0 ]; then
  printf 'PREFLIGHT=REVIEW_REQUIRED_NO_CHANGES_MADE\n'
  exit 2
fi
printf 'PREFLIGHT=BASELINE_COLLECTED_NOT_DEPLOYMENT_AUTHORIZATION\n'
