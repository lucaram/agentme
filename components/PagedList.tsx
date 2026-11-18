"use client";

import { Children, useState, type ReactNode } from "react";
import { LoadMore } from "@/components/LoadMore";
import { PAGE_SIZE } from "@/lib/paging";

/** A list already on the page: the first few, then more as you scroll near the end. */
export function PagedList({ children, className }: { children: ReactNode; className?: string }) {
  const items = Children.toArray(children);
  const [shown, setShown] = useState(PAGE_SIZE);
  return (
    <>
      <div className={className}>{items.slice(0, shown)}</div>
      {items.length > shown && <LoadMore onMore={() => setShown((n) => n + PAGE_SIZE)} left={items.length - shown} />}
    </>
  );
}
