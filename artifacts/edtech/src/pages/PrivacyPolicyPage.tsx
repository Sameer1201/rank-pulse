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

export default function PrivacyPolicyPage() {
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
          <h1 className="text-4xl font-extrabold text-gray-900 mb-2">Privacy Policy</h1>
          <p className="text-sm text-gray-400">Last updated: May 2025</p>
          <p className="text-base text-gray-500 mt-3">
            This Privacy Policy explains how RankPulse collects, uses, and protects your personal information.
          </p>
        </div>

        <div className="space-y-8 divide-y divide-gray-100">
          <Section title="1. Information We Collect">
            <p>We collect information you provide when registering or using RankPulse, including:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Name, username, and email address</li>
              <li>Phone number (if provided)</li>
              <li>Academic details such as exam target, board, and class level</li>
              <li>Usage data — tests attempted, questions answered, scores, and time spent</li>
              <li>Payment details processed securely through our payment provider (we do not store card or UPI data)</li>
            </ul>
          </Section>

          <Section title="2. How We Use Your Information">
            <p className="pt-4">Your data is used to:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Provide and improve the RankPulse platform and its features</li>
              <li>Manage your account and send access-related communications</li>
              <li>Process payments and send receipts or billing notifications</li>
              <li>Send important service updates (not marketing without consent)</li>
              <li>Analyse usage patterns to improve platform quality</li>
            </ul>
          </Section>

          <Section title="3. Data Sharing">
            <p className="pt-4">We do not sell, rent, or trade your personal data. We share data only with trusted third-party service providers strictly necessary to operate the platform:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>A secure payment processor — for handling transactions (we do not store card or UPI details)</li>
              <li>An email delivery service — for transactional emails such as account approvals and receipts</li>
              <li>An authentication service — for secure sign-in and password reset</li>
            </ul>
            <p>These providers have their own privacy policies and are bound by their respective data protection obligations.</p>
          </Section>

          <Section title="4. Data Storage & Security">
            <p className="pt-4">
              Your data is stored on secure cloud servers. We use industry-standard measures including encrypted passwords, HTTPS, and session-based authentication. No security system is completely foolproof, but we take reasonable steps to protect your data.
            </p>
          </Section>

          <Section title="5. Cookies">
            <p className="pt-4">
              RankPulse uses session cookies to keep you logged in and to remember preferences. We do not use third-party tracking or advertising cookies.
            </p>
          </Section>

          <Section title="6. Your Rights">
            <p className="pt-4">You may request to:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Access the personal data we hold about you</li>
              <li>Correct inaccurate information</li>
              <li>Delete your account and associated data</li>
            </ul>
            <p>To exercise any of these rights, email us at <a href="mailto:Rankpulsee@gmail.com" className="text-orange-600 hover:underline">Rankpulsee@gmail.com</a>.</p>
          </Section>

          <Section title="7. Children's Privacy">
            <p className="pt-4">
              RankPulse is intended for students aged 15 and above. We do not knowingly collect personal data from children under 13. If you believe a child has registered without parental consent, contact us immediately.
            </p>
          </Section>

          <Section title="8. Changes to This Policy">
            <p className="pt-4">
              We may update this Privacy Policy occasionally. Changes will be posted on this page with an updated date. Continued use of the platform after changes constitutes acceptance.
            </p>
          </Section>

          <Section title="9. Contact">
            <p className="pt-4">
              For privacy-related questions, contact:<br />
              <strong>RankPulse</strong><br />
              Bhubaneswar, Odisha<br />
              Email: <a href="mailto:Rankpulsee@gmail.com" className="text-orange-600 hover:underline">Rankpulsee@gmail.com</a>
            </p>
          </Section>
        </div>
      </main>

      <footer className="border-t border-gray-100 bg-gray-50 py-8 mt-10">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 text-center">
          <p className="text-sm text-gray-400">© {new Date().getFullYear()} RankPulse</p>
          <div className="mt-2 flex flex-wrap justify-center gap-4 text-xs text-gray-400">
            <Link href="/about" className="hover:text-orange-600 transition-colors">About Us</Link>
            <Link href="/contact" className="hover:text-orange-600 transition-colors">Contact</Link>
            <Link href="/terms" className="hover:text-orange-600 transition-colors">Terms & Conditions</Link>
            <Link href="/refund-policy" className="hover:text-orange-600 transition-colors">Refund Policy</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
