import { Component, type ErrorInfo, type ReactNode } from "react";

// App-wide error boundary. Without this, any error thrown during render blanks
// the entire app to a white screen. This catches the crash, keeps the page
// usable (reload to recover), and surfaces the error text so a screenshot is
// enough to diagnose the root cause. Self-contained: the fallback uses no hooks,
// context or providers, so it renders even if those are what crashed.
interface Props { children: ReactNode }
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep the full stack in the console for diagnosis / future remote logging.
    console.error("[SkalaUp] render crash caught by ErrorBoundary:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-foreground">Algo deu errado</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            A tela encontrou um erro inesperado. Toque em recarregar para continuar.
            Se acontecer de novo, tire um print desta mensagem e nos envie.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 inline-flex items-center justify-center rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Recarregar / Reload
          </button>
          <pre className="mt-4 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 text-left text-[11px] text-muted-foreground">
            {error.message || String(error)}
          </pre>
        </div>
      </div>
    );
  }
}
