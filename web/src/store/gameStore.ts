/**
 * Client state (Zustand). Holds only what the server sent this client — the
 * server is authoritative, so there is no client-side game logic beyond
 * presentation and optimistic "saving…" indicators.
 */
import { create } from "zustand";
import type { Action } from "../../../shared/protocol";
import type { ClientView, Role } from "../../../shared/views";
import { GameSocket, type ActionOutcome, type SocketStatus } from "../lib/socket";
import { storage } from "../lib/storage";

export interface Toast {
  id: number;
  kind: "error" | "info" | "success";
  text: string;
}

interface GameStore {
  code: string | null;
  role: Exclude<Role, "guest"> | null;
  status: SocketStatus;
  view: ClientView | null;
  /** serverNow - localNow at the time the latest state arrived. */
  clockOffset: number;
  playerId: string | null;
  seatInvalid: boolean;
  toasts: Toast[];
  connect: (code: string, role: Exclude<Role, "guest">) => void;
  disconnect: () => void;
  send: (action: Action, opts?: { quiet?: boolean }) => Promise<ActionOutcome>;
  toast: (kind: Toast["kind"], text: string) => void;
  dismissToast: (id: number) => void;
  forgetSeat: () => void;
}

let socket: GameSocket | null = null;
let toastSeq = 0;

export const useGame = create<GameStore>((set, get) => ({
  code: null,
  role: null,
  status: "connecting",
  view: null,
  clockOffset: 0,
  playerId: null,
  seatInvalid: false,
  toasts: [],

  connect: (code, role) => {
    socket?.close();
    set({ code, role, status: "connecting", view: null, playerId: null, seatInvalid: false });
    socket = new GameSocket({
      code,
      role,
      getToken: () => (role === "host" ? (storage.hostToken(code) ?? undefined) : role === "player" ? storage.seat(code)?.token : undefined),
      onStatus: (status) => set({ status }),
      onMessage: (msg) => {
        switch (msg.type) {
          case "state":
            set({ view: msg.view, clockOffset: msg.view.serverNow - Date.now() });
            break;
          case "welcome":
            set({ playerId: msg.playerId });
            break;
          case "joined":
            storage.setSeat(code, { token: msg.token, playerId: msg.playerId });
            set({ playerId: msg.playerId, seatInvalid: false });
            break;
          case "error":
            if (msg.code === "invalid_token" && role === "player") {
              storage.setSeat(code, null);
              set({ seatInvalid: true, playerId: null });
            } else if (msg.code === "invalid_token" && role === "host") {
              set({ status: "notFound" });
            }
            break;
          case "kicked":
            storage.setSeat(code, null);
            break;
        }
      },
    });
    socket.connect();
  },

  disconnect: () => {
    socket?.close();
    socket = null;
  },

  send: async (action, opts) => {
    if (!socket) return { ok: false, code: "offline", message: "Not connected" };
    const outcome = await socket.send(action);
    if (!outcome.ok && !opts?.quiet && outcome.code !== "stale") {
      get().toast("error", outcome.message ?? "Something went wrong");
    }
    return outcome;
  },

  toast: (kind, text) => {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts.slice(-2), { id, kind, text }] }));
    window.setTimeout(() => get().dismissToast(id), 3500);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  forgetSeat: () => {
    const code = get().code;
    if (code) storage.setSeat(code, null);
    set({ playerId: null });
    socket?.rehello();
  },
}));

/** Current server time estimate. */
export function serverNow(offset: number) {
  return Date.now() + offset;
}
