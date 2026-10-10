import { motion } from "framer-motion";

const pearlDots = [
  { x: 0, y: -74, delay: 0, size: 9, color: "#2563eb" },
  { x: 62, y: -38, delay: 0.18, size: 7, color: "#7c3aed" },
  { x: 62, y: 38, delay: 0.36, size: 8, color: "#06b6d4" },
  { x: 0, y: 74, delay: 0.54, size: 6, color: "#f59e0b" },
  { x: -62, y: 38, delay: 0.72, size: 8, color: "#ec4899" },
  { x: -62, y: -38, delay: 0.9, size: 7, color: "#10b981" },
];

export function PremiumWhiteLoader({ progress = 0 }: { progress?: number }) {
  const progressDegrees = Math.max(8, Math.min(360, progress * 3.6));

  return (
    <div className="premium-white-loader relative flex h-[340px] w-full items-center justify-center overflow-visible bg-transparent">
      <motion.div
        className="absolute h-64 w-64 rounded-full bg-[radial-gradient(circle,rgba(37,99,235,0.08)_0%,rgba(124,58,237,0.04)_42%,rgba(255,255,255,0)_72%)] blur-3xl"
        animate={{ scale: [0.96, 1.06, 0.96], opacity: [0.32, 0.62, 0.32] }}
        transition={{ duration: 3.8, repeat: Infinity, ease: "easeInOut" }}
      />

      <div className="relative flex h-56 w-56 items-center justify-center">
        <motion.div
          className="absolute h-52 w-52 rounded-full border border-white/60 bg-white/20 shadow-[inset_0_0_28px_rgba(255,255,255,0.28)] backdrop-blur-[2px] dark:border-slate-600/80 dark:bg-slate-800/30 dark:shadow-[inset_0_0_28px_rgba(148,163,184,0.12)]"
          animate={{ scale: [0.92, 1.05, 0.92], opacity: [0.24, 0.52, 0.24] }}
          transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="absolute h-40 w-40 rounded-full border border-slate-200/70 dark:border-slate-600/80"
          animate={{ rotate: 360 }}
          transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
        >
          <div className="absolute left-1/2 top-[-5px] h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-blue-600 shadow-[0_0_20px_rgba(37,99,235,0.6)]" />
        </motion.div>
        <motion.div
          className="absolute h-28 w-28 rounded-full border border-dashed border-slate-200/80 dark:border-slate-600/80"
          animate={{ rotate: -360 }}
          transition={{ duration: 13, repeat: Infinity, ease: "linear" }}
        />

        {pearlDots.map((dot) => (
          <motion.div
            key={`${dot.x}-${dot.y}`}
            className="absolute rounded-full"
            style={{
              width: dot.size,
              height: dot.size,
              backgroundColor: dot.color,
              boxShadow: `0 0 18px ${dot.color}66`,
            }}
            initial={{ x: dot.x, y: dot.y, scale: 0.5, opacity: 0.3 }}
            animate={{
              x: [dot.x, dot.x * 0.74, dot.x],
              y: [dot.y, dot.y * 0.74, dot.y],
              scale: [0.65, 1.3, 0.65],
              opacity: [0.35, 1, 0.35],
            }}
            transition={{
              duration: 1.8,
              repeat: Infinity,
              ease: "easeInOut",
              delay: dot.delay,
            }}
          />
        ))}

        <motion.div
          className="relative flex h-20 w-20 items-center justify-center overflow-hidden rounded-full bg-white/80 ring-1 ring-white/70 shadow-[0_14px_36px_rgba(15,23,42,0.10),inset_0_1px_0_rgba(255,255,255,0.82)] backdrop-blur-[3px] dark:bg-slate-900/90 dark:ring-slate-600/80 dark:shadow-[0_14px_36px_rgba(0,0,0,0.42),inset_0_1px_0_rgba(148,163,184,0.14)]"
          animate={{ y: [-3, 3, -3], scale: [1, 1.035, 1] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
        >
          <div
            className="absolute inset-[9px] rounded-full p-[2px] opacity-80 transition-all duration-300"
            style={{
              background: `conic-gradient(from -90deg, #f59e0b ${progressDegrees}deg, var(--loader-progress-track, rgba(226,232,240,0.65)) ${progressDegrees}deg)`,
            }}
          >
            <div className="h-full w-full rounded-full bg-white/90 dark:bg-slate-950/90" />
          </div>
          <motion.div
            className="absolute inset-3 rounded-full bg-[conic-gradient(from_0deg,#f59e0b,#8b5cf6,#22d3ee,#f59e0b,#ec4899,#f59e0b)] p-[2px]"
            animate={{ rotate: 360 }}
            transition={{ duration: 3.4, repeat: Infinity, ease: "linear" }}
          >
            <div className="h-full w-full rounded-full bg-white/92 dark:bg-slate-950/90" />
          </motion.div>
          <motion.div
            className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-slate-950 dark:bg-amber-300 dark:shadow-[0_0_12px_rgba(253,186,116,0.75)]"
            animate={{ scale: [0.8, 1.25, 0.8], opacity: [0.65, 1, 0.65] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
          />
        </motion.div>
      </div>
    </div>
  );
}
