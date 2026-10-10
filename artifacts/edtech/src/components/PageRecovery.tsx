import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from "react";
import { recoverChunkLoad } from "@/lib/page-recovery";

export function PageLoading() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), 15_000);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <div role="status" aria-live="polite" className="flex min-h-[40vh] flex-col items-center justify-center gap-4 p-6 text-center text-foreground">
      <span aria-hidden="true" className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-orange-500 motion-reduce:animate-none" />
      <p>{slow ? "Taking longer than usual. Check your connection and try again." : "Loading your page…"}</p>
      {slow ? <ReloadButton /> : null}
    </div>
  );
}

function ReloadButton() {
  return <button type="button" onClick={() => window.location.reload()} className="rounded-lg bg-orange-500 px-5 py-2 font-medium text-white hover:bg-orange-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500">Reload page</button>;
}

export class PageErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("RankPulse page failed", error, info.componentStack);
    recoverChunkLoad(error);
  }

  componentDidUpdate(previous: Readonly<{ children: ReactNode; resetKey?: string }>) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="flex min-h-[50vh] flex-col items-center justify-center gap-4 bg-background p-6 text-center text-foreground">
        <h1 className="text-xl font-semibold">This page couldn’t load</h1>
        <p className="max-w-md text-muted-foreground">Please reload to open this page again.</p>
        <ReloadButton />
      </div>
    );
  }
}
