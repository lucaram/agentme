import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
export async function GET() {
  const user = await getUser();
  return NextResponse.json(user ? { role: user.businessRole ?? null, id: user.id } : { lost: true }, { status: user ? 200 : 401, headers: { "Cache-Control": "private, no-store" } });
}
