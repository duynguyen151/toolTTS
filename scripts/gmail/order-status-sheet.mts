export interface SheetOrderIdRow {
  rowNumber: number;
  orderId: string;
  currentStatus?: string;
}

export interface OrderStatusGroup {
  status: string;
  rowNumbers: number[];
}

export function normalizeSheetOrderId(orderId: string): string {
  return orderId.trim().toUpperCase();
}

export function groupOrderStatusRows(
  rows: SheetOrderIdRow[],
  statusByOrderId: ReadonlyMap<string, string>
): OrderStatusGroup[] {
  const normalizedStatuses = new Map<string, string>();
  for (const [orderId, status] of statusByOrderId) {
    const normalizedOrderId = normalizeSheetOrderId(orderId);
    if (normalizedOrderId.length > 0) normalizedStatuses.set(normalizedOrderId, status.trim() || "UNKNOWN");
  }

  const groups = new Map<string, OrderStatusGroup>();
  for (const row of rows) {
    const normalizedOrderId = normalizeSheetOrderId(row.orderId);
    if (normalizedOrderId.length === 0) continue;

    const status = normalizedStatuses.get(normalizedOrderId) ?? "NOT_FOUND";
    if (row.currentStatus?.trim().toUpperCase() === status) continue;
    const group = groups.get(status);
    if (group) {
      group.rowNumbers.push(row.rowNumber);
    } else {
      groups.set(status, { status, rowNumbers: [row.rowNumber] });
    }
  }

  return [...groups.values()];
}

export function buildStatusBatchPayload(tabTitle: string, group: OrderStatusGroup): Array<{ range: string; values: string[][] }> {
  const escapedTabTitle = tabTitle.replace(/'/g, "''");
  return group.rowNumbers.map((rowNumber) => ({
    range: `'${escapedTabTitle}'!AI${rowNumber}`,
    values: [[group.status]]
  }));
}
