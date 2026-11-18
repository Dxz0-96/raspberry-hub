import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import Wikipedia from "@/components/Wikipedia";
import { PageTitle } from "@/lib/i18n";


export default function WikipediaPage() {
  return (
    <>
      <PageTitle page="wikipedia" />
      <Header title="Wikipedia" back />
      {/* search bar (under the header, as wide as the window) and content */}
      <Wikipedia />
      <Footer />
    </>
  );
}
