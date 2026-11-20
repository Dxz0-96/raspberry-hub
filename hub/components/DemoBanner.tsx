"use client";

import { Info } from "lucide-react";
import { DEMO, DEMO_PASSWORD, DEMO_USER } from "@/lib/hub";
import { useI18n } from "@/lib/i18n";

const REPO = process.env.NEXT_PUBLIC_REPO ?? "";

/** Only in the demo on GitHub Pages: what it is, and the login to try the switches. */
export function DemoBanner() {
  const { t } = useI18n();
  if (!DEMO) return null;
  return (
    <aside className="demo-banner" aria-label={t.demo.label}>
      <Info size={18} aria-hidden="true" />
      <p>
        {t.demo.text(DEMO_USER, DEMO_PASSWORD)}{" "}
        {REPO && <a href={`${REPO}#installation`}>{t.demo.install}</a>}
      </p>
    </aside>
  );
}
