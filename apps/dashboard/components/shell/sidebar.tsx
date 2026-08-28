import { ChartBarSquareIcon } from "@heroicons/react/24/solid";
import Link from "next/link";

import { NavigationList } from "./navigation";

export function ProductMark() {
  return (
    <Link className="product-mark" href="/dashboard" aria-label="Tool TTS bảng điều khiển vận hành">
      <span className="product-mark__icon" aria-hidden="true">
        <ChartBarSquareIcon />
      </span>
      <span>
        <strong>Tool TTS</strong>
        <small>Vận hành TikTok Shop</small>
      </span>
    </Link>
  );
}


export function Sidebar() {
  return (
    <aside className="sidebar">
      <ProductMark />
      <NavigationList />
      <div className="sidebar-log-slot" id="sidebar-log-slot" />
      <section className="sidebar-note" aria-labelledby="sidebar-note-title">
        <span className="sidebar-note__eyebrow">Dấu vết kiểm toán</span>
        <h2 id="sidebar-note-title">Minh bạch theo thiết kế</h2>
        <p>Quy tắc, AI, BA và Thực thi luôn phân tách độc lập.</p>
      </section>
    </aside>
  );
}
