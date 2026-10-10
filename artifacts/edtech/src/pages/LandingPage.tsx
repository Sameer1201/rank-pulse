import { useRef, useEffect } from "react";
import { Link, useLocation } from "wouter";
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  CheckCircle2,
  Mail,
  MapPin,
  MessageSquare,
  ShieldCheck,
  Timer,
  Zap,
  LineChart,
} from "lucide-react";
import { motion } from "framer-motion";
import { BrandLogo } from "@/components/ui/brand-logo";
import { RankPulseLandingPreview } from "@/components/marketing/RankPulseLandingPreview";
import GateEceCountdown from "@/components/GateEceCountdown";
import { buildApiUrl } from "@/lib/api-origin";

const features = [
  {
    icon: <Timer className="h-5 w-5" />,
    iconBg: "bg-amber-100 text-amber-600",
    title: "Timed Tests",
    desc: "Full-screen mock tests with section switching, save-and-next flow, and an exam-style experience.",
  },
  {
    icon: <BookOpen className="h-5 w-5" />,
    iconBg: "bg-green-100 text-green-500",
    title: "Exam Question Bank",
    desc: "Practice by exam, subject, and chapter, then return to the exact weak areas that need another pass.",
  },
  {
    icon: <LineChart className="h-5 w-5" />,
    iconBg: "bg-orange-100 text-orange-600",
    title: "Advanced Analysis",
    desc: "Performance, time, attempt, difficulty, and question-wise analysis with visual graphs.",
  },
  {
    icon: <MessageSquare className="h-5 w-5" />,
    iconBg: "bg-emerald-100 text-emerald-600",
    title: "Review Bucket",
    desc: "Keep incorrect and unattempted questions in one clean place and revise them with solutions later.",
  },
];

export default function LandingPage() {
  const [, setLocation] = useLocation();
  const analysisRef = useRef<HTMLElement | null>(null);
  const contactRef = useRef<HTMLElement | null>(null);
  const featuresRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (sessionStorage.getItem("rp_visited")) return;
    sessionStorage.setItem("rp_visited", "1");
    fetch(buildApiUrl(`/api/visitor/ping`), { method: "POST" }).catch(() => {});
  }, []);

  const openContactEmail = () => {
    const subject = encodeURIComponent("RankPulse inquiry");
    const body = encodeURIComponent("Hi RankPulse team,\n\nI want help with:\n");
    window.location.href = `mailto:Rankpulsee@gmail.com?subject=${subject}&body=${body}`;
  };

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <motion.header
        initial={{ y: -100 }}
        animate={{ y: 0 }}
        transition={{ duration: 0.45, ease: "easeOut" }}
        className="fixed inset-x-0 top-0 z-50 border-b border-gray-100 bg-white/95 shadow-sm backdrop-blur"
      >
        <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-2.5">
            <BrandLogo
              variant="icon"
              showLabel
              className="gap-2.5"
              imageClassName="h-9 w-9"
              labelClassName="text-xl font-extrabold tracking-tight"
            />
          </Link>
          <nav className="hidden items-center gap-6 md:flex">
            <button className="text-sm font-medium text-gray-600 transition-colors hover:text-orange-600" onClick={() => featuresRef.current?.scrollIntoView({ behavior: "smooth" })}>
              Features
            </button>
            <button className="text-sm font-medium text-gray-600 transition-colors hover:text-orange-600" onClick={() => analysisRef.current?.scrollIntoView({ behavior: "smooth" })}>
              Analysis
            </button>
            <Link href="/about" className="text-sm font-medium text-gray-600 transition-colors hover:text-orange-600">About</Link>
            <button className="text-sm font-medium text-gray-600 transition-colors hover:text-orange-600" onClick={() => contactRef.current?.scrollIntoView({ behavior: "smooth" })}>
              Contact
            </button>
          </nav>
          <div className="flex items-center gap-2 sm:gap-3">
            <button
              className="rounded-md border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 transition-colors hover:border-orange-200 hover:text-orange-600 sm:px-4 sm:text-sm"
              onClick={() => setLocation("/login")}
            >
              Log In
            </button>
            <button
              className="rounded-md bg-orange-500 px-3 py-2 text-xs font-semibold text-white shadow-lg shadow-orange-500/20 transition-colors hover:bg-orange-600 sm:px-5 sm:py-2.5 sm:text-sm"
              onClick={() => setLocation("/register")}
            >
              Sign Up
            </button>
          </div>
        </div>
      </motion.header>

      <main className="w-full">
        <section
          ref={analysisRef}
          className="relative overflow-hidden pb-24 pt-32 md:pb-32 md:pt-44"
          style={{ background: "linear-gradient(135deg, #fffaf2 0%, #fff4e5 42%, #ffedd5 100%)" }}
        >
          <div className="absolute right-0 top-0 h-96 w-96 rounded-full opacity-35 blur-3xl" style={{ background: "radial-gradient(circle, rgba(249,115,22,0.32), transparent)" }} />
          <div className="absolute bottom-0 left-0 h-80 w-80 rounded-full opacity-25 blur-3xl" style={{ background: "radial-gradient(circle, rgba(245,158,11,0.26), transparent)" }} />
          <div className="relative z-10 mx-auto grid max-w-7xl gap-12 px-4 lg:grid-cols-2 lg:items-center sm:px-6 lg:px-8">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease: "easeOut" }}
              className="max-w-2xl"
            >
              <GateEceCountdown />
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-orange-200 bg-white/80 px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm">
                <ShieldCheck className="h-4 w-4 text-emerald-500" />
                Student-first exam intelligence
              </div>
              <h1 className="mb-6 text-5xl font-extrabold leading-tight tracking-tight text-slate-900 md:text-6xl lg:text-7xl">
                Don&apos;t just practice.
                <br />
                <span className="bg-gradient-to-r from-amber-500 to-orange-600 bg-clip-text text-transparent">Climb faster.</span>
              </h1>
              <p className="mb-8 max-w-xl text-lg leading-relaxed text-slate-600 md:text-xl">
                RankPulse gives serious students timed tests, a smart review bucket, structured question practice, and deep analysis in one clean workspace.
              </p>
              <div className="flex flex-col gap-4 sm:flex-row">
                <button
                  className="group flex items-center justify-center gap-2 rounded-lg px-8 py-4 text-lg font-semibold text-white transition-all"
                  style={{ background: "linear-gradient(135deg, #f59e0b, #ea580c)", boxShadow: "0 0 40px -5px rgba(249,115,22,0.45)" }}
                  onClick={() => setLocation("/register")}
                >
                  Start for Free
                  <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
                </button>
                <button
                  className="flex items-center justify-center rounded-lg border border-orange-200 bg-white/70 px-8 py-4 text-lg font-semibold text-orange-700 transition-colors hover:bg-white"
                  onClick={() => featuresRef.current?.scrollIntoView({ behavior: "smooth" })}
                >
                  Explore Features
                </button>
              </div>
              <div className="mt-10 flex flex-wrap items-center gap-6 text-sm font-medium text-slate-600">
                {["Timed tests", "Review bucket", "Detailed graphs"].map((item) => (
                  <div key={item} className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.8, delay: 0.15 }}
              className="relative"
            >
              <RankPulseLandingPreview />
            </motion.div>
          </div>
        </section>

        <section className="border-y border-gray-100 bg-white py-12">
          <div className="mx-auto grid max-w-7xl grid-cols-2 gap-8 px-4 text-center md:grid-cols-4 sm:px-6 lg:px-8">
            {[
              { label: "Students Practicing", value: "200+" },
              { label: "Questions Attempted", value: "5,000+" },
              { label: "Mock Tests", value: "300+" },
              { label: "Improvement Lift", value: "3.4x" },
            ].map((stat) => (
              <div key={stat.label} className="space-y-2">
                <div className="text-3xl font-bold text-gray-900 md:text-4xl">{stat.value}</div>
                <div className="text-sm font-medium uppercase tracking-[0.18em] text-gray-500">{stat.label}</div>
              </div>
            ))}
          </div>
        </section>

        <section id="features" ref={featuresRef} className="bg-white py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="mb-12">
              <p className="mb-3 text-xs font-bold uppercase tracking-[0.24em] text-orange-600">Core Features</p>
              <h2 className="text-3xl font-bold text-gray-900 md:text-4xl">Everything important, without clutter.</h2>
            </div>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {features.map((feature) => (
                <motion.div
                  key={feature.title}
                  initial={{ opacity: 0, y: 24 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.45 }}
                  whileHover={{ y: -4 }}
                  className="cursor-default rounded-2xl border border-gray-100 bg-white p-6 shadow-sm transition-all hover:shadow-md"
                >
                  <div className={`mb-5 flex h-10 w-10 items-center justify-center rounded-xl ${feature.iconBg}`}>
                    {feature.icon}
                  </div>
                  <h3 className="mb-2 text-base font-bold text-gray-900">{feature.title}</h3>
                  <p className="text-sm leading-relaxed text-gray-500">{feature.desc}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        <section className="overflow-hidden border-y border-gray-100 bg-gray-50 py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="mb-16 max-w-3xl text-center mx-auto">
              <p className="mb-3 text-xs font-bold uppercase tracking-[0.24em] text-orange-600">Advanced Analysis</p>
              <h2 className="mb-4 text-3xl font-bold text-gray-900 md:text-4xl">Deep insight into every attempt</h2>
              <p className="text-lg text-gray-500">
                Stop guessing what went wrong. RankPulse breaks down accuracy, time, difficulty, and question journey clearly after every test.
              </p>
            </div>
            <div className="grid gap-8 md:grid-cols-3">
              {[
                { title: "Subject-wise Accuracy", desc: "See exactly which subjects are dragging your score down." },
                { title: "Negative Marking Control", desc: "Track unforced errors and learn where to hold back." },
                { title: "Peer Comparison", desc: "Compare your sectional performance against strong attempts." },
              ].map((item, index) => (
                <motion.div
                  key={item.title}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.45, delay: index * 0.08 }}
                  className="flex items-start gap-4"
                >
                  <div className="mt-1 rounded p-1.5 text-orange-600 bg-orange-100 shrink-0">
                    <Zap className="h-5 w-5" />
                  </div>
                  <div>
                    <h4 className="text-lg font-bold text-gray-900">{item.title}</h4>
                    <p className="text-gray-500">{item.desc}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-white py-24">
          <div className="mx-auto grid max-w-7xl gap-16 px-4 lg:grid-cols-2 lg:items-center sm:px-6 lg:px-8">
            <motion.div
              initial={{ opacity: 0, x: -40 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.55 }}
              className="space-y-8"
            >
              <div>
                <h2 className="mb-4 text-3xl font-bold text-gray-900 md:text-4xl">Built for the grind</h2>
                <p className="text-lg text-gray-500">
                  Late nights, long revision loops, and repeated mock analysis. RankPulse is designed for students who actually sit and solve.
                </p>
              </div>
              <div className="space-y-4">
                <p className="text-gray-500">
                  The platform keeps your tests, weak-question review bucket, and analysis together so you can move from attempt to revision without losing context.
                </p>
                <p className="text-gray-500">
                  Build a practice habit around the exact chapters and question styles that still need work instead of random repetition.
                </p>
              </div>
              <button
                className="group flex items-center gap-2 rounded-lg px-8 py-4 text-lg font-semibold text-white transition-all hover:opacity-90"
                style={{ background: "linear-gradient(135deg, #f59e0b, #ea580c)", boxShadow: "0 0 30px -5px rgba(249,115,22,0.4)" }}
                onClick={() => setLocation("/register")}
              >
                Get Started Free
                <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
              </button>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 40 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.55 }}
              className="space-y-6 rounded-2xl border border-gray-100 bg-gray-50 p-8 shadow-lg"
            >
              <h3 className="text-xl font-bold text-gray-900">Built around student practice</h3>
              <div className="grid grid-cols-2 gap-4">
                {[
                  { name: "Mock Tests", color: "bg-amber-100 text-amber-700" },
                  { name: "Question Bank", color: "bg-green-100 text-green-700" },
                  { name: "Review Bucket", color: "bg-orange-100 text-orange-700" },
                  { name: "Deep Analysis", color: "bg-orange-100 text-orange-700" },
                  { name: "Time Tracking", color: "bg-red-100 text-red-700" },
                  { name: "Progress Graphs", color: "bg-emerald-100 text-emerald-700" },
                ].map((item) => (
                  <div key={item.name} className={`${item.color} rounded-lg px-3 py-2 text-center text-xs font-bold`}>
                    {item.name}
                  </div>
                ))}
              </div>
              <div className="border-t border-gray-200 pt-4">
                <div className="flex items-center gap-3 text-sm text-gray-500">
                  <BarChart3 className="h-5 w-5 shrink-0 text-orange-600" />
                  <span>Clean full-screen test flow, bucket-based revision, and post-test analytics in one place.</span>
                </div>
              </div>
            </motion.div>
          </div>
        </section>

        <section ref={contactRef} className="border-t border-gray-100 bg-gray-50 py-20">
          <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
            <div className="mb-10">
              <p className="text-xs font-bold uppercase tracking-[0.24em] text-orange-600 mb-2">Contact Us</p>
              <h2 className="text-3xl font-bold text-gray-900">Get in touch</h2>
            </div>
            <div className="grid gap-5 md:grid-cols-3">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4 }}
                className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm"
              >
                <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-orange-100 text-orange-600">
                  <Mail className="h-4 w-4" />
                </div>
                <p className="text-sm font-bold text-gray-900 mb-1">Email</p>
                <a href="mailto:Rankpulsee@gmail.com" className="text-sm text-orange-600 hover:underline break-all">Rankpulsee@gmail.com</a>
                <p className="text-xs text-gray-400 mt-1">Reply within 1–2 business days</p>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: 0.07 }}
                className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm"
              >
                <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-orange-100 text-orange-600">
                  <MapPin className="h-4 w-4" />
                </div>
                <p className="text-sm font-bold text-gray-900 mb-1">Address</p>
                <p className="text-sm text-gray-600 leading-relaxed">Bhubaneswar, Odisha</p>
              </motion.div>
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                className="rounded-xl bg-orange-500 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-orange-600"
                onClick={openContactEmail}
              >
                Email the Team
              </button>
              <Link href="/contact" className="rounded-xl border border-gray-200 bg-white px-5 py-2.5 text-sm font-medium text-gray-600 hover:border-orange-200 hover:text-orange-600 transition-colors">
                Full Contact Details
              </Link>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-100 bg-white py-10">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <BrandLogo variant="icon" showLabel className="gap-2 mb-3" imageClassName="h-7 w-7" labelClassName="text-base font-extrabold" />
              <p className="text-xs text-gray-400 leading-relaxed">Smart exam prep platform for competitive aspirants. Timed tests, question bank, and deep analysis.</p>
              <p className="text-xs text-gray-400 mt-2">© {new Date().getFullYear()} RankPulse</p>
            </div>

            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Platform</p>
              <div className="space-y-2">
                <button onClick={() => setLocation("/register")} className="block text-sm text-gray-500 hover:text-orange-600 transition-colors">Sign Up Free</button>
                <button onClick={() => setLocation("/login")} className="block text-sm text-gray-500 hover:text-orange-600 transition-colors">Log In</button>
                <Link href="/checkout" className="block text-sm text-gray-500 hover:text-orange-600 transition-colors">Pricing & Checkout</Link>
              </div>
            </div>

            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Company</p>
              <div className="space-y-2">
                <Link href="/about" className="block text-sm text-gray-500 hover:text-orange-600 transition-colors">About Us</Link>
                <Link href="/contact" className="block text-sm text-gray-500 hover:text-orange-600 transition-colors">Contact Us</Link>
              </div>
            </div>

            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Legal</p>
              <div className="space-y-2">
                <Link href="/privacy-policy" className="block text-sm text-gray-500 hover:text-orange-600 transition-colors">Privacy Policy</Link>
                <Link href="/terms" className="block text-sm text-gray-500 hover:text-orange-600 transition-colors">Terms & Conditions</Link>
                <Link href="/refund-policy" className="block text-sm text-gray-500 hover:text-orange-600 transition-colors">Refund / Cancellation</Link>
              </div>
            </div>
          </div>

          <div className="mt-8 border-t border-gray-100 pt-6 flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-xs text-gray-400">Operated by <span className="font-semibold text-gray-600">RankPulse</span> · Bhubaneswar, Odisha</p>
            <div className="flex flex-wrap gap-4 text-xs text-gray-400">
              <Link href="/privacy-policy" className="hover:text-orange-600 transition-colors">Privacy</Link>
              <Link href="/terms" className="hover:text-orange-600 transition-colors">Terms</Link>
              <Link href="/refund-policy" className="hover:text-orange-600 transition-colors">Refunds</Link>
              <Link href="/contact" className="hover:text-orange-600 transition-colors">Contact</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
