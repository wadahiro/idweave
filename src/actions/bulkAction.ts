/**
 * actions: run a midPoint bulk-action (a `<executeScript>` scripting object) via the
 * RPC endpoint — the entry point an operator uses for one-off bulk work
 * (一括 manager 変更 / 棚卸し出力 / 組織ツリー出力 など). The script is the REAL
 * deployed artifact (or an ad-hoc one); idweave only DRIVES it and lets the
 * existing oracles (expect / expect-file / expect-mail) assert its effect.
 *
 * A 200 with a `fatal_error` operation result still means failure — clients
 * `executeScriptXml` already detects that and throws, so callers just await.
 */
import type { MidpointRest } from "../clients/midpointRest.ts";

export async function runBulkAction(rest: MidpointRest, xml: string): Promise<void> {
  await rest.executeScriptXml(xml);
}
