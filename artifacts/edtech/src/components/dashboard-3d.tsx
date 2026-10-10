import type { CSSProperties, ReactNode } from "react";
import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function DashboardScene({
  children,
  accent = "from-transparent via-transparent to-transparent",
  className = "",
}: {
  children: ReactNode;
  accent?: string;
  className?: string;
}) {
  return (
    <div className={`relative rounded-[1.5rem] ${className}`}>
      <div className={`pointer-events-none absolute inset-0 rounded-[1.5rem] bg-gradient-to-br ${accent} opacity-100`} />
      <div className="relative z-10 rounded-[1.5rem] border border-[#E5E7EB] bg-transparent p-0 md:p-0">
        {children}
      </div>
    </div>
  );
}

export function TiltCard({
  children,
  className = "",
  glare = true,
}: {
  children: ReactNode;
  className?: string;
  glare?: boolean;
}) {
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const rotateX = useSpring(useTransform(mouseY, [-0.5, 0.5], [2, -2]), { stiffness: 150, damping: 22 });
  const rotateY = useSpring(useTransform(mouseX, [-0.5, 0.5], [-2, 2]), { stiffness: 150, damping: 22 });
  const glareX = useTransform(mouseX, [-0.5, 0.5], ["20%", "80%"]);
  const glareY = useTransform(mouseY, [-0.5, 0.5], ["20%", "80%"]);

  return (
    <motion.div
      className={`relative transform-gpu ${className}`}
      style={{ rotateX, rotateY, transformStyle: "preserve-3d" }}
      whileHover={{ y: -1 }}
      transition={{ type: "spring", stiffness: 180, damping: 20 }}
      onMouseMove={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width - 0.5;
        const y = (event.clientY - rect.top) / rect.height - 0.5;
        mouseX.set(clamp(x, -0.5, 0.5));
        mouseY.set(clamp(y, -0.5, 0.5));
      }}
      onMouseLeave={() => {
        mouseX.set(0);
        mouseY.set(0);
      }}
    >
      {glare && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[inherit] opacity-0 transition-opacity duration-300 group-hover:opacity-100"
          style={{
            background: "radial-gradient(circle at var(--gx) var(--gy), rgba(255,255,255,0.18), transparent 35%)",
            "--gx": glareX,
            "--gy": glareY,
          } as CSSProperties}
        />
      )}
      {children}
    </motion.div>
  );
}

export function HoloGrid({
  title,
  subtitle,
  children,
  className = "",
}: {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`relative overflow-hidden rounded-3xl border border-[#E5E7EB] bg-white shadow-sm ${className}`}>
      {(title || subtitle) && (
        <div className="relative z-10 border-b border-[#E5E7EB] px-5 py-4">
          {title && <h2 className="text-sm font-semibold tracking-[0.18em] text-[#111827] uppercase">{title}</h2>}
          {subtitle && <p className="mt-1 text-xs text-[#6B7280]">{subtitle}</p>}
        </div>
      )}
      <div className="relative z-10 p-5">{children}</div>
    </div>
  );
}
