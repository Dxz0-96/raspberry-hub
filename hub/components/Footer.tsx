"use client";

import { useState } from "react";
import { Bug, Download, GitBranch, PartyPopper, Scale, TriangleAlert } from "lucide-react";
import { useHub } from "@/lib/hub";
import { longDate } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { isNewMajor, isNewer } from "@/lib/version";
import { UpgradeDialog } from "./UpgradeDialog";

const VERSION = process.env.NEXT_PUBLIC_VERSION ?? "";
const LICENSE = process.env.NEXT_PUBLIC_LICENSE ?? "";
const REPO = process.env.NEXT_PUBLIC_REPO ?? "";
const COMMIT = process.env.NEXT_PUBLIC_COMMIT ?? "";
const BUILT = process.env.NEXT_PUBLIC_BUILT ?? "";
/** "Dxz0-96/raspberry-hub" from "https://github.com/Dxz0-96/raspberry-hub" */
const REPO_NAME = REPO.replace(/^https?:\/\/(www\.)?github\.com\//, "");
const ON_GITHUB = REPO_NAME !== REPO;

/** The footer: what the hub is, version, source code and where the data comes from. */
export function Footer() {
  const { t, locale } = useI18n();
  const { piVersion, content, authenticated, openLogin } = useHub();
  // the release being installed: the dialog stays open when the notice goes away (the new version answers)
  const [upgrade, setUpgrade] = useState<{ version: string; installed: string } | null>(null);
  // the website and the Raspberry Pi scripts come from different releases: deploy.ps1 without -Update
  const outOfStep = Boolean(VERSION && piVersion && piVersion !== VERSION);
  // a newer release found by the daily check on the Raspberry Pi (hub-update.sh check-version)
  const installed = piVersion ?? VERSION;
  const latest = content?.latest;
  const available = latest && isNewer(latest.version, installed) ? latest : null;
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div className="footer-project">
          <p className="footer-name">
            raspberry hub
            {VERSION && (REPO && COMMIT ? (
              // the exact source the site was built from
              <a className="footer-version" href={`${REPO}/tree/${COMMIT}`} target="_blank" rel="noopener noreferrer"
                title={`commit ${COMMIT}`}>
                v{VERSION} · {COMMIT}
                <span className="sr-only">{t.common.opensInNewTab}</span>
              </a>
            ) : (
              <span className="footer-version">v{VERSION}</span>
            ))}
          </p>
          <p>{t.footer.about}</p>
          {BUILT && <p className="footer-small">{t.footer.built(longDate(BUILT, locale))}</p>}
          {available && (
            <div className="footer-update">
              <p>
                <PartyPopper size={16} aria-hidden="true" />
                <span>{t.footer.newVersion(available.version)}</span>
              </p>
              <div className="footer-update-actions">
                {available.url && (
                  <a href={available.url} target="_blank" rel="noopener noreferrer">
                    {t.footer.whatsNew}
                    <span className="sr-only">{t.common.opensInNewTab}</span>
                  </a>
                )}
                {REPO && isNewMajor(available.version, installed) && (
                  <a href={`${REPO}/blob/main/docs/upgrading.md`} target="_blank" rel="noopener noreferrer">
                    {t.footer.readFirst}
                    <span className="sr-only">{t.common.opensInNewTab}</span>
                  </a>
                )}
                <button type="button" className="button"
                  onClick={() => {
                    const open = () => setUpgrade({ version: available.version, installed });
                    if (authenticated) open();
                    else openLogin(open);
                  }}>
                  {t.footer.update}
                </button>
              </div>
            </div>
          )}
          {upgrade && (
            <UpgradeDialog open onClose={() => setUpgrade(null)} version={upgrade.version} installed={upgrade.installed} />
          )}
          {outOfStep && piVersion && (
            <p className="footer-warning">
              <TriangleAlert size={16} aria-hidden="true" />
              <span>{t.footer.versionMismatch(VERSION, piVersion)} <code>.\deploy.ps1 -Update</code></span>
            </p>
          )}
        </div>
        <ul className="footer-links">
          {REPO && (
            <li>
              <a href={REPO} target="_blank" rel="noopener noreferrer">
                <GitBranch size={17} aria-hidden="true" />
                <span>{ON_GITHUB ? t.footer.sourceOnGitHub(REPO_NAME) : t.footer.source}</span>
                <span className="sr-only">{t.common.opensInNewTab}</span>
              </a>
            </li>
          )}
          {ON_GITHUB && (
            <li>
              <a href={`${REPO}/issues/new/choose`} target="_blank" rel="noopener noreferrer">
                <Bug size={17} aria-hidden="true" />
                <span>{t.footer.reportProblem}</span>
                <span className="sr-only">{t.common.opensInNewTab}</span>
              </a>
            </li>
          )}
          {LICENSE && (
            <li>
              {REPO ? (
                <a href={`${REPO}/blob/main/LICENSE`} target="_blank" rel="noopener noreferrer">
                  <Scale size={17} aria-hidden="true" />
                  <span>{t.footer.license(LICENSE)}</span>
                  <span className="sr-only">{t.common.opensInNewTab}</span>
                </a>
              ) : (
                <span className="footer-item">
                  <Scale size={17} aria-hidden="true" />
                  <span>{t.footer.license(LICENSE)}</span>
                </span>
              )}
            </li>
          )}
          <li>
            <a href="/ca.crt" download="home-ca.crt">
              <Download size={17} aria-hidden="true" />
              <span>{t.footer.homeCa}</span>
            </a>
          </li>
        </ul>
      </div>
      <p className="footer-sources">
        {t.footer.sourcesBeforeLink}
        <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>
        {t.footer.sourcesAfterLink}
      </p>
    </footer>
  );
}
