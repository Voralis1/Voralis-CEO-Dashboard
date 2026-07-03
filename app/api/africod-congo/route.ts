import { fetchAfricodCongoOrdersPage, AFRICOD_CONGO } from "@/lib/africodcongo";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const page = Number(searchParams.get("page") ?? "1");
  const perPage = Number(searchParams.get("per_page") ?? "100");

  try {
    const data = await fetchAfricodCongoOrdersPage(AFRICOD_CONGO, page, perPage);
    return Response.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 502 });
  }
}
