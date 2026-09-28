import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: job, error } = await supabase
    .from("research_jobs")
    .select("*, brands(id, name, marketplace)")
    .eq("id", params.id)
    .single();

  if (error || !job) return NextResponse.json({ error: "job not found" }, { status: 404 });

  return NextResponse.json({ job });
}
