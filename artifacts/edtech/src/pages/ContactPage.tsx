import { Link } from "wouter";
import { BrandLogo } from "@/components/ui/brand-logo";
import { ArrowLeft, Mail, MapPin } from "lucide-react";

export default function ContactPage() {
  const openEmail = () => {
    const subject = encodeURIComponent("RankPulse inquiry");
    const body = encodeURIComponent("Hi RankPulse team,\n\nI need help with:\n");
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
          <p className="text-xs font-bold uppercase tracking-[0.24em] text-orange-600 mb-3">Contact Us</p>
          <h1 className="text-4xl font-extrabold text-gray-900 mb-4">Get in Touch</h1>
          <p className="text-lg text-gray-500 leading-relaxed">
            For access issues, billing queries, feedback, or anything else — reach out directly.
          </p>
        </div>

        <div className="space-y-5">
          <div className="rounded-2xl border border-gray-100 bg-gray-50 p-7">
            <h2 className="text-lg font-bold text-gray-900 mb-5">Contact Information</h2>
            <div className="space-y-4">
              <div className="flex items-start gap-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-orange-100 text-orange-600">
                  <MapPin className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900 mb-0.5">Registered Address</p>
                  <p className="text-sm text-gray-600 leading-relaxed">
                    Bhubaneswar, Odisha
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-orange-100 text-orange-600">
                  <Mail className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900 mb-0.5">Email</p>
                  <a href="mailto:Rankpulsee@gmail.com" className="text-sm text-orange-600 hover:underline">
                    Rankpulsee@gmail.com
                  </a>
                  <p className="text-xs text-gray-400 mt-0.5">We reply within 1–2 business days</p>
                </div>
              </div>

            </div>
          </div>

          <div className="rounded-2xl border border-orange-100 bg-orange-50 p-6">
            <p className="text-sm font-semibold text-gray-900 mb-1">Best way to reach us</p>
            <p className="text-sm text-gray-600 mb-4">
              Email is the fastest way to get a response. Mention your registered username or email in the message so we can look up your account quickly.
            </p>
            <button
              type="button"
              onClick={openEmail}
              className="rounded-xl bg-orange-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-orange-600 transition-colors"
            >
              Send Email
            </button>
          </div>

          <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
            <p className="text-sm font-semibold text-gray-900 mb-3">Common topics</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {["Access & login", "Billing & payment", "Refund request", "Test flow issues", "Question errors", "Feature suggestions"].map((item) => (
                <div key={item} className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-600">
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>

      <footer className="border-t border-gray-100 bg-gray-50 py-8 mt-10">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 text-center">
          <p className="text-sm text-gray-400">© {new Date().getFullYear()} RankPulse</p>
          <div className="mt-2 flex flex-wrap justify-center gap-4 text-xs text-gray-400">
            <Link href="/about" className="hover:text-orange-600 transition-colors">About Us</Link>
            <Link href="/privacy-policy" className="hover:text-orange-600 transition-colors">Privacy Policy</Link>
            <Link href="/terms" className="hover:text-orange-600 transition-colors">Terms & Conditions</Link>
            <Link href="/refund-policy" className="hover:text-orange-600 transition-colors">Refund Policy</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
