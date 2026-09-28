"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/toast-provider";

export function NewResearchForm() {
  const router = useRouter();
  const { toast } = useToast();
  const [brandName, setBrandName] = useState("");
  const [marketplace, setMarketplace] = useState("amazon.com");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandName, marketplace }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Something went wrong");
        toast({ title: "Couldn't start research", description: json.error, variant: "error" });
        setLoading(false);
        return;
      }
      toast({ title: "Research started", description: `Researching ${brandName}…`, variant: "success" });
      router.push(`/jobs/${json.jobId}`);
      router.refresh();
    } catch {
      setError("Network error — please try again.");
      toast({ title: "Network error", description: "Please try again.", variant: "error" });
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 sm:flex-row sm:items-end">
      <div className="flex flex-1 flex-col gap-2">
        <Label htmlFor="brandName">Amazon brand name</Label>
        <Input
          id="brandName"
          placeholder="e.g. Anker, Coosa, Bala"
          required
          value={brandName}
          onChange={(e) => setBrandName(e.target.value)}
        />
      </div>
      <div className="flex w-full flex-col gap-2 sm:w-48">
        <Label htmlFor="marketplace">Marketplace</Label>
        <Input id="marketplace" value={marketplace} onChange={(e) => setMarketplace(e.target.value)} />
      </div>
      <Button type="submit" disabled={loading || brandName.trim().length < 2}>
        {loading ? "Starting research..." : "Start Research"}
      </Button>
      {error && <p className="text-sm text-destructive sm:ml-3">{error}</p>}
    </form>
  );
}
