import { CollaborativeBoard } from "@/components/collaborative-board";
import { requireUser } from "@/lib/auth";

export default async function Home() {
  const user = await requireUser();
  return <CollaborativeBoard user={user} />;
}
