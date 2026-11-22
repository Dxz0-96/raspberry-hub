"use client";

// The restart button of the header: after a login and a confirmation, the Raspberry Pi restarts (hub-reboot.service,
// like sudo reboot), then the window waits until the hub answers again.

import { useEffect, useRef, useState } from "react";
import { CircleAlert, LoaderCircle, Power, TriangleAlert } from "lucide-react";
import { api, errorMessage, useHub } from "@/lib/hub";
import { useI18n } from "@/lib/i18n";
import type { SystemInfo } from "@/lib/types";
import { Dialog } from "./Dialog";

/** The pace of the existing status poll */
const POLL = 5000;

type Phase = "confirm" | "restarting" | "back";

export function RestartButton() {
  const { authenticated, openLogin, restart, content, system } = useHub();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("confirm");
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<unknown>(null);
  /** the uptime when the restart was asked: a smaller one means the Raspberry Pi has restarted */
  const uptimeBefore = useRef<number | null>(null);

  function ask() {
    setPhase("confirm");
    setProblem(null);
    // the login first, as for the switches; then the confirmation
    if (authenticated) setOpen(true);
    else openLogin(() => setOpen(true));
  }

  async function confirm() {
    setSending(true);
    setProblem(null);
    uptimeBefore.current = system?.uptime ?? null;
    try {
      await restart(() => setPhase("restarting"));
    } catch (error) {
      setProblem(error);
    } finally {
      setSending(false);
    }
  }

  // restarting: back when the Raspberry Pi answers with a shorter uptime, or answers again after it went away
  useEffect(() => {
    if (!open || phase !== "restarting") return;
    let stopped = false;
    let wentAway = false;
    const timer = setInterval(async () => {
      try {
        const now = await api<SystemInfo>("/control/system");
        const before = uptimeBefore.current;
        if (!stopped && ((before !== null && now.uptime < before) || (before === null && wentAway))) setPhase("back");
      } catch {
        wentAway = true; // not answering: restarting
      }
    }, POLL);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [open, phase]);

  const updating = Boolean(content && (content.wikipedia.running || content.maps.running || content.addresses.running));

  return (
    <>
      <button type="button" className="button restart-button" aria-label={t.header.restart} title={t.header.restart}
        onClick={ask}>
        <Power size={17} aria-hidden="true" />
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t.restart.title}>
        {phase === "confirm" ? (
          <>
            <p className="dialog-text">{t.restart.body}</p>
            {updating && (
              <p className="warning-box">
                <TriangleAlert size={18} aria-hidden="true" />
                <span>{t.restart.contentRunning}</span>
              </p>
            )}
            {problem !== null && (
              <p className="error-box" role="alert">
                <CircleAlert size={18} aria-hidden="true" />
                <span>{errorMessage(t, problem, t.restart.failed)}</span>
              </p>
            )}
            <div className="dialog-actions">
              <button type="button" className="button" onClick={() => setOpen(false)}>{t.common.cancel}</button>
              <button type="button" className="button danger" disabled={sending} onClick={confirm}>
                <Power size={17} aria-hidden="true" />
                {t.restart.confirm}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="dialog-text" role="status">
              {phase === "restarting" && <LoaderCircle size={18} aria-hidden="true" className="spin" />}{" "}
              {phase === "restarting" ? t.restart.restarting : t.restart.back}
            </p>
            <div className="dialog-actions">
              <button type="button" className={phase === "back" ? "button primary" : "button"} onClick={() => setOpen(false)}>
                {t.common.close}
              </button>
            </div>
          </>
        )}
      </Dialog>
    </>
  );
}
