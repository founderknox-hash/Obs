# Official Luau frontend

- Upstream version: Luau 0.741
- Upstream commit: `421cc81`
- Parser: official `Luau::Parser`
- AST serialization: official `Luau::AstJsonEncoder`
- VM backend: project-native; Luau bytecode is not executed as the protected output

## Render deployment

Render uses `Dockerfile`. The Docker build compiles the supplied official Luau source before the Next.js build, so the AST executable is linked against the same Linux userspace used for deployment.

The runtime image contains only the compiled AST frontend and the application; the full Luau source and C++ build tree remain in the build stage.
