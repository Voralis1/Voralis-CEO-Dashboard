import { NextResponse } from "next/server";
import { fetchShipsenStats } from "@/lib/shipsen";
import { SHIPSEN_DATA } from "@/lib/data";

export const revalidate = 300; // re-fetch every 5 minutes

export async function GET() {
  try {
    const data = await fetchShipsenStats();
    return NextResponse.json({ data, source: "live" });
  } catch (err) {
    console.error("[Shipsen API]", err);
    return NextResponse.json({ data: SHIPSEN_DATA, source: "mock" });
  }
}
