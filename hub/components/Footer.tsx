"use client";

import { Download, GitBranch, Scale } from "lucide-react";
import { longDate } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

const VERSION = process.env.NEXT_PUBLIC_VERSION ?? "";
const LICENSE = process.env.NEXT_PUBLIC_LICENSE ?? "";
const REPO = process.env.NEXT_PUBLIC_REPO ?? "";
const COMMIT = process.env.NEXT_PUBLIC_COMMIT ?? "";
const BUILT = process.env.NEXT_PUBLIC_BUILT ?? "";

/** The footer: what the hub is, version, source code and where the data comes from. */
export function Footer() {
  const { t, locale } = useI18n();
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div className="footer-project">
          <p className="footer-name">
            raspberry hub
            {VERSION && (
              <span className="footer-version" title={COMMIT ? `commit ${COMMIT}` : undefined}>
                v{VERSION}
                {COMMIT && ` · ${COMMIT}`}
              </span>
            )}
          </p>
          <p>{t.footer.about}</p>
          {BUILT && <p className="footer-small">{t.footer.built(longDate(BUILT, locale))}</p>}
        </div>
        <ul className="footer-links">
          {REPO && (
            <li>
              <a href={REPO} target="_blank" rel="noopener noreferrer">
                <GitBranch size={17} aria-hidden="true" />
                <span>{t.footer.source}</span>
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
