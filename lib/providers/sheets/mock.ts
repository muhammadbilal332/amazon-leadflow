import type { ProviderResult, SheetsExportRow, SheetsProvider } from "@/lib/providers/types";

export class MockSheetsProvider implements SheetsProvider {
  readonly name = "mock-sheets";

  status() {
    return "CONFIGURED" as const;
  }

  async exportRows(title: string, rows: SheetsExportRow[]): Promise<ProviderResult<{ spreadsheetUrl: string }>> {
    const start = Date.now();
    const fakeId = Buffer.from(title).toString("base64url").slice(0, 20);
    return {
      status: "SUCCESS",
      data: { spreadsheetUrl: `https://docs.google.com/spreadsheets/d/demo-${fakeId}/edit#gid=0` },
      durationMs: Date.now() - start,
      requestIdentifier: `mock-sheets:${rows.length}-rows`,
    };
  }
}
