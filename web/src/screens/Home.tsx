import { motion } from "framer-motion";
import { useState } from "react";
import { isValidRoomCode, normalizeRoomCode } from "../../../shared/constants";
import { Avatar } from "../components/Avatar";
import { Button, Logo } from "../components/ui";
import { createRoom } from "../lib/api";
import { navigate } from "../lib/router";
import { storage } from "../lib/storage";

export function Home() {
  const [code, setCode] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function host() {
    setCreating(true);
    setError(null);
    try {
      const room = await createRoom();
      storage.setHostToken(room.code, room.hostToken);
      navigate(`/host/${room.code}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create a room");
    } finally {
      setCreating(false);
    }
  }

  const normalized = normalizeRoomCode(code);
  const valid = isValidRoomCode(normalized);

  return (
    <main className="bg-party flex min-h-[100dvh] flex-col items-center justify-center gap-10 px-4 py-10">
      <div className="flex -space-x-4" aria-hidden>
        {[0, 5, 2, 8, 3].map((a, i) => (
          <motion.div
            key={a}
            initial={{ y: 30, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.08 * i, type: "spring" }}
          >
            <Avatar index={a} size={68} className="drop-shadow-lg" />
          </motion.div>
        ))}
      </div>
      <Logo size="lg" />
      <p className="max-w-md text-center text-lg text-cream/80">
        Answer silly questions in secret. Guess who wrote what. Fool your family for bonus points.
      </p>

      <div className="grid w-full max-w-3xl gap-6 md:grid-cols-2">
        <section className="rounded-3xl border-2 border-white/10 bg-ink-800/80 p-6">
          <h2 className="font-display text-2xl font-semibold">📺 Host a game</h2>
          <p className="mt-2 text-cream/70">
            Use a computer with Chrome. You'll get a TV screen to cast and a controller tab.
          </p>
          <Button size="lg" className="mt-5 w-full" onClick={host} disabled={creating} data-testid="create-room">
            {creating ? "Creating room…" : "Create a Room"}
          </Button>
          {error && <p className="mt-3 text-pop-red" role="alert">{error}</p>}
        </section>

        <form
          className="rounded-3xl border-2 border-white/10 bg-ink-800/80 p-6"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) navigate(`/play/${normalized}`);
          }}
        >
          <h2 className="font-display text-2xl font-semibold">📱 Join a game</h2>
          <label className="mt-2 block text-cream/70" htmlFor="room-code">
            Enter the 4-letter room code on the TV
          </label>
          <input
            id="room-code"
            value={code}
            onChange={(e) => setCode(normalizeRoomCode(e.target.value).slice(0, 4))}
            placeholder="ABCD"
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            inputMode="text"
            enterKeyHint="go"
            className="mt-4 w-full rounded-2xl border-2 border-white/15 bg-ink-900 px-4 py-3 text-center font-display text-4xl font-bold uppercase tracking-[0.4em] text-pop-yellow outline-none focus:border-pop-yellow"
            data-testid="join-code"
          />
          <Button type="submit" variant="success" size="lg" className="mt-4 w-full" disabled={!valid} data-testid="join-go">
            Join
          </Button>
        </form>
      </div>
      <p className="text-sm text-cream/40">Best with 4–10 players · ages 9 and up · no accounts needed</p>
    </main>
  );
}
