// app/draw/page.tsx
// Cette page n'a plus de raison d'exister — le flux passe par /profile
// On redirige proprement plutôt que de laisser une surface d'attaque inutile

import { redirect } from "next/navigation";

export default function DrawIndexPage() {
  redirect("/profile");
}