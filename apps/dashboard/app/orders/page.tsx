import Link from "next/link";

import {
  closeDatabase,
  createDatabase,
  findShopByProfileNo,
  getOrderExplorerDetail,
  listOrderExplorerItems,
  summarizeOrderExplorerRecords,
} from "@shop-health/db";

import { formatOrderExplorerCoverage, orderExplorerWindow, parseOrderExplorerQuery } from "./order-explorer.js";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const ORDER_STATUSES = ["PENDING", "AWAITING_SHIPMENT", "AWAITING_COLLECTION", "IN_TRANSIT", "DELIVERED", "COMPLETED", "CANCELED", "UNKNOWN"] as const;

function href(values: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== "") params.set(key, String(value));
  return `/orders?${params}`;
}

export default async function OrderExplorerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = parseOrderExplorerQuery(await searchParams);
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl || !query.profileNo) {
    return <main><h1>Order Explorer</h1><p>Select a LIVE shop profile from the dashboard to inspect persisted orders.</p></main>;
  }

  const context = createDatabase(databaseUrl);
  try {
    const shop = await findShopByProfileNo(context.db, query.profileNo);
    if (shop === null || shop.dataOrigin !== "LIVE") return <main><h1>Order Explorer</h1><p>The requested LIVE shop is unavailable.</p></main>;
    const period = orderExplorerWindow(query.period);
    const filter = {
      shopId: shop.id,
      ...(period.start === null ? {} : { start: period.start }),
      ...(period.end === null ? {} : { end: period.end }),
      ...(query.status === undefined ? {} : { canonicalStatus: query.status }),
      ...(query.search === undefined ? {} : { search: query.search }),
    };
    const [items, summary] = await Promise.all([
      listOrderExplorerItems(context.db, { ...filter, limit: PAGE_SIZE, offset: (query.page - 1) * PAGE_SIZE }),
      summarizeOrderExplorerRecords(context.db, filter),
    ]);
    const detailId = (await searchParams).order;
    const sourceOrderId = Array.isArray(detailId) ? detailId[0] : detailId;
    const detail = sourceOrderId ? await getOrderExplorerDetail(context.db, shop.id, sourceOrderId) : null;

    return <main>
      <p><Link href={`/dashboard?profile=${encodeURIComponent(shop.profileNo)}`}>Back to dashboard</Link></p>
      <h1>Order Explorer</h1>
      <p>Profile {shop.profileNo} · {period.label} · {summary.total} persisted orders. This analytical view does not recompute the Rule.</p>
      <p>{formatOrderExplorerCoverage(summary.coverage)}</p>
      <form method="get" aria-label="Order filters">
        <input type="hidden" name="profile" value={shop.profileNo} />
        <label>Period <select name="period" defaultValue={query.period}>{["ALL_AVAILABLE", "TODAY", "7D", "30D", "12M"].map((key) => <option key={key}>{key}</option>)}</select></label>
        <label>Status <select name="status" defaultValue={query.status ?? ""}><option value="">All statuses</option>{ORDER_STATUSES.map((status) => <option key={status}>{status}</option>)}</select></label>
        <label>Order or tracking search <input name="search" defaultValue={query.search} /></label>
        <button type="submit">Apply filters</button>
      </form>
      <table><caption>Privacy-minimized persisted orders</caption><thead><tr><th>Order</th><th>Status</th><th>Paid at</th><th>Total</th></tr></thead><tbody>{items.map((item) => <tr key={item.sourceOrderId}><td><Link href={href({ profile: shop.profileNo, period: query.period, status: query.status, search: query.search, page: query.page, order: item.sourceOrderId })}>{item.sourceOrderId}</Link></td><td>{item.canonicalStatus}</td><td>{item.paidAt?.toISOString() ?? "Unavailable"}</td><td>{item.grandTotal} {item.currency}</td></tr>)}</tbody></table>
      {items.length === 0 ? <p>No persisted orders match these filters.</p> : null}
      <nav aria-label="Order pagination">
        {query.page === 1 ? <span aria-disabled="true">Previous</span> : <Link href={href({ profile: shop.profileNo, period: query.period, status: query.status, search: query.search, page: query.page - 1 })}>Previous</Link>}
        <span> Page {query.page} </span>
        {items.length < PAGE_SIZE ? <span aria-disabled="true">Next</span> : <Link href={href({ profile: shop.profileNo, period: query.period, status: query.status, search: query.search, page: query.page + 1 })}>Next</Link>}
      </nav>
      {detail === null ? null : <section aria-labelledby="order-detail"><h2 id="order-detail">Order detail</h2><dl><div><dt>Order</dt><dd>{detail.sourceOrderId}</dd></div><div><dt>Source status</dt><dd>{detail.sourceStatus}</dd></div><div><dt>Tracking</dt><dd>{detail.trackingNumber ?? "Unavailable"}</dd></div><div><dt>Carrier</dt><dd>{detail.carrier ?? "Unavailable"}</dd></div><div><dt>Delivery eligible</dt><dd>{String(detail.deliveryEligible)}</dd></div></dl></section>}
    </main>;
  } finally {
    await closeDatabase(context);
  }
}
