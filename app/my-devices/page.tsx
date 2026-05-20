// app/my-devices/page.tsx
// Redirigé vers /profile (page unifiée Profil + Devices)
import { redirect } from "next/navigation";

export default function MyDevicesPage() {
  redirect("/profile");
}
