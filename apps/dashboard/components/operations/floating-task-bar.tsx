"use client";

import { useState } from "react";
import {
  ArrowPathIcon,
  Bars3Icon,
  ChevronDownIcon,
  ChevronUpIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { useGlobalTasks } from "./global-task-context";
import styles from "./floating-task-bar.module.css";

const statusLabels: Record<string, string> = {
  RUNNING: "Đang chạy",
  SUCCESS: "Hoàn tất",
  ERROR: "Thất bại",
};

export function FloatingTaskBar() {
  const { tasks, runningCount, hasRunningTasks, clearFinished, removeTask } = useGlobalTasks();
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <aside className={styles.floatingContainer} aria-label="Tiến trình tác vụ nền">
      {!isExpanded ? (
        <button
          type="button"
          className={styles.pillBar}
          onClick={() => setIsExpanded(true)}
          aria-label="Mở thanh tác vụ nền"
          aria-expanded="false"
          aria-controls="background-task-panel"
          title="Bấm để mở rộng chi tiết tiến trình nền"
        >
          <Bars3Icon className={styles.pillMenuIcon} aria-hidden="true" />
          {hasRunningTasks && <span className={styles.pillCount}>{runningCount}</span>}
        </button>
      ) : (
        <div className={styles.expandedCard} id="background-task-panel">
          <header className={styles.expandedHeader}>
            <span className={styles.expandedTitle}>
              <ArrowPathIcon style={{ width: 16, height: 16 }} className={hasRunningTasks ? styles.pillSpinner : ""} aria-hidden="true" />
              <span>Tiến trình tác vụ ({runningCount} đang chạy)</span>
            </span>
            <div className={styles.expandedActions}>
              {!hasRunningTasks && tasks.length > 0 && (
                <button
                  type="button"
                  onClick={clearFinished}
                  className={styles.actionIconBtn}
                  title="Xóa danh sách tác vụ đã xong"
                >
                  Xóa
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsExpanded(false)}
                className={styles.actionIconBtn}
                aria-label="Thu nhỏ thanh tác vụ nền"
                title="Thu nhỏ thanh tiến trình"
              >
                <ChevronDownIcon style={{ width: 14, height: 14 }} aria-hidden="true" />
              </button>
            </div>
          </header>

          <div className={styles.taskList}>
            {tasks.length === 0 ? (
              <p className={styles.emptyState}>Chưa có tác vụ nền.</p>
            ) : tasks.map((task) => (
              <div key={task.id} className={styles.taskItem}>
                <div className={styles.taskHead}>
                  <strong className={styles.taskTitle}>{task.title}</strong>
                  <span className={styles.taskBadge} data-status={task.status}>
                    {statusLabels[task.status] ?? task.status}
                  </span>
                </div>
                <p className={styles.taskMessage}>{task.message}</p>
                <div className={styles.taskMeta}>
                  <small className={styles.taskTime}>
                    Bắt đầu: {task.startedAt.toLocaleTimeString("vi-VN")}
                  </small>
                  {task.status !== "RUNNING" && (
                    <button
                      type="button"
                      onClick={() => removeTask(task.id)}
                      className={styles.dismissTaskButton}
                      title="Bỏ qua"
                      aria-label={`Bỏ qua tác vụ ${task.title}`}
                    >
                      <XMarkIcon aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}
