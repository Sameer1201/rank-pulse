import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

const rawPort = process.env.PORT;
const port = rawPort ? Number(rawPort) : 5000;

const basePath = process.env.BASE_PATH ?? "/";

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  optimizeDeps: {
    include: [
      "pdfjs-dist",
      "react",
      "react-dom",
      "react-dom/client",
      "wouter",
      "@tanstack/react-query",
      "framer-motion",
      "recharts",
      "date-fns",
      "lucide-react",
      "class-variance-authority",
      "clsx",
      "tailwind-merge",
      "@radix-ui/react-dialog",
      "@radix-ui/react-select",
      "@radix-ui/react-dropdown-menu",
      "@radix-ui/react-popover",
      "@radix-ui/react-tooltip",
      "@radix-ui/react-tabs",
      "@radix-ui/react-toast",
      "@radix-ui/react-label",
      "@radix-ui/react-avatar",
      "@radix-ui/react-checkbox",
      "@radix-ui/react-switch",
      "@radix-ui/react-radio-group",
      "@radix-ui/react-scroll-area",
      "@radix-ui/react-separator",
      "@radix-ui/react-slot",
    ],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("/react/") || id.includes("/react-dom/") || id.includes("/scheduler/")) {
            return "react-vendor";
          }
          if (id.includes("/@tanstack/") || id.includes("/wouter/")) {
            return "app-vendor";
          }
          if (id.includes("/@radix-ui/") || id.includes("/class-variance-authority/") || id.includes("/tailwind-merge/")) {
            return "ui-vendor";
          }
          if (id.includes("/recharts/") || id.includes("/victory-vendor/")) {
            return "charts-vendor";
          }
          if (id.includes("/framer-motion/")) {
            return "motion-vendor";
          }
          if (id.includes("/pdfjs-dist/")) {
            return "pdf-vendor";
          }
          if (id.includes("/date-fns/") || id.includes("/lucide-react/")) {
            return "common-vendor";
          }
        },
      },
    },
  },
  server: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    warmup: {
      clientFiles: [
        "./src/main.tsx",
        "./src/App.tsx",
        "./src/components/Layout.tsx",
        "./src/pages/admin/QuestionBank.tsx",
        "./src/pages/admin/Tests.tsx",
        "./src/pages/admin/Students.tsx",
        "./src/pages/admin/TestBuilder.tsx",
        "./src/pages/admin/Analytics.tsx",
        "./src/pages/super-admin/Dashboard.tsx",
        "./src/pages/super-admin/Management.tsx",
        "./src/pages/student/Dashboard.tsx",
        "./src/pages/student/Tests.tsx",
        "./src/pages/planner/QuestionBank.tsx",
      ],
    },
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
        secure: false,
        ws: true,
      },
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
