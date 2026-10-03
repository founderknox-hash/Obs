# Official Luau AST frontend

This frontend is built from the official Luau 0.741 source supplied with this project (commit `421cc81`). It uses `Luau::Parser` and `Luau::AstJsonEncoder`; it is not a Lua 5.1 parser or a syntax-rewrite shim.

For Render deployment, the official Luau source is compiled **inside the Docker build image**. The generated `bin/luau-ast` therefore links against the deployment image's libc instead of a developer machine's libc.

`LUAU_AST_BIN` can override the binary path. Locally, `tools/luau-ast/build.sh` automatically uses `tools/luau-source` when `LUAU_SOURCE_DIR` is not set.
