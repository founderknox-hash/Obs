#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SOURCE="${LUAU_SOURCE_DIR:-$ROOT/tools/luau-source}"
BUILD="${ROOT}/.luau-build"
BIN="${ROOT}/tools/luau-ast/bin/luau-ast"

if [[ ! -f "$SOURCE/CMakeLists.txt" ]]; then
  echo "Official Luau source not found at: $SOURCE" >&2
  exit 1
fi

mkdir -p "$(dirname "$BIN")"

cmake -S "$SOURCE" -B "$BUILD" \
  -DLUAU_BUILD_TESTS=OFF \
  -DLUAU_BUILD_CLI=OFF \
  -DCMAKE_BUILD_TYPE=Release

cmake --build "$BUILD" --target Luau.Ast -j"${CMAKE_BUILD_PARALLEL_LEVEL:-2}"

c++ -O2 -DNDEBUG -std=c++17 \
  -I"$SOURCE/Ast/include" \
  -I"$SOURCE/Common/include" \
  -I"$SOURCE/Analysis/include" \
  "$ROOT/tools/luau-ast/bridge.cpp" \
  "$SOURCE/Analysis/src/AstJsonEncoder.cpp" \
  "$BUILD/libLuau.Ast.a" \
  "$BUILD/libLuau.Common.a" \
  -o "$BIN"

chmod 755 "$BIN"
file "$BIN"
