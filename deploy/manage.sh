#!/bin/sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
compose() { docker compose --env-file .env -f compose.yaml "$@"; }
case "${1:-}" in
  preflight)
    uname -sr
    id
    df -h .
    free -m
    docker version --format '{{.Server.Version}}'
    docker compose version
    test -f .env && test -f lack.config.json
    compose config --quiet
    ;;
  up)
    test -f .env && test -f lack.config.json
    compose config --quiet
    compose build --pull
    compose up -d --wait --wait-timeout 120
    compose ps
    ;;
  status) compose ps ;;
  logs) compose logs --tail 100 lack ;;
  backup)
    umask 077
    mkdir -p backups
    backup_dir="backups/$(date -u +%Y%m%dT%H%M%SZ)"
    mkdir "$backup_dir"
    compose ps -q lack > "$backup_dir/container-id"
    test -s "$backup_dir/container-id"
    docker inspect --format '{{.Image}}' "$(cat "$backup_dir/container-id")" > "$backup_dir/image-id"
    cp .env "$backup_dir/deploy.env"
    cp lack.config.json "$backup_dir/seed-config.json"
    compose stop lack
    trap 'compose start lack' EXIT HUP INT TERM
    compose run --rm --no-deps --entrypoint tar -T lack -C /data -czf - . > "$backup_dir/data.tar.gz"
    tar -tzf "$backup_dir/data.tar.gz" >/dev/null
    printf 'Backup created: %s\n' "$backup_dir"
    ;;
  *) printf 'Usage: sh deploy/manage.sh {preflight|up|status|logs|backup}\n'; exit 2 ;;
esac
