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

export default function TermsPage() {
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
          <h1 className="text-4xl font-extrabold text-gray-900 mb-2">Terms and Conditions</h1>
          <p className="text-sm text-gray-400">Last updated: May 2025</p>
          <p className="text-base text-gray-500 mt-3">
            By accessing or using RankPulse, you agree to be bound by these Terms and Conditions. Please read them carefully.
          </p>
        </div>

        <div className="space-y-8 divide-y divide-gray-100">
          <Section title="1. Platform Overview">
            <p>
              RankPulse is an educational platform operated by RankPulse (individual proprietor), providing mock tests, question bank practice, and performance analysis for competitive exam students in India.
            </p>
          </Section>

          <Section title="2. Eligibility">
            <p className="pt-4">
              You must be at least 13 years of age to register on RankPulse. By creating an account, you represent that the information you provide is accurate and complete.
            </p>
          </Section>

          <Section title="3. Account Approval">
            <p className="pt-4">
              Student accounts require approval by a teacher or administrator before access to tests and the question bank is granted. This approval may be withdrawn at any time at the discretion of the platform administration.
            </p>
          </Section>

          <Section title="4. Acceptable Use">
            <p className="pt-4">You agree not to:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Share your account credentials with others</li>
              <li>Copy, reproduce, or redistribute platform content (questions, tests, analysis) without permission</li>
              <li>Attempt to reverse-engineer, hack, or disrupt the platform</li>
              <li>Upload or share offensive, illegal, or misleading content</li>
              <li>Use the platform for any commercial purpose without written consent</li>
            </ul>
          </Section>

          <Section title="5. Paid Features">
            <p className="pt-4">
              Certain features on RankPulse (such as Question Bank access or Tests access) may require a one-time or recurring payment. Payments are processed securely via our payment provider. By purchasing, you agree to the payment terms shown at checkout.
            </p>
            <p>All prices are inclusive of applicable taxes unless stated otherwise. Pricing may change with advance notice.</p>
          </Section>

          <Section title="6. Intellectual Property">
            <p className="pt-4">
              All content on RankPulse — including questions, explanations, test structures, and interface design — is the property of RankPulse. You are granted a personal, non-transferable licence to use the platform for your own exam preparation only.
            </p>
          </Section>

          <Section title="7. Limitation of Liability">
            <p className="pt-4">
              RankPulse provides preparation tools and analysis but does not guarantee exam success. The platform is provided "as is" and we make no warranties about uninterrupted availability. We are not liable for indirect, incidental, or consequential damages arising from platform use.
            </p>
          </Section>

          <Section title="8. Suspension & Termination">
            <p className="pt-4">
              We reserve the right to suspend or terminate accounts that violate these terms, misuse the platform, or engage in fraudulent activity. In such cases, paid access may be revoked without refund.
            </p>
          </Section>

          <Section title="9. Governing Law">
            <p className="pt-4">
              These Terms are governed by the laws of India. Any disputes shall be subject to the exclusive jurisdiction of courts in Bhubaneswar, Odisha.
            </p>
          </Section>

          <Section title="10. Changes to Terms">
            <p className="pt-4">
              We may revise these Terms at any time. Material changes will be communicated via email or an in-platform notice. Continued use after changes constitutes acceptance.
            </p>
          </Section>

          <Section title="11. Contact">
            <p className="pt-4">
              For questions about these Terms:<br />
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
            <Link href="/privacy-policy" className="hover:text-orange-600 transition-colors">Privacy Policy</Link>
            <Link href="/refund-policy" className="hover:text-orange-600 transition-colors">Refund Policy</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
