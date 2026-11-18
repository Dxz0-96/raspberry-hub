"use client";

import Link from "next/link";
import { PageTitle, useI18n } from "@/lib/i18n";

/** A page with only a message and the way back: service unavailable, page not found. */
export function MessagePage({ page }: { page: "unavailable" | "notFound" }) {
  const { t } = useI18n();
  return (
    <main className="page message-page">
      <PageTitle page={page} />
      <h1>{t[page].title}</h1>
      <p>{t[page].body}</p>
      <Link href="/" className="button primary">
        {t.common.backToHub}
      </Link>
    </main>
  );
}
