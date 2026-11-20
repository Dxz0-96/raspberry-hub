"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, CircleAlert, LoaderCircle, TriangleAlert } from "lucide-react";
import { errorMessage, readPiVersion, readUpgrade, useHub } from "@/lib/hub";
import { useI18n } from "@/lib/i18n";
import { isNewMajor } from "@/lib/version";
import type { UpgradeProgress, UpgradeStatus } from "@/lib/types";
import { Dialog } from "./Dialog";

const REPO = process.env.NEXT_PUBLIC_REPO ?? "";
const STEPS = ["download", "verify", "install", "check"] as const;
/** The existing status poll runs every 5 seconds: the upgrade is followed at the same pace. */
const POLL = 5000;

type Phase = "confirm" | "progress" | "done" | "failed";

/** Release notes as release-please writes them, in plain text: headings and bullets, without links. */
function ReleaseNotes({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let items: string[] = [];
  const flush = () => {
    if (items.length) blocks.push(<ul key={blocks.length}>{items.map((item, i) => <li key={i}>{item}</li>)}</ul>);
    items = [];
  };
  for (const raw of text.split(/\r?\n/).slice(0, 80)) {
    const line = raw
      .replace(/\s*\(\[[^\]]*\]\([^)]*\)\)/g, "") // "([#34](...))", "([3f1ee03](...))": pull request and commit
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\*\*/g, "")
      .trim();
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    const item = /^[*-]\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      blocks.push(<h3 key={blocks.length}>{heading[1]}</h3>);
    } else if (item) {
      items.push(item[1]);
    } else if (line) {
      flush();
      blocks.push(<p key={blocks.length}>{line}</p>);
    }
  }
  flush();
  return <div className="release-notes">{blocks}</div>;
}

/**
 * "Update to X.Y.Z": the release notes, a confirmation, then the progress of the upgrade on the Raspberry Pi
 * (hub-upgrade@.service). Caddy and hub-control restart along the way, so failed requests only mean "wait".
 * When the Raspberry Pi answers with the new version, the page reloads to get the new website.
 */
export function UpgradeDialog({
  open,
  onClose,
  version,
  installed,
}: {
  open: boolean;
  onClose: () => void;
  version: string;
  installed: string;
}) {
  const { t } = useI18n();
  const { startUpgrade } = useHub();
  const [status, setStatus] = useState<UpgradeStatus | null>(null);
  const [phase, setPhase] = useState<Phase>("confirm");
  const [progress, setProgress] = useState<UpgradeProgress | null>(null);
  /** the last step seen before "done" or "failed", which replace it in the progress file */
  const [lastStep, setLastStep] = useState<string>("start");
  const [waiting, setWaiting] = useState(false);
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<unknown>(null);
  /** the progress file of an earlier upgrade, until the new one replaces it */
  const previous = useRef<string | null>(null);

  // what is there to install, and whether an upgrade is already running (the page was reloaded meanwhile)
  useEffect(() => {
    if (!open) return;
    setProblem(null);
    setWaiting(false);
    readUpgrade()
      .then((data) => {
        setStatus(data);
        const running = data.progress && !["done", "failed"].includes(data.progress.step);
        if (running && data.progress) {
          setProgress(data.progress);
          setLastStep(data.progress.step);
          setPhase("progress");
        } else {
          setPhase("confirm");
        }
      })
      .catch(() => setStatus(null));
  }, [open]);

  // the upgrade, step by step
  useEffect(() => {
    if (!open || phase !== "progress") return;
    let stopped = false;
    const timer = setInterval(async () => {
      try {
        const data = await readUpgrade();
        if (stopped) return;
        setWaiting(false);
        const current = data.progress;
        if (!current || current.version !== version || current.started === previous.current) return;
        setProgress(current);
        if ((STEPS as readonly string[]).includes(current.step)) setLastStep(current.step);
        if (current.step === "done") setPhase("done");
        if (current.step === "failed") setPhase("failed");
      } catch {
        if (!stopped) setWaiting(true); // hub-control or Caddy restarting
      }
    }, POLL);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [open, phase, version]);

  // installed: as soon as the Raspberry Pi answers with the new version, the new website is loaded
  useEffect(() => {
    if (phase !== "done") return;
    const timer = setInterval(async () => {
      try {
        if ((await readPiVersion()) === version) window.location.reload();
      } catch {
        // still restarting
      }
    }, POLL);
    return () => clearInterval(timer);
  }, [phase, version]);

  async function confirm() {
    setSending(true);
    setProblem(null);
    previous.current = status?.progress?.started ?? null;
    try {
      await startUpgrade(version, () => {
        setProgress(null);
        setLastStep("start");
        setPhase("progress");
      });
    } catch (error) {
      setProblem(error);
    } finally {
      setSending(false);
    }
  }

  const major = isNewMajor(version, installed);
  const notes = status?.latest?.version === version ? status.latest.notes : undefined;
  const reached = STEPS.indexOf(lastStep as (typeof STEPS)[number]);
  const failure = progress?.error ? (t.upgrade.errors[progress.error] ?? t.upgrade.failed) : t.upgrade.failed;

  return (
    <Dialog open={open} onClose={onClose} title={t.upgrade.title(version)}>
      {phase === "confirm" ? (
        <>
          <p className="dialog-intro">{t.upgrade.versions(installed, version)}</p>
          {major && (
            <p className="warning-box">
              <TriangleAlert size={18} aria-hidden="true" />
              <span>
                {t.upgrade.major(version)}{" "}
                {REPO && (
                  <a href={`${REPO}/blob/main/docs/upgrading.md`} target="_blank" rel="noopener noreferrer">
                    {t.upgrade.readFirst}
                    <span className="sr-only">{t.common.opensInNewTab}</span>
                  </a>
                )}
              </span>
            </p>
          )}
          <h3 className="release-notes-title">{t.upgrade.notes}</h3>
          {notes ? <ReleaseNotes text={notes} /> : <p className="dialog-text">{t.upgrade.noNotes}</p>}
          {status?.latest?.url && (
            <p className="dialog-text">
              <a href={status.latest.url} target="_blank" rel="noopener noreferrer">
                {t.upgrade.releasePage}
                <span className="sr-only">{t.common.opensInNewTab}</span>
              </a>
            </p>
          )}
          <p className="dialog-text">{t.upgrade.explain}</p>
          {problem !== null && (
            <p className="error-box" role="alert">
              <CircleAlert size={18} aria-hidden="true" />
              <span>{errorMessage(t, problem, t.upgrade.failed)}</span>
            </p>
          )}
          <div className="dialog-actions">
            <button type="button" className="button" onClick={onClose}>
              {t.common.cancel}
            </button>
            <button type="button" className="button primary" disabled={sending} onClick={confirm}>
              {t.upgrade.confirm}
            </button>
          </div>
        </>
      ) : (
        <>
          <ol className="upgrade-steps" aria-label={t.upgrade.progressLabel}>
            {STEPS.map((step, i) => {
              const done = phase === "done" || i < reached;
              const current = !done && i === reached;
              return (
                <li key={step} className={done ? "done" : current ? "current" : undefined}
                  aria-current={current ? "step" : undefined}>
                  {done ? (
                    <Check size={18} aria-hidden="true" />
                  ) : current && phase === "progress" ? (
                    <LoaderCircle size={18} aria-hidden="true" className="spin" />
                  ) : current ? (
                    <CircleAlert size={18} aria-hidden="true" />
                  ) : (
                    <span className="upgrade-dot" aria-hidden="true" />
                  )}
                  <span>{t.upgrade.steps[step]}</span>
                  {done && <span className="sr-only">: {t.upgrade.stepDone}</span>}
                </li>
              );
            })}
          </ol>
          <div aria-live="polite">
            {phase === "progress" && (
              <p className="dialog-text">{waiting ? t.upgrade.waiting : progress ? t.upgrade.running : t.upgrade.starting}</p>
            )}
            {phase === "done" && (
              <p className="dialog-text">
                {progress?.warning ? t.upgrade.doneWithWarnings(version) : t.upgrade.done(version)}
              </p>
            )}
            {phase === "failed" && (
              <p className="error-box" role="alert">
                <CircleAlert size={18} aria-hidden="true" />
                <span>
                  {failure} {t.upgrade.details}
                </span>
              </p>
            )}
          </div>
          <div className="dialog-actions">
            {phase === "done" ? (
              <button type="button" className="button primary" onClick={() => window.location.reload()}>
                {t.upgrade.reload}
              </button>
            ) : (
              <button type="button" className="button" onClick={onClose}>
                {t.common.close}
              </button>
            )}
          </div>
        </>
      )}
    </Dialog>
  );
}
