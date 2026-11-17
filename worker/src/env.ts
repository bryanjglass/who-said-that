export interface Env {
  ROOMS: DurableObjectNamespace;
  /** Comma-separated list of allowed browser origins, or "*" (default). */
  ALLOWED_ORIGINS?: string;
}
