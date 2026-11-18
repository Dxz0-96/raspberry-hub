import type { Metadata } from "next";
import { CaricaMappa } from "@/components/CaricaMappa";

export const metadata: Metadata = { title: "Mappe" };

export default function Mappe() {
  return <CaricaMappa />;
}
