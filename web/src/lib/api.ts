import { SERVER_URL } from "./config";

export interface RoomInfo {
  exists: boolean;
  phase: string | null;
  players: number;
  joinable: boolean;
}

export async function createRoom(): Promise<{ code: string; hostToken: string }> {
  const res = await fetch(`${SERVER_URL}/api/rooms`, { method: "POST" });
  if (!res.ok) throw new Error(`Could not create a room (${res.status})`);
  return res.json();
}

export async function getRoomInfo(code: string): Promise<RoomInfo> {
  const res = await fetch(`${SERVER_URL}/api/rooms/${encodeURIComponent(code)}`);
  if (!res.ok) return { exists: false, phase: null, players: 0, joinable: false };
  return res.json();
}
