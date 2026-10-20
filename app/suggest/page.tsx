import { redirect } from "next/navigation";

// Suggestions now live in Tonight; old links and home-screen shortcuts land there.
export default function Suggest() {
  redirect("/tonight");
}
