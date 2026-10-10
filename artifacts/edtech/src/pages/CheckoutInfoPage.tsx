import { Link, useLocation } from "wouter";
import { BrandLogo } from "@/components/ui/brand-logo";
import { ArrowLeft, ArrowRight, BookOpen, CheckCircle2, ClipboardList, CreditCard, Lock, Shield } from "lucide-react";

const plans = [
  {
    icon: <BookOpen className="h-5 w-5" />,
    name: "Question Bank Access",
    desc: "Full access to the chapter-wise question bank, weak-area tracking, and review bucket.",
    feature: "question-bank",
  },
  {
    icon: <ClipboardList className="h-5 w-5" />,
    name: "Tests Access",
    desc: "Unlimited timed mock tests with full-screen exam mode and post-test analysis.",
    feature: "tests",
  },
];

const steps = [
  { step: "01", label: "Create account", desc: "Sign up and complete your student profile." },
  { step: "02", label: "Get approved", desc: "A teacher reviews and approves your account." },
  { step: "03", label: "Unlock feature", desc: "Go to the feature you want and tap Unlock." },
  { step: "04", label: "Pay securely", desc: "One-time payment via secure checkout — UPI, card, netbanking accepted." },
  { step: "05", label: "Instant access", desc: "Feature unlocked immediately after payment confirmation." },
];

export default function CheckoutInfoPage() {
  const [, setLocation] = useLocation();

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
          <p className="text-xs font-bold uppercase tracking-[0.24em] text-orange-600 mb-3">Pricing & Payment</p>
          <h1 className="text-4xl font-extrabold text-gray-900 mb-4">How Payment Works</h1>
          <p className="text-lg text-gray-500 leading-relaxed">
            RankPulse offers one-time feature unlocks — no subscriptions, no hidden fees. Pay once, use the feature as long as your account is active.
          </p>
        </div>

        <div className="space-y-8">
          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-4">Available Features</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {plans.map((plan) => (
                <div key={plan.name} className="rounded-2xl border border-gray-100 bg-gray-50 p-5">
                  <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-orange-100 text-orange-600">
                    {plan.icon}
                  </div>
                  <h3 className="text-base font-bold text-gray-900 mb-1">{plan.name}</h3>
                  <p className="text-sm text-gray-500">{plan.desc}</p>
                  <p className="text-xs text-orange-600 font-semibold mt-3">Pricing shown at checkout after login</p>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-5">How to Purchase</h2>
            <div className="space-y-3">
              {steps.map((s) => (
                <div key={s.step} className="flex items-start gap-4 rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-orange-100 text-xs font-bold text-orange-700">
                    {s.step}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{s.label}</p>
                    <p className="text-sm text-gray-500">{s.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-gray-100 bg-gray-50 p-6">
            <h2 className="text-base font-bold text-gray-900 mb-4 flex items-center gap-2">
              <Shield className="h-4 w-4 text-orange-500" /> Secure Payment
            </h2>
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                { icon: <Lock className="h-4 w-4" />, text: "256-bit SSL encryption" },
                { icon: <CreditCard className="h-4 w-4" />, text: "UPI, Card, Netbanking" },
                { icon: <CheckCircle2 className="h-4 w-4" />, text: "Instant access on payment" },
              ].map((item) => (
                <div key={item.text} className="flex items-center gap-2 rounded-xl bg-white border border-gray-100 px-3 py-2.5">
                  <span className="text-orange-500">{item.icon}</span>
                  <span className="text-xs font-medium text-gray-700">{item.text}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-4">
              We do not store your card or UPI details. All payment data is handled by our secure payment processor, which is RBI-authorised and PCI-DSS compliant.
            </p>
          </section>

          <section className="rounded-2xl border border-orange-100 bg-orange-50 p-6">
            <p className="text-sm font-semibold text-gray-900 mb-1">Ready to get started?</p>
            <p className="text-sm text-gray-600 mb-4">
              Create your free account first, get approved by your teacher, then unlock the features you need.
            </p>
            <div className="flex gap-3 flex-wrap">
              <button
                type="button"
                onClick={() => setLocation("/register")}
                className="flex items-center gap-2 rounded-xl bg-orange-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-orange-600 transition-colors"
              >
                Create Free Account <ArrowRight className="h-4 w-4" />
              </button>
              <Link href="/refund-policy" className="flex items-center rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-600 hover:border-orange-200 hover:text-orange-600 transition-colors">
                Refund Policy
              </Link>
            </div>
          </section>
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
            <Link href="/refund-policy" className="hover:text-orange-600 transition-colors">Refund Policy</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
