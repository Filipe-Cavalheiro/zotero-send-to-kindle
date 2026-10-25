#!/usr/bin/env bash
# Package the plugin as build/send-to-kindle-<version>.xpi
set -euo pipefail
cd "$(dirname "$0")"
version=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' manifest.json | head -1)
mkdir -p build
out="build/send-to-kindle-${version}.xpi"
rm -f "$out"
zip -qr "$out" manifest.json bootstrap.js prefs.js src content locale
echo "$out"
