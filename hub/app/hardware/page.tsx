import { Board } from "@/components/Board";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { NetworkAndStorage } from "@/components/NetworkAndStorage";
import { HardwareAlerts, Trends } from "@/components/Trends";
import { PageTitle } from "@/lib/i18n";


export default function Hardware() {
  return (
    <>
      <PageTitle page="hardware" />
      <Header title="Hardware" back />
      <main className="page">
        <HardwareAlerts />
        <div className="hardware-board">
          <Board orientation="auto" />
        </div>
        <NetworkAndStorage />
        <Trends />
      </main>
      <Footer />
    </>
  );
}
