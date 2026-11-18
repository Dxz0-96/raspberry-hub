import { Board, CompactBoard } from "@/components/Board";
import { BoardLink } from "@/components/BoardLink";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { NetworkAndStorage } from "@/components/NetworkAndStorage";
import { Services } from "@/components/Services";
import { TrafficFlow } from "@/components/TrafficFlow";
import { HardwareAlerts, Trends } from "@/components/Trends";
import { PageTitle } from "@/lib/i18n";

export default function Home() {
  return (
    <>
      <PageTitle page={null} />
      <Header />
      <main className="page">
        <HardwareAlerts />
        <div className="home-grid">
          <div className="home-board">
            <div className="wide-only">
              <Board cable />
            </div>
            <BoardLink>
              <CompactBoard />
            </BoardLink>
          </div>
          <Services />
          <TrafficFlow />
        </div>
        <NetworkAndStorage />
        <Trends />
      </main>
      <Footer />
    </>
  );
}
