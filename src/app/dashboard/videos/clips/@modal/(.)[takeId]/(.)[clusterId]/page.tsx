"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import TakeModal from "../../../components/TakeModal";
import ClipViewerModal from "../../../components/ClipViewerModal";
import { Cluster } from "../../../lib/types";

export default function InterceptedClipViewer({
  params,
}: {
  params: Promise<{ takeId: string; clusterId: string }>;
}) {
  const router = useRouter();
  const { takeId, clusterId } = use(params);

  return (
    <>
      <TakeModal
        takeId={takeId}
        enableEscapeToClose={false}
        onClose={() => router.push("/dashboard/videos/clips")}
        onSelectCluster={(cluster: Cluster) => router.push(`/dashboard/videos/clips/${takeId}/${cluster.key}`)}
      />
      <ClipViewerModal takeId={takeId} clusterId={clusterId} onClose={() => router.back()} />
    </>
  );
}