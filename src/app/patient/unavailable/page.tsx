import Link from "next/link";
export default function Page() {
  return (
    <main className="portal-login">
      <section className="portal-auth">
        <h1>Portal unavailable</h1>
        <p>Please contact your clinic for help with portal access.</p>
        <Link href="/patient/login">Return to sign in</Link>
      </section>
    </main>
  );
}
