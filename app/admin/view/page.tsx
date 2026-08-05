import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { sortQuarters } from "@/lib/quarter";
import AllocationView, { AllocRateRow } from "./AllocationView";

export const dynamic = "force-dynamic";

export default async function AdminViewPage() {
  const supabase = getSupabaseAdmin();

  const { data: rows } = await supabase
    .from("allocation_rate")
    .select("*")
    .order("quarter", { ascending: true })
    .order("division", { ascending: true })
    .order("basis", { ascending: true });

  const allRows = (rows ?? []) as AllocRateRow[];
  const quarters = sortQuarters(Array.from(new Set(allRows.map((r) => r.quarter))));

  const dataByQuarter: Record<string, AllocRateRow[]> = {};
  quarters.forEach((q) => {
    dataByQuarter[q] = allRows.filter((r) => r.quarter === q);
  });

  return <AllocationView quarters={quarters} dataByQuarter={dataByQuarter} />;
}
