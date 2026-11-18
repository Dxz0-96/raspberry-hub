import { MessagePage } from "@/components/MessagePage";


// Caddy shows this page when a service behind the hub is switched off or not responding.
export default function Unavailable() {
  return <MessagePage page="unavailable" />;
}
