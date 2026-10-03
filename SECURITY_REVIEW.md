# Independent VM security review

This repository now emits randomized opcode IDs, operand orders, dispatch layouts, fused instructions, lazy chunk decoding, constant-layout variants, and runtime integrity checks. These are obfuscation mechanisms, not cryptographic protection.

An independent reverse-engineering review is still an external acceptance criterion. Reviewers should receive representative protected Roblox builds and measure:

- time-to-first-recovered handler and time-to-recovered IR;
- percentage of handlers/constants/control flow reconstructed;
- dynamic tracing effort and information exposed by instrumentation;
- differences across independently generated builds;
- overhead from lazy decoding, integrity checks, and fused instructions.

Do not treat this document as evidence that an independent review has occurred. No third-party review is bundled with the source tree.
