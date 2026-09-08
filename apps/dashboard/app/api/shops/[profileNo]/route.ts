import { jsonHeaders } from "../../../../lib/server/operations/request.js";
import { readConsoleShopDetail } from "../../../../lib/operations-console-read.js";
import { AdsPowerClient } from "@shop-health/seller-center/adspower";
import { closeDatabase, createDatabase, unlinkShopByProfileNo, updateShopDisplayName } from "@shop-health/db";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ profileNo: string }> }
): Promise<Response> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const { profileNo } = await params;

  if (!profileNo?.trim()) {
    return Response.json(
      {
        ok: false,
        error: {
          code: "INVALID_REQUEST",
          message: "Mã profile không hợp lệ.",
        },
      },
      { status: 400, headers: jsonHeaders() }
    );
  }

  const adsPower = new AdsPowerClient({
    ...(process.env.ADSPOWER_BASE_URL ? { baseUrl: process.env.ADSPOWER_BASE_URL } : {}),
    ...(process.env.ADSPOWER_API_KEY ? { apiKey: process.env.ADSPOWER_API_KEY } : {}),
  });

  try {
    const detail = await readConsoleShopDetail(databaseUrl, profileNo, adsPower);
    if (!detail) {
      return Response.json(
        {
          ok: false,
          error: {
            code: "PROFILE_NOT_FOUND",
            message: `Không tìm thấy cửa hàng với profileNo: ${profileNo}`,
          },
        },
        { status: 404, headers: jsonHeaders() }
      );
    }

    return Response.json(
      {
        ok: true,
        data: detail,
      },
      { headers: jsonHeaders() }
    );
  } catch (err: any) {
    return Response.json(
      {
        ok: false,
        error: {
          code: "UNEXPECTED_ERROR",
          message: err?.message || "Không thể tải chi tiết cửa hàng.",
        },
      },
      { status: 500, headers: jsonHeaders() }
    );
  }
}
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ profileNo: string }> }
): Promise<Response> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const { profileNo } = await params;

  if (!profileNo?.trim()) {
    return Response.json(
      {
        ok: false,
        error: {
          code: "INVALID_REQUEST",
          message: "Mã profile không hợp lệ.",
        },
      },
      { status: 400, headers: jsonHeaders() }
    );
  }

  if (!databaseUrl) {
    return Response.json(
      {
        ok: false,
        error: {
          code: "DATABASE_UNAVAILABLE",
          message: "Cần cấu hình DATABASE_URL để cập nhật thông tin cửa hàng.",
        },
      },
      { status: 503, headers: jsonHeaders() }
    );
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      {
        ok: false,
        error: {
          code: "INVALID_BODY",
          message: "Dữ liệu JSON không hợp lệ.",
        },
      },
      { status: 400, headers: jsonHeaders() }
    );
  }

  const displayName = typeof body?.displayName === "string" ? body.displayName : undefined;
  if (displayName === undefined) {
    return Response.json(
      {
        ok: false,
        error: {
          code: "INVALID_REQUEST",
          message: "Trường displayName là bắt buộc.",
        },
      },
      { status: 400, headers: jsonHeaders() }
    );
  }

  const context = createDatabase(databaseUrl);
  try {
    const updated = await updateShopDisplayName(context.db, profileNo, displayName);
    return Response.json(
      {
        ok: true,
        data: {
          profileNo: updated.profileNo,
          displayName: updated.displayName,
        },
      },
      { headers: jsonHeaders() }
    );
  } catch (err: any) {
    const isNotFound = err?.message?.includes("Shop not found");
    return Response.json(
      {
        ok: false,
        error: {
          code: isNotFound ? "PROFILE_NOT_FOUND" : "UPDATE_FAILED",
          message: err?.message || "Không thể cập nhật thông tin cửa hàng.",
        },
      },
      { status: isNotFound ? 404 : 500, headers: jsonHeaders() }
    );
  } finally {
    await closeDatabase(context);
  }
}
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ profileNo: string }> }
): Promise<Response> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const { profileNo } = await params;

  if (!profileNo?.trim()) {
    return Response.json(
      {
        ok: false,
        error: {
          code: "INVALID_REQUEST",
          message: "Mã profile không hợp lệ.",
        },
      },
      { status: 400, headers: jsonHeaders() }
    );
  }

  if (!databaseUrl) {
    return Response.json(
      {
        ok: false,
        error: {
          code: "DATABASE_UNAVAILABLE",
          message: "Cần cấu hình DATABASE_URL để gỡ liên kết cửa hàng.",
        },
      },
      { status: 503, headers: jsonHeaders() }
    );
  }

  const context = createDatabase(databaseUrl);
  try {
    const unlinked = await unlinkShopByProfileNo(context.db, profileNo);
    return Response.json(
      {
        ok: true,
        data: {
          profileNo: unlinked.profileNo,
          enabled: unlinked.enabled,
          syncState: unlinked.syncState,
        },
      },
      { headers: jsonHeaders() }
    );
  } catch (err: any) {
    const isNotFound = err?.message?.includes("Shop not found");
    return Response.json(
      {
        ok: false,
        error: {
          code: isNotFound ? "PROFILE_NOT_FOUND" : "UNLINK_FAILED",
          message: err?.message || "Không thể gỡ liên kết cửa hàng.",
        },
      },
      { status: isNotFound ? 404 : 500, headers: jsonHeaders() }
    );
  } finally {
    await closeDatabase(context);
  }
}
