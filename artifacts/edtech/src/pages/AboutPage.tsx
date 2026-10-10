import { Link } from "wouter";
import { BrandLogo } from "@/components/ui/brand-logo";
import { ArrowLeft, BookOpen, GraduationCap, Users } from "lucide-react";

export default function AboutPage() {
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
          <p className="text-xs font-bold uppercase tracking-[0.24em] text-orange-600 mb-3">About Us</p>
          <h1 className="text-4xl font-extrabold text-gray-900 mb-4">About RankPulse</h1>
          <p className="text-lg text-gray-500 leading-relaxed">
            RankPulse is an ed-tech platform built to help serious competitive exam aspirants practice smarter, analyse every attempt, and close their weak areas faster.
          </p>
        </div>

        <div className="space-y-10">
          <section className="rounded-2xl border border-gray-100 bg-gray-50 p-7">
            <h2 className="text-xl font-bold text-gray-900 mb-3">Legal Entity</h2>
            <p className="text-gray-600 leading-relaxed">
              RankPulse is owned and operated by <span className="font-semibold text-gray-900">RankPulse</span>, an individual proprietor based in Bhubaneswar, Odisha, India. The platform is not a registered company or LLP. All services are offered directly under the legal name of the proprietor.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl bg-white border border-gray-100 px-4 py-3">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Legal Name</p>
                <p className="font-semibold text-gray-900">RankPulse</p>
              </div>
              <div className="rounded-xl bg-white border border-gray-100 px-4 py-3">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Business Type</p>
                <p className="font-semibold text-gray-900">Individual Proprietorship</p>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-4">Our Mission</h2>
            <p className="text-gray-600 leading-relaxed mb-4">
              Most exam prep tools focus on content delivery. RankPulse focuses on practice quality — timed full-length tests, question-level analysis, a revision bucket for weak areas, and structured question bank practice tied to the chapters that matter.
            </p>
            <p className="text-gray-600 leading-relaxed">
              We believe that ranking improvement comes from targeted practice loops, not just consuming more content.
            </p>
          </section>

          <section className="grid gap-5 sm:grid-cols-3">
            {[
              { icon: <GraduationCap className="h-5 w-5" />, title: "Student-first", desc: "Every feature is designed from the student's preparation perspective." },
              { icon: <BookOpen className="h-5 w-5" />, title: "Quality Practice", desc: "Curated question banks tied to real exam patterns and chapter structure." },
              { icon: <Users className="h-5 w-5" />, title: "Teacher Tools", desc: "Teachers can manage students, create tests, and track performance." },
            ].map((item) => (
              <div key={item.title} className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
                <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-orange-100 text-orange-600">
                  {item.icon}
                </div>
                <h3 className="text-sm font-bold text-gray-900 mb-1">{item.title}</h3>
                <p className="text-sm text-gray-500">{item.desc}</p>
              </div>
            ))}
          </section>
        </div>
      </main>

      <footer className="border-t border-gray-100 bg-gray-50 py-8 mt-10">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 text-center">
          <p className="text-sm text-gray-400">© {new Date().getFullYear()} RankPulse</p>
          <div className="mt-2 flex flex-wrap justify-center gap-4 text-xs text-gray-400">
            <Link href="/privacy-policy" className="hover:text-orange-600 transition-colors">Privacy Policy</Link>
            <Link href="/terms" className="hover:text-orange-600 transition-colors">Terms & Conditions</Link>
            <Link href="/refund-policy" className="hover:text-orange-600 transition-colors">Refund Policy</Link>
            <Link href="/contact" className="hover:text-orange-600 transition-colors">Contact</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
