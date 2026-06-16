#!/usr/bin/env node
/**
 * Bin launcher for the `idw` CLI.
 *
 * Runs the TypeScript entry (src/cli.ts) WITHOUT requiring `tsx` on the
 * consumer's PATH or in their cwd. We register tsx's ESM loader — resolved from
 * idweave's OWN dependencies, since this file ships inside the installed package
 * — then import the entry. This is what makes `npm i idweave` + `npx idw` work
 * from any project, including a `file:` install whose deps aren't hoisted.
 *
 * (idweave's own dev scripts still run `tsx src/cli.ts` directly; that path is
 * unchanged. This launcher only governs the installed `bin`.)
 */
import { register } from "tsx/esm/api";

register();
await import("../src/cli.ts");
