import type { Metadata } from "next";
import { TaskTreeApp } from "./task-tree/task-tree-app";

export const metadata: Metadata = {
  title: "Planbranch",
  description:
    "A local, observable workspace for decomposing complex work into ordered Tasks.",
};

export default function Home() {
  return <TaskTreeApp />;
}
