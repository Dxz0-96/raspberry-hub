"use client";

import { Bug, Download, GitBranch, Scale } from "lucide-react";
import { longDate } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

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
