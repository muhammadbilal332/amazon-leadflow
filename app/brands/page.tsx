import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Nav } from "@/components/nav";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";

export default async function BrandsPage() {
  const supabase = createClient();
  const { data: brands } = await supabase
    .from("brands")
    .select("id, name, marketplace, website, created_at, amazon_products(count)")
    .order("created_at", { ascending: false });

  return (
    <div className="min-h-screen">
      <Nav />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <h1 className="mb-6 text-2xl font-semibold tracking-tight">Brands</h1>
        <Card>
          <CardContent className="p-0">
            {brands && brands.length > 0 ? (
              <table className="w-full text-sm">
                <thead className="border-b border-border text-left text-muted-foreground">
                  <tr>
                    <th className="px-6 py-2 font-medium">Brand</th>
                    <th className="px-6 py-2 font-medium">Marketplace</th>
                    <th className="px-6 py-2 font-medium">Products</th>
                    <th className="px-6 py-2 font-medium">Added</th>
                  </tr>
                </thead>
                <tbody>
                  {brands.map((brand) => (
                    <tr key={brand.id} className="border-b border-border last:border-0 hover:bg-muted/50">
                      <td className="px-6 py-3">
                        <Link href={`/brands/${brand.id}`} className="font-medium hover:underline">
                          {brand.name}
                        </Link>
                      </td>
                      <td className="px-6 py-3 text-muted-foreground">{brand.marketplace}</td>
                      <td className="px-6 py-3">
                        {(brand.amazon_products as unknown as Array<{ count: number }>)?.[0]?.count ?? 0}
                      </td>
                      <td className="px-6 py-3 text-muted-foreground">{formatDate(brand.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="px-6 py-8 text-center text-sm text-muted-foreground">
                No brands researched yet. Start one from the Dashboard.
              </p>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
