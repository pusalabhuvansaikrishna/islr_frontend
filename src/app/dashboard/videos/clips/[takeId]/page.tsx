"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import TakeModal from "../components/TakeModal";
import { Cluster } from "../lib/types";

export default function TakeFallbackPage({ params }: { params: Promise<{ takeId: string }> }) {
  const router = useRouter();
  const { takeId } = use(params);

  return (
    <TakeModal
      takeId={takeId}
      onClose={() => router.push("/dashboard/videos/clips")}
      onSelectCluster={(cluster: Cluster) => router.push(`/dashboard/videos/clips/${takeId}/${cluster.key}`)}
    />
  );
}