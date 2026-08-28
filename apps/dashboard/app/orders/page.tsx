import Link from "next/link";
import {
  ArrowLeftIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FunnelIcon,
  MagnifyingGlassIcon,
  ShoppingBagIcon,
} from "@heroicons/react/24/outline";

import {
  closeDatabase,
  createDatabase,
  findShopByProfileNo,
  getOrderExplorerDetail,
  listOrderExplorerItems,
  summarizeOrderExplorerRecords,
} from "@shop-health/db";

import { formatOrderExplorerCoverage, orderExplorerWindow, parseOrderExplorerQuery } from "./order-explorer.js";
import { StatusBadge, type StatusTone } from "../../components/ui/status-badge";
import { PrimaryButton } from "../../components/ui/buttons";
import styles from "./orders.module.css";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const ORDER_STATUSES = [
  "PENDING",
  "AWAITING_SHIPMENT",
  "AWAITING_COLLECTION",
  "IN_TRANSIT",
  "DELIVERED",
  "COMPLETED",
  "CANCELED",
  "UNKNOWN",
] as const;

function resolveStatusTone(status: string): StatusTone {
  if (status === "DELIVERED" || status === "COMPLETED") return "success";
  if (status === "IN_TRANSIT") return "info";
  if (status === "PENDING" || status === "AWAITING_SHIPMENT" || status === "AWAITING_COLLECTION") return "warning";
  if (status === "CANCELED") return "danger";
  return "neutral";
}

function href(values: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
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
    return (
      <main className={styles.container}>
        <div className={styles.header}>
          <h1>Order Explorer (Khám phá Đơn hàng)</h1>
          <p>Vui lòng chọn một Profile Shop LIVE từ danh sách hoặc Dashboard để tra cứu dữ liệu đơn hàng đã lưu trữ.</p>
        </div>
      </main>
    );
  }

  const context = createDatabase(databaseUrl);
  try {
    const shop = await findShopByProfileNo(context.db, query.profileNo);
    if (shop === null || shop.dataOrigin !== "LIVE") {
      return (
        <main className={styles.container}>
          <div className={styles.header}>
            <h1>Order Explorer</h1>
            <p>Cửa hàng LIVE được yêu cầu hiện chưa sẵn sàng hoặc không tồn tại.</p>
          </div>
        </main>
      );
    }

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

    return (
      <main className={styles.container}>
        <div className={styles.topNav}>
          <Link href={`/shops/${encodeURIComponent(shop.profileNo)}`} className={styles.backLink}>
            <ArrowLeftIcon className={styles.navIcon} aria-hidden="true" />
            <span>Quay lại Chi tiết Cửa hàng / Shop Detail (Profile #{shop.profileNo})</span>
          </Link>
        </div>

        <header className={styles.header}>
          <div className={styles.headerTitleRow}>
            <div className={styles.headerIconWrap}>
              <ShoppingBagIcon className={styles.headerIcon} aria-hidden="true" />
            </div>
            <div>
              <h1>Order Explorer · {shop.displayName}</h1>
              <p>
                Profile #{shop.profileNo} &bull; Khung thời gian phân tích: <strong>{period.label}</strong> (GMT+07) &bull;{" "}
                <strong>{summary.total}</strong> đơn hàng đã lưu trữ.
              </p>
            </div>
          </div>
          <div className={styles.coverageNote}>
            <span>{formatOrderExplorerCoverage(summary.coverage)}</span>
            <small>Ghi chú: Khung nhìn phân tích độc lập, không tái tính toán quy tắc Rule tự động.</small>
          </div>
        </header>

        {/* Filters Card */}
        <section className={styles.filterCard} aria-label="Order filters">
          <form method="get" className={styles.filterForm} aria-label="Order filters">
            <input type="hidden" name="profile" value={shop.profileNo} />

            <div className={styles.fieldGroup}>
              <label htmlFor="period-select">Khung thời gian:</label>
              <select id="period-select" name="period" defaultValue={query.period} className={styles.select}>
                {["ALL_AVAILABLE", "TODAY", "7D", "30D", "12M"].map((key) => (
                  <option key={key} value={key}>
                    {key === "ALL_AVAILABLE" ? "Toàn bộ dữ liệu" : key}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.fieldGroup}>
              <label htmlFor="status-select">Trạng thái:</label>
              <select id="status-select" name="status" defaultValue={query.status ?? ""} className={styles.select}>
                <option value="">Tất cả trạng thái</option>
                {ORDER_STATUSES.map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>
            </div>

            <div className={`${styles.fieldGroup} ${styles.fieldGrow}`}>
              <label htmlFor="search-input">Mã đơn hoặc Vận đơn (Tracking):</label>
              <div className={styles.inputWrap}>
                <MagnifyingGlassIcon className={styles.inputIcon} aria-hidden="true" />
                <input
                  id="search-input"
                  name="search"
                  defaultValue={query.search}
                  placeholder="Nhập mã đơn hàng hoặc tracking..."
                  className={styles.input}
                />
              </div>
            </div>

            <button type="submit" className={styles.filterSubmitBtn}>
              <FunnelIcon className={styles.btnIcon} aria-hidden="true" />
              <span>Áp dụng lọc</span>
            </button>
          </form>
        </section>

        {/* Orders Table */}
        <section className={styles.tableCard} aria-label="Danh sách đơn hàng đã lưu trữ">
          <div className={styles.tableContainer}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Mã Đơn Hàng (Source ID)</th>
                  <th scope="col">Trạng Thái</th>
                  <th scope="col">Thời Gian Thanh Toán (Paid At)</th>
                  <th scope="col">Giá Trị Đơn</th>
                  <th scope="col">Chi Tiết</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={5} className={styles.noDataCell}>
                      Không có đơn hàng nào khớp với điều kiện lọc.
                    </td>
                  </tr>
                ) : (
                  items.map((item) => (
                    <tr key={item.sourceOrderId} className={styles.tableRow}>
                      <td>
                        <strong className={styles.orderId}>{item.sourceOrderId}</strong>
                      </td>
                      <td>
                        <StatusBadge tone={resolveStatusTone(item.canonicalStatus)}>
                          {item.canonicalStatus}
                        </StatusBadge>
                      </td>
                      <td>
                        {item.paidAt
                          ? new Date(item.paidAt).toLocaleString("vi-VN", { timeZone: "Asia/Bangkok" })
                          : "Chưa xác định"}
                      </td>
                      <td>
                        <strong>
                          {item.grandTotal} {item.currency}
                        </strong>
                      </td>
                      <td>
                        <Link
                          href={href({
                            profile: shop.profileNo,
                            period: query.period,
                            status: query.status,
                            search: query.search,
                            page: query.page,
                            order: item.sourceOrderId,
                          })}
                          className={styles.viewDetailLink}
                        >
                          Xem chi tiết
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <nav className={styles.pagination} aria-label="Order pagination">
            {query.page === 1 ? (
              <span className={styles.pageBtnDisabled} aria-disabled="true">
                <ChevronLeftIcon className={styles.pageIcon} aria-hidden="true" />
                <span>Trang trước</span>
              </span>
            ) : (
              <Link
                href={href({
                  profile: shop.profileNo,
                  period: query.period,
                  status: query.status,
                  search: query.search,
                  page: query.page - 1,
                })}
                className={styles.pageBtn}
              >
                <ChevronLeftIcon className={styles.pageIcon} aria-hidden="true" />
                <span>Trang trước</span>
              </Link>
            )}

            <span className={styles.pageIndicator}>Trang {query.page}</span>

            {items.length < PAGE_SIZE ? (
              <span className={styles.pageBtnDisabled} aria-disabled="true">
                <span>Trang sau</span>
                <ChevronRightIcon className={styles.pageIcon} aria-hidden="true" />
              </span>
            ) : (
              <Link
                href={href({
                  profile: shop.profileNo,
                  period: query.period,
                  status: query.status,
                  search: query.search,
                  page: query.page + 1,
                })}
                className={styles.pageBtn}
              >
                <span>Trang sau</span>
                <ChevronRightIcon className={styles.pageIcon} aria-hidden="true" />
              </Link>
            )}
          </nav>
        </section>

        {/* Order Detail Drawer / Panel */}
        {detail !== null && (
          <section className={styles.detailCard} aria-labelledby="order-detail-heading">
            <h2 id="order-detail-heading">Order detail: {detail.sourceOrderId}</h2>
            <dl className={styles.detailGrid}>
              <div className={styles.detailItem}>
                <dt>Mã đơn hàng</dt>
                <dd>{detail.sourceOrderId}</dd>
              </div>
              <div className={styles.detailItem}>
                <dt>Trạng thái nguồn (Seller Center)</dt>
                <dd>{detail.sourceStatus}</dd>
              </div>
              <div className={styles.detailItem}>
                <dt>Mã vận đơn (Tracking Number)</dt>
                <dd>{detail.trackingNumber ?? "Chưa khả dụng"}</dd>
              </div>
              <div className={styles.detailItem}>
                <dt>Đơn vị vận chuyển (Carrier)</dt>
                <dd>{detail.carrier ?? "Chưa khả dụng"}</dd>
              </div>
              <div className={styles.detailItem}>
                <dt>Đủ điều kiện tính Delivery Rate</dt>
                <dd>
                  <StatusBadge tone={detail.deliveryEligible ? "success" : "neutral"}>
                    {detail.deliveryEligible ? "Có" : "Không"}
                  </StatusBadge>
                </dd>
              </div>
            </dl>
          </section>
        )}
      </main>
    );
  } finally {
    await closeDatabase(context);
  }
}
