export async function GET() {
  const res = await fetch("https://www.voralisnatural.com/api/v1/reports/networks", {
    headers: { Authorization: `Bearer ${process.env.REPORTING_API_KEY}` },
    cache: "no-store",
  });
  const data = await res.json();
  return Response.json(data);
}
