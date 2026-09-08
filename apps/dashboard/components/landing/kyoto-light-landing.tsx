"use client";

import Link from "next/link";
import { ThemeToggle } from "../shell/theme-toggle";
import styles from "./kyoto-light-landing.module.css";

export function KyotoLightLanding() {
  return (
    <div className={styles.container}>
      {/* ── Top Navigation Bar ── */}
      <header className={styles.nav} id="nav">
        <Link href="/dashboard" className={styles.brand}>
          <div className={styles.brandLogo} aria-hidden="true">
            <svg viewBox="0 0 44 44" fill="none">
              <circle cx="22" cy="24" r="9" fill="#ffffff" fillOpacity="0.9" />
              <path d="M5 13h34M9 18.4h26M22 8.5v27" stroke="#b83a28" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          </div>
          <div className={styles.brandTx}>
            <strong>TOOL_TTS</strong>
            <small>TIKTOK SHOP HEALTH</small>
          </div>
        </Link>

        <div className={styles.navRight}>
          <nav className={styles.navLinks}>
            <Link href="/dashboard" className={styles.navLink}>
              Dashboard
            </Link>
            <Link href="/accounts" className={styles.navLink}>
              Tài khoản Cotik
            </Link>
            <Link href="/shops" className={styles.navLink}>
              Cửa hàng
            </Link>
            <Link href="/settings" className={styles.navLink}>
              Cài đặt
            </Link>
          </nav>

          <div className={styles.navActions}>
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* ── Hero Section ── */}
      <section className={styles.hero} id="hero">
        <div className={styles.heroContent}>
          <div className={styles.heroLeft}>
            <div className={styles.eyebrow}>
              <span className={styles.dot} />
              Chapter 00 — Shop Operations Command
            </div>

            <h1 className={styles.title}>
              Hệ thống giám sát
              <br />
              vận hành shop
              <br />
              toàn diện.
            </h1>

            <p className={styles.subtitle}>
              Giám sát chỉ số Delivery Rate, tài chính On Hold COTIK, và hỗ trợ thẩm định BA thời gian thực · GMT+07.
            </p>

            <div className={styles.heroActions}>
              <Link href="/dashboard" className={styles.btnPrimary}>
                <span>⚡ Vào Bảng Điều Hành</span>
              </Link>
              <Link href="/shops" className={styles.btnSecondary}>
                <span>Danh Mục Cửa Hàng</span>
              </Link>
              <Link href="/settings" className={styles.btnGhost}>
                <span>Cài Đặt Hệ Thống</span>
              </Link>
            </div>
          </div>

          <div className={styles.heroRight}>
            <div className={styles.calligraphyCard}>
              <div className={styles.calligraphyText}>京都 嵐山 黎明</div>
              <div className={styles.sealMark}>
                <span>静</span>
                <span>寂</span>
              </div>
            </div>

            <Link href="/shops" className={styles.peekCard}>
              <div className={styles.peekPlay}>
                <svg viewBox="0 0 22 22">
                  <path d="M8 5.6 16.4 11 8 16.4z" />
                </svg>
              </div>
              <div className={styles.peekInfo}>
                <strong>山門 Sanmon</strong>
                <small>Khởi sắc sương mai Kyoto</small>
              </div>
            </Link>
          </div>
        </div>

        {/* ── Hero Footer: Chapter Chips ── */}
        <div className={styles.heroFoot}>
          <div className={styles.cueLine}>
            <span>Khám phá tính năng</span>
            <div className={styles.cueTrack} />
          </div>

          <div className={styles.chipsGrid}>
            <Link href="/dashboard" className={styles.chipCard}>
              <span className={styles.chipNum}>01</span>
              <strong className={styles.chipTitle}>Bảng Điều Hành</strong>
              <p className={styles.chipDesc}>Tổng quan chỉ số và tình trạng toàn bộ hệ thống shop.</p>
            </Link>

            <Link href="/shops" className={styles.chipCard}>
              <span className={styles.chipNum}>02</span>
              <strong className={styles.chipTitle}>Danh Mục Shop</strong>
              <p className={styles.chipDesc}>Theo dõi 42 profile TikTok Shop đang vận hành.</p>
            </Link>

            <Link href="/dashboard?view=delivery" className={styles.chipCard}>
              <span className={styles.chipNum}>03</span>
              <strong className={styles.chipTitle}>Chỉ Số Delivery</strong>
              <p className={styles.chipDesc}>Đo lường tỉ lệ giao hàng chuẩn xác thời gian thực.</p>
            </Link>

            <Link href="/settings" className={styles.chipCard}>
              <span className={styles.chipNum}>04</span>
              <strong className={styles.chipTitle}>Cấu Hình & Cài Đặt</strong>
              <p className={styles.chipDesc}>Thiết lập ngưỡng Rule và đồng bộ tài khoản COTIK.</p>
            </Link>
          </div>
        </div>
      </section>

      {/* ── Section Chapter 01: Giám Sát & Quản Trị Rủi Ro ── */}
      <section className={styles.section} id="gate">
        <div className={styles.secHead}>
          <span><b>01</b> — Giám sát & Quản trị rủi ro</span>
          <div className={styles.secHeadRule} />
          <span className={styles.secHeadJp}>管理</span>
        </div>

        <div className={styles.secGrid}>
          <h2 className={styles.secTitle}>
            Kiểm soát dòng tiền, bảo vệ an toàn từng gian hàng.
          </h2>
          <div className={styles.secCopy}>
            <p className={styles.secLead}>
              Tool TTS kết nối trực tiếp với 5 tài khoản Cotik, giám sát tức thời dòng tiền On Hold và tỷ lệ giao hàng Delivery Rate trên toàn bộ 42 cửa hàng TikTok Shop. Mọi biến động đều được đo lường chính xác theo thời gian thực.
            </p>
            <p className={styles.secBody}>
              Không còn nỗi lo gián đoạn dòng tiền hay tỷ lệ giao hàng sụt giảm bất ngờ. Dữ liệu chuẩn hóa theo múi giờ vận hành GMT+07 giúp bạn nắm trọn tình trạng vận hành, kích hoạt cảnh báo sớm và đưa ra quyết định kịp thời.
            </p>
            <Link href="/dashboard" className={styles.arrowLink}>
              <span>Khám phá Bảng Điều Hành</span>
              <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>

        <div className={styles.statsRow}>
          <div className={styles.statItem}>
            <span className={styles.statVal}>05</span>
            <span className={styles.statLab}>Acc Cotik</span>
          </div>
          <div className={styles.statItem}>
            <span className={styles.statVal}>42</span>
            <span className={styles.statLab}>Cửa hàng</span>
          </div>
          <div className={styles.statItem}>
            <span className={styles.statVal}>24/7</span>
            <span className={styles.statLab}>Giám sát</span>
          </div>
          <div className={styles.statItem}>
            <span className={styles.statVal}>GMT+07</span>
            <span className={styles.statLab}>Giờ vận hành</span>
          </div>
        </div>
      </section>

      {/* ── Section Chapter 02: Hệ Thống Đa Tài Khoản Cotik ── */}
      <section className={styles.section} id="pathways">
        <div className={styles.secHead}>
          <span><b>02</b> — Hệ thống Đa Tài Khoản Cotik</span>
          <div className={styles.secHeadRule} />
          <span className={styles.secHeadJp}>連携</span>
        </div>

        <div className={styles.cardsRow}>
          <Link href="/accounts" className={styles.featureCard}>
            <div className={styles.cardHead}>
              <span className={styles.cardTag}>5 Acc Cotik</span>
              <div className={styles.cardArrow}>→</div>
            </div>
            <h3>Phân luồng 5 AL-Token</h3>
            <p>Quản trị đồng thời Tuấn, Chúc, Lan, Việt, Hằng với token độc lập, cập nhật tự động.</p>
          </Link>

          <Link href="/dashboard" className={styles.featureCard}>
            <div className={styles.cardHead}>
              <span className={styles.cardTag}>Delivery Rate</span>
              <div className={styles.cardArrow}>→</div>
            </div>
            <h3>Tiêu chuẩn an toàn ≥70%</h3>
            <p>Công thức tất định đo lường tỷ lệ giao hàng hoàn tất chuẩn xác theo hợp đồng nghiệp vụ.</p>
          </Link>

          <Link href="/shops" className={styles.featureCard}>
            <div className={styles.cardHead}>
              <span className={styles.cardTag}>Official On Hold</span>
              <div className={styles.cardArrow}>→</div>
            </div>
            <h3>Đối soát dòng tiền thực tế</h3>
            <p>Phân tách minh bạch On Hold Seller Center và số liệu đối chiếu COTIK thời gian thực.</p>
          </Link>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className={styles.footer}>
        <div>
          <strong>TOOL_TTS</strong> · TikTok Shop Health Decision Support System
        </div>
        <div className={styles.footerLinks}>
          <Link href="/dashboard">Dashboard</Link>
          <Link href="/accounts">Tài khoản</Link>
          <Link href="/shops">Cửa hàng</Link>
          <Link href="/settings">Cài đặt</Link>
          <span>Múi giờ: GMT+07</span>
        </div>
      </footer>
    </div>
  );
}
