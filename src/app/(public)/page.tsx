"use client";

import { Home } from "@/components/views/Home";
import { useApp } from "@/context/AppContext";

export default function HomePage() {
  const { go, notify } = useApp();
  return <Home go={go} notify={notify} />;
}
