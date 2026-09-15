import { redirect } from "next/navigation";

/** §2 main user flow step 1 lands the user in the product, not on a splash page. */
export default function Home() {
  redirect("/terminal");
}
