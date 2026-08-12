"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { RepositoryManagementPanel } from "./repository-management-panel";

export function RepositoryRoute() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialSearch = searchParams.get("search")?.trim() ?? "";

  function updateSearch(search: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (search.length === 0) next.delete("search");
    else next.set("search", search);
    const query = next.toString();
    router.replace(query.length === 0 ? pathname : `${pathname}?${query}`, { scroll: false });
  }

  return <RepositoryManagementPanel initialSearch={initialSearch} onSearchChange={updateSearch} />;
}
