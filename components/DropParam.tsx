"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

// Removes a one-off parameter (e.g. ?fresh=1) from the address once the page
// has used it, so a reload or a shared link doesn't repeat the action.
export function DropParam({ name }: { name: string }) {
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  useEffect(() => {
    if (!params.has(name)) return;
    const next = new URLSearchParams(params.toString());
    next.delete(name);
    const q = next.toString();
    router.replace(`${path}${q ? `?${q}` : ""}`, { scroll: false });
  }, [name, params, path, router]);
  return null;
}
