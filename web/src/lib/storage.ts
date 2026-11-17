/** localStorage wrappers that never throw (private mode, blocked storage, etc). */
function read<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function write(key: string, value: unknown) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export interface PlayerSeat {
  token: string;
  playerId: string;
}

export const storage = {
  hostToken: (code: string) => read<string>(`wst:host:${code}`),
  setHostToken: (code: string, token: string) => write(`wst:host:${code}`, token),
  seat: (code: string) => read<PlayerSeat>(`wst:seat:${code}`),
  setSeat: (code: string, seat: PlayerSeat | null) => write(`wst:seat:${code}`, seat),
  profile: () => read<{ name: string; avatar: number }>("wst:profile"),
  setProfile: (p: { name: string; avatar: number }) => write("wst:profile", p),
  sound: () => read<boolean>("wst:sound") ?? false,
  setSound: (on: boolean) => write("wst:sound", on),
};
