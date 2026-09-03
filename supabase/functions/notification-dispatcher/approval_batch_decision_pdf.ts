import { jsPDF } from "jspdf";
import autoTableModule from "jspdf-autotable";

const autoTableCandidates: unknown[] = [
  autoTableModule,
  (autoTableModule as unknown as { default?: unknown }).default,
  (autoTableModule as unknown as { autoTable?: unknown }).autoTable,
];
const autoTable = autoTableCandidates.find((candidate) => typeof candidate === "function") as
  | ((doc: InstanceType<typeof jsPDF>, options: Record<string, unknown>) => void)
  | undefined;

type DecisionDocument = {
  batch: {
    label: string;
    company: string | null;
    company_name: string | null;
    status: "approved" | "partially_approved";
    period_start: string | null;
    period_end: string | null;
  };
  items: Array<{
    request_number: string | null;
    provider: string | null;
    provider_name: string | null;
    cost_center: string | null;
    budget_category: string | null;
    payment_method: string | null;
    amount: number | string | null;
    currency: string | null;
    requester_name: string | null;
    director_status: string | null;
    reject_reason: string | null;
    rebatch_release_note: string | null;
  }>;
};

function money(value: unknown, currency: unknown): string | null {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  return `${String(currency || "MXN").slice(0, 8)} ${amount.toLocaleString("es-MX", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function decisionLabel(status: unknown): string {
  return status === "approved" ? "Aprobado" : "Aprobado con rechazos";
}

function itemStatusLabel(status: unknown): string {
  return ({
    approved: "Aprobada por Dirección",
    rejected: "Rechazada por Dirección",
    pending: "Pendiente",
  } as Record<string, string>)[String(status || "")] || String(status || "-");
}

function rows(document: DecisionDocument): string[][] {
  return document.items.map((item) => [
    item.request_number || "-",
    item.provider_name || item.provider || "-",
    `${item.cost_center || "-"}\n${item.budget_category || "-"}`,
    item.payment_method || "-",
    money(item.amount, item.currency) || "-",
    item.requester_name || "-",
    itemStatusLabel(item.director_status),
    `${item.reject_reason || "-"}${item.rebatch_release_note ? `\nReingreso: ${item.rebatch_release_note}` : ""}`,
  ]);
}

export function generateApprovalBatchDecisionPdfBytes(
  document: DecisionDocument,
  logoBytes: Uint8Array | null = null,
): { bytes: Uint8Array; pageCount: number } {
  if (!autoTable) throw new Error("jspdf_autotable_adapter_unavailable");

  const batch = document.batch;
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "letter" });
  const pageWidth = doc.internal.pageSize.getWidth();
  if (logoBytes?.length) {
    try {
      doc.addImage(logoBytes, "WEBP", pageWidth - 36 - 80, 22, 80, 32);
    } catch {
      // The Edge shim embeds the certified logo independently.
    }
  }
  doc.setTextColor(23, 45, 41);
  doc.setFontSize(15);
  doc.text(String(batch.label || "Corte semanal"), 36, 36);
  doc.setFontSize(9);
  doc.setTextColor(96, 110, 104);
  doc.text(
    `${batch.company_name || batch.company || "-"} | ${batch.period_start || "-"} a ${batch.period_end || "-"} | ${decisionLabel(batch.status)}`,
    36,
    53,
  );
  autoTable(doc, {
    startY: 68,
    head: [["Folio", "Proveedor / beneficiario", "Centro / partida", "Metodo", "Monto", "Solicitante", "Decision", "Motivo"]],
    body: rows(document),
    styles: { fontSize: 7, cellPadding: 4, overflow: "linebreak", textColor: [21, 33, 29] },
    headStyles: { fillColor: [23, 45, 41], textColor: [247, 247, 245] },
    alternateRowStyles: { fillColor: [244, 246, 241] },
    didDrawPage: () => {
      doc.setFontSize(7.5);
      doc.setTextColor(150, 160, 155);
      doc.text("Flux Operadora — decisión final del corte semanal", 36, doc.internal.pageSize.getHeight() - 18);
    },
  });
  return {
    bytes: new Uint8Array(doc.output("arraybuffer")),
    pageCount: doc.getNumberOfPages(),
  };
}
