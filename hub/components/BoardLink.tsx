"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n";

/** On phones the board on the home page (the detailed one, turned vertical) opens the hardware page. */
export function BoardLink({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  return (
    <Link href="/hardware/" className="narrow-only board-link" aria-label={t.home.boardLink}>
      {children}
    </Link>
  );
}
