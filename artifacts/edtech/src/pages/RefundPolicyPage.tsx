import { Link } from "wouter";
import { BrandLogo } from "@/components/ui/brand-logo";
import { ArrowLeft } from "lucide-react";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-bold text-gray-900">{title}</h2>
      <div className="text-sm leading-relaxed text-gray-600 space-y-2">{children}</div>
    </section>
  );
}

export default function RefundPolicyPage() {
  const openEmail = () => {
    const subject = encodeURIComponent("Refund Request – RankPulse");
    const body = encodeURIComponent("Hi,\n\nI would like to request a refund for:\n\nOrder/Payment ID: \nReason: \nRegistered email: \n");
    window.location.href = `mailto:Rankpulsee@gmail.com?subject=${subject}&body=${body}`;
  };

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <header className="border-b border-gray-100 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/">
            <BrandLogo variant="icon" showLabel className="gap-2" imageClassName="h-8 w-8" labelClassName="text-lg font-extrabold tracking-tight" />
          </Link>
          <Link href="/" className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-orange-600 transition-colors">
            <ArrowLeft className="h-4 w-4" /> Back to Home
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="mb-10">
          <p className="text-xs font-bold uppercase tracking-[0.24em] text-orange-600 mb-3">Legal</p>
          <h1 className="text-4xl font-extrabold text-gray-900 mb-2">Refund & Cancellation Policy</h1>
          <p className="text-sm text-gray-400">Last updated: May 2025</p>
          <p className="text-base text-gray-500 mt-3">
            RankPulse is committed to fair and transparent refund handling. Please read this policy before making a purchase.
          </p>
        </div>

        <div className="space-y-8 divide-y divide-gray-100">
          <Section title="1. Digital Service Nature">
            <p>
              All purchases on RankPulse are for access to digital educational services (tests, question bank, analysis). Once access is granted and the feature is used, the service is considered delivered.
            </p>
          </Section>

          <Section title="2. Refund Eligibility">
            <p className="pt-4">You are eligible for a full refund if:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>You request a refund within <strong>7 days</strong> of payment</li>
              <li>You have not used the paid feature (no tests taken, no question bank sessions started)</li>
              <li>There was a technical error resulting in a duplicate payment</li>
              <li>The feature you paid for was not delivered due to a platform error</li>
            </ul>

            <p className="pt-2">Refunds will <strong>not</strong> be issued if:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>More than 7 days have passed since the payment date</li>
              <li>The paid feature has been actively used (tests taken, questions attempted)</li>
              <li>The refund request is made due to a change of mind after feature use</li>
              <li>The account was suspended for violating our Terms and Conditions</li>
            </ul>
          </Section>

          <Section title="3. Cancellation">
            <p className="pt-4">
              RankPulse currently offers one-time feature unlock payments (not recurring subscriptions). There is no active subscription to cancel. If a recurring subscription model is introduced in the future, this policy will be updated with cancellation terms.
            </p>
          </Section>

          <Section title="4. Duplicate Payment / Overcharge">
            <p className="pt-4">
              If your account was charged more than once for the same feature, or if a payment was deducted but access was not granted, please contact us immediately with your payment details. We will resolve the issue within 5–7 business days.
            </p>
          </Section>

          <Section title="5. Refund Process">
            <p className="pt-4">To request a refund:</p>
            <ol className="list-decimal pl-5 space-y-1">
              <li>Email us at <a href="mailto:Rankpulsee@gmail.com" className="text-orange-600 hover:underline">Rankpulsee@gmail.com</a> with subject "Refund Request – RankPulse"</li>
              <li>Include your Payment ID or Order ID (visible in your payment confirmation)</li>
              <li>Include your registered email address and reason for refund</li>
            </ol>
            <p className="pt-2">Approved refunds will be credited to the original payment method within <strong>7–10 business days</strong> depending on your bank or card issuer.</p>
          </Section>

          <Section title="6. Contact">
            <p className="pt-4">
              For refund requests or payment disputes, contact:<br />
              <strong>RankPulse</strong><br />
              Email: <a href="mailto:Rankpulsee@gmail.com" className="text-orange-600 hover:underline">Rankpulsee@gmail.com</a><br />
              Address: Bhubaneswar, Odisha
            </p>
          </Section>
        </div>

        <div className="mt-10 rounded-2xl border border-orange-100 bg-orange-50 p-6">
          <p className="text-sm font-semibold text-gray-900 mb-1">Need to request a refund?</p>
          <p className="text-sm text-gray-600 mb-4">
            Email us with your payment ID and we'll get back to you within 2 business days.
          </p>
          <button
            type="button"
            onClick={openEmail}
            className="rounded-xl bg-orange-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-orange-600 transition-colors"
          >
            Request a Refund
          </button>
        </div>
      </main>

      <footer className="border-t border-gray-100 bg-gray-50 py-8 mt-10">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 text-center">
          <p className="text-sm text-gray-400">© {new Date().getFullYear()} RankPulse</p>
          <div className="mt-2 flex flex-wrap justify-center gap-4 text-xs text-gray-400">
            <Link href="/about" className="hover:text-orange-600 transition-colors">About Us</Link>
            <Link href="/contact" className="hover:text-orange-600 transition-colors">Contact</Link>
            <Link href="/privacy-policy" className="hover:text-orange-600 transition-colors">Privacy Policy</Link>
            <Link href="/terms" className="hover:text-orange-600 transition-colors">Terms & Conditions</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
