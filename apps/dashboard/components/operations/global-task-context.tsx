"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useTransition,
  type ReactNode,
} from "react";

export type TaskType = "SYNC" | "VERIFY" | "OPEN";
export type TaskStatus = "RUNNING" | "SUCCESS" | "ERROR";

export interface BackgroundTask {
  readonly id: string;
  readonly profileNo: string;
  readonly shopName?: string | undefined;
  readonly type: TaskType;
  readonly status: TaskStatus;
  readonly title: string;
  readonly message: string;
  readonly error?: string | undefined;
  readonly startedAt: Date;
  readonly finishedAt?: Date | undefined;
}

export interface GlobalTaskContextValue {
  readonly tasks: readonly BackgroundTask[];
  readonly runningCount: number;
  readonly hasRunningTasks: boolean;
  startSync(profileNo: string, shopName?: string): Promise<boolean>;
  startVerify(profileNo: string, shopName?: string): Promise<boolean>;
  startOpen(profileNo: string, shopName?: string): Promise<boolean>;
  removeTask(id: string): void;
  clearFinished(): void;
  isProfileBusy(profileNo: string): boolean;
}

const GlobalTaskContext = createContext<GlobalTaskContextValue | null>(null);

export function GlobalTaskProvider({ children }: { children: ReactNode }) {
  let router: { refresh(): void } | null = null;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    router = useRouter();
  } catch {
    router = null;
  }
  const [, startTransition] = useTransition();
  const [tasks, setTasks] = useState<readonly BackgroundTask[]>([]);

  const triggerRefresh = useCallback(() => {
    if (router) {
      startTransition(() => {
        router?.refresh();
      });
    }
  }, [router]);

  const updateTask = useCallback((id: string, updates: Partial<BackgroundTask>) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...updates } : t)),
    );
  }, []);

  const removeTask = useCallback((id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const clearFinished = useCallback(() => {
    setTasks((prev) => prev.filter((t) => t.status === "RUNNING"));
  }, []);

  const isProfileBusy = useCallback(
    (profileNo: string): boolean => {
      return tasks.some((t) => t.profileNo === profileNo && t.status === "RUNNING");
    },
    [tasks],
  );

  const startOpen = useCallback(
    async (profileNo: string, shopName?: string): Promise<boolean> => {
      const taskId = `open-${profileNo}-${Date.now()}`;
      const newTask: BackgroundTask = {
        id: taskId,
        profileNo,
        shopName,
        type: "OPEN",
        status: "RUNNING",
        title: `Mở AdsPower #${profileNo}`,
        message: "Đang kích hoạt phiên trình duyệt AdsPower...",
        startedAt: new Date(),
      };
      setTasks((prev) => [newTask, ...prev]);

      try {
        const res = await fetch("/api/profiles/open", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ profileNo }),
        });
        const data = await res.json();
        if (res.ok && data.ok) {
          updateTask(taskId, {
            status: "SUCCESS",
            message: `Đã mở profile #${profileNo} thành công`,
            finishedAt: new Date(),
          });
          triggerRefresh();
          return true;
        }
        updateTask(taskId, {
          status: "ERROR",
          message: data.error?.message || "Không thể mở profile AdsPower",
          error: data.error?.message,
          finishedAt: new Date(),
        });
        return false;
      } catch (err: any) {
        updateTask(taskId, {
          status: "ERROR",
          message: err?.message || "Lỗi kết nối khi mở profile",
          error: err?.message,
          finishedAt: new Date(),
        });
        return false;
      }
    },
    [updateTask, triggerRefresh],
  );

  const startVerify = useCallback(
    async (profileNo: string, shopName?: string): Promise<boolean> => {
      const taskId = `verify-${profileNo}-${Date.now()}`;
      const newTask: BackgroundTask = {
        id: taskId,
        profileNo,
        shopName,
        type: "VERIFY",
        status: "RUNNING",
        title: `Xác thực danh tính #${profileNo}`,
        message: "Đang kiểm tra phiên TikTok Seller Center qua AdsPower...",
        startedAt: new Date(),
      };
      setTasks((prev) => [newTask, ...prev]);

      try {
        const res = await fetch("/api/profiles/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ profileNo }),
        });
        const data = await res.json();
        if (res.ok && data.ok) {
          const isReady = data.verificationState === "READY";
          updateTask(taskId, {
            status: isReady ? "SUCCESS" : "ERROR",
            message: isReady
              ? `Xác thực thành công: Sẵn sàng (READY)`
              : `Kết quả xác thực: ${data.verificationState}`,
            finishedAt: new Date(),
          });
          triggerRefresh();
          return isReady;
        }
        updateTask(taskId, {
          status: "ERROR",
          message: data.error?.message || "Không thể xác thực danh tính",
          error: data.error?.message,
          finishedAt: new Date(),
        });
        return false;
      } catch (err: any) {
        updateTask(taskId, {
          status: "ERROR",
          message: err?.message || "Lỗi kết nối khi xác thực profile",
          error: err?.message,
          finishedAt: new Date(),
        });
        return false;
      }
    },
    [updateTask, triggerRefresh],
  );

  const startSync = useCallback(
    async (profileNo: string, shopName?: string): Promise<boolean> => {
      const taskId = `sync-${profileNo}-${Date.now()}`;
      const newTask: BackgroundTask = {
        id: taskId,
        profileNo,
        shopName,
        type: "SYNC",
        status: "RUNNING",
        title: `Đồng bộ dữ liệu #${profileNo}`,
        message: "Đang đồng bộ đơn hàng & đối soát tài chính On Hold...",
        startedAt: new Date(),
      };
      setTasks((prev) => [newTask, ...prev]);

      try {
        const res = await fetch("/api/sync/selected", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ profileNo }),
        });
        const data = await res.json();
        if (res.ok && (data.ok || data.status === "SUCCEEDED" || data.status === "ACTIVE")) {
          updateTask(taskId, {
            status: "SUCCESS",
            message: `Đồng bộ hoàn tất: Đơn hàng & On Hold đã cập nhật`,
            finishedAt: new Date(),
          });
          triggerRefresh();
          return true;
        }
        updateTask(taskId, {
          status: "ERROR",
          message: data.error?.message || "Không thể hoàn tất đồng bộ",
          error: data.error?.message,
          finishedAt: new Date(),
        });
        return false;
      } catch (err: any) {
        updateTask(taskId, {
          status: "ERROR",
          message: err?.message || "Lỗi kết nối khi đồng bộ dữ liệu",
          error: err?.message,
          finishedAt: new Date(),
        });
        return false;
      }
    },
    [updateTask, triggerRefresh],
  );

  // Auto-refresh interval while any task is running to ensure live DB updates
  const runningCount = useMemo(() => tasks.filter((t) => t.status === "RUNNING").length, [tasks]);
  const hasRunningTasks = runningCount > 0;

  useEffect(() => {
    if (!hasRunningTasks) return;
    const interval = setInterval(() => {
      triggerRefresh();
    }, 4000);
    return () => clearInterval(interval);
  }, [hasRunningTasks, triggerRefresh]);

  const value: GlobalTaskContextValue = useMemo(
    () => ({
      tasks,
      runningCount,
      hasRunningTasks,
      startSync,
      startVerify,
      startOpen,
      removeTask,
      clearFinished,
      isProfileBusy,
    }),
    [
      tasks,
      runningCount,
      hasRunningTasks,
      startSync,
      startVerify,
      startOpen,
      removeTask,
      clearFinished,
      isProfileBusy,
    ],
  );

  return (
    <GlobalTaskContext.Provider value={value}>
      {children}
    </GlobalTaskContext.Provider>
  );
}

export function useGlobalTasks(): GlobalTaskContextValue {
  const context = useContext(GlobalTaskContext);
  if (!context) {
    throw new Error("useGlobalTasks must be used within a GlobalTaskProvider");
  }
  return context;
}
