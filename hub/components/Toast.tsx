"use client";

import { Check, CircleAlert, X } from "lucide-react";
import { useHub } from "@/lib/hub";
import { useI18n } from "@/lib/i18n";

/** Short message at the bottom of the page: the outcome of an action, or what to do if it failed. */
export function Toast() {
  const { toast, closeToast } = useHub();
  const { t } = useI18n();
  return (
    <div className="toast-region" aria-live="polite">
      {toast && (
        <div className={`toast ${toast.tone}`} role={toast.tone === "error" ? "alert" : "status"}>
          {toast.tone === "error" ? (
            <CircleAlert size={18} aria-hidden="true" />
          ) : (
            <Check size={18} aria-hidden="true" />
          )}
          <span>{toast.text(t)}</span>
          <button type="button" className="icon-button" aria-label={t.toast.close} onClick={closeToast}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
