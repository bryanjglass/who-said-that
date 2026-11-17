import { motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { CATEGORY_LABELS, LIMITS } from "../../../../shared/constants";
import type { ClientView, MyPrivateView } from "../../../../shared/views";
import { Avatar, AVATARS } from "../../components/Avatar";
import { TimerBar } from "../../components/Timer";
import { Button, ConnectionBanner, formatPoints, Logo, Spinner } from "../../components/ui";
import { burstConfetti } from "../../lib/effects";
import { navigate } from "../../lib/router";
import { storage } from "../../lib/storage";
import { useGame } from "../../store/gameStore";

const codePointLength = (s: string) => [...s].length;

export function PlayerApp({ code }: { code: string }) {
  const connect = useGame((s) => s.connect);
  const disconnect = useGame((s) => s.disconnect);
  const view = useGame((s) => s.view);
  const status = useGame((s) => s.status);
  const seatInvalid = useGame((s) => s.seatInvalid);

  useEffect(() => {
    connect(code, "player");
    return () => disconnect();
  }, [code, connect, disconnect]);

  let body: React.ReactNode;
  if (status === "notFound") {
    body = (
      <Centered>
        <p className="text-5xl">🤷</p>
        <h1 className="font-display text-3xl">Room {code} wasn't found</h1>
        <p className="text-cream/70">Double-check the code on the TV.</p>
        <Button onClick={() => navigate("/")}>Try another code</Button>
      </Centered>
    );
  } else if (status === "kicked") {
    body = (
      <Centered>
        <h1 className="font-display text-3xl">The host removed you from this room</h1>
        <Button onClick={() => connect(code, "player")}>Join again</Button>
      </Centered>
    );
  } else if (!view) {
    body = <Spinner label={`Connecting to room ${code}…`} />;
  } else if (!view.me) {
    body =
      view.phase === "lobby" ? (
        <JoinForm view={view} seatInvalid={seatInvalid} />
      ) : (
        <Centered>
          <Logo size="sm" />
          <h1 className="font-display text-3xl">This game has already started</h1>
          <p className="text-cream/70">
            {seatInvalid
              ? "We couldn't find your seat in this game."
              : "New players can join when the host starts a rematch from the lobby."}{" "}
            If you were playing, open this page on the same phone and browser you joined with.
          </p>
        </Centered>
      );
  } else {
    body = <PlayerGame view={view} me={view.me} />;
  }

  return (
    <main className="bg-party min-h-[100dvh] w-full overflow-x-hidden" data-testid="player-app" data-phase={view?.phase ?? "loading"}>
      <ConnectionBanner />
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-lg flex-col px-4 pb-24 pt-4">{body}</div>
    </main>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-1 flex-col items-center justify-center gap-5 text-center">{children}</div>;
}

// ---------------------------------------------------------------------------
// Joining
// ---------------------------------------------------------------------------

function JoinForm({ view, seatInvalid }: { view: ClientView; seatInvalid: boolean }) {
  const send = useGame((s) => s.send);
  const taken = new Set(view.players.map((p) => p.avatar));
  const saved = storage.profile();
  const [name, setName] = useState(saved?.name ?? "");
  const [avatar, setAvatar] = useState<number>(() => {
    if (saved && !taken.has(saved.avatar)) return saved.avatar;
    return AVATARS.findIndex((_, i) => !taken.has(i));
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const full = view.players.length >= LIMITS.maxPlayers;

  // If someone grabs our avatar first, move to a free one.
  useEffect(() => {
    if (taken.has(avatar)) setAvatar(AVATARS.findIndex((_, i) => !taken.has(i)));
  }, [view.players]); // eslint-disable-line react-hooks/exhaustive-deps

  async function join(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return setError("Please enter your name");
    setBusy(true);
    setError(null);
    const res = await send({ type: "join", name: trimmed, avatar }, { quiet: true });
    setBusy(false);
    if (!res.ok) setError(res.message ?? "Couldn't join");
    else storage.setProfile({ name: trimmed, avatar });
  }

  return (
    <form onSubmit={join} className="flex flex-col gap-5" data-testid="join-form">
      <div className="flex items-center justify-between">
        <Logo size="sm" />
        <span className="rounded-full bg-ink-700 px-3 py-1 font-display tracking-widest">{view.roomCode}</span>
      </div>
      {seatInvalid && <p className="rounded-2xl bg-pop-orange/20 p-3 text-sm">Your previous seat wasn't found — join again below.</p>}
      <label className="flex flex-col gap-2">
        <span className="font-display text-xl">Your name</span>
        <input
          value={name}
          onChange={(e) => setName([...e.target.value].slice(0, LIMITS.maxNameLength).join(""))}
          placeholder="e.g. Grandma"
          autoComplete="nickname"
          enterKeyHint="done"
          className="w-full rounded-2xl border-2 border-white/15 bg-ink-900 px-4 py-3 font-display text-2xl outline-none focus:border-pop-yellow"
          data-testid="name-input"
        />
      </label>
      <fieldset>
        <legend className="mb-2 font-display text-xl">Pick your buddy</legend>
        <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Avatar">
          {AVATARS.map((a, i) => {
            const isTaken = taken.has(i);
            return (
              <button
                type="button"
                key={a.name}
                role="radio"
                aria-checked={avatar === i}
                aria-label={`${a.name}${isTaken ? " (taken)" : ""}`}
                disabled={isTaken}
                onClick={() => setAvatar(i)}
                className={`flex aspect-square items-center justify-center rounded-2xl border-4 transition ${
                  avatar === i ? "border-pop-yellow bg-pop-yellow/15" : "border-transparent bg-ink-800"
                } ${isTaken ? "opacity-25" : "active:scale-95"}`}
                data-testid={`avatar-${i}`}
              >
                <Avatar index={i} size="80%" />
              </button>
            );
          })}
        </div>
      </fieldset>
      {error && <p className="rounded-2xl bg-pop-red/20 p-3 font-semibold text-pop-red" role="alert" data-testid="join-error">{error}</p>}
      <Button type="submit" size="lg" variant="success" disabled={busy || full || avatar < 0} data-testid="join-submit">
        {full ? "Room is full" : busy ? "Joining…" : "Join Game"}
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// In-game
// ---------------------------------------------------------------------------

function PlayerHeader({ view, me }: { view: ClientView; me: MyPrivateView }) {
  const pub = view.players.find((p) => p.id === me.id);
  return (
    <header className="mb-4 flex items-center gap-3">
      <Avatar index={me.avatar} size={48} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-xl leading-tight" data-testid="me-name">{me.name}</p>
        {view.round && <p className="text-sm text-cream/60">Round {view.round.number} of {view.round.total}</p>}
      </div>
      {view.phase !== "lobby" && pub && (
        <div className="text-right">
          <p className="font-display text-2xl text-pop-yellow tabular-nums" data-testid="me-score">{formatPoints(pub.score)}</p>
          <p className="text-xs text-cream/60">#{pub.rank} of {view.players.length}</p>
        </div>
      )}
    </header>
  );
}

function PlayerGame({ view, me }: { view: ClientView; me: MyPrivateView }) {
  const timed = view.phase === "prompt" || view.phase === "submission" || view.phase === "guessing";
  return (
    <>
      <PlayerHeader view={view} me={me} />
      {timed && <TimerBar timer={view.timer} className="mb-4" />}
      {view.paused && <p className="mb-3 rounded-2xl bg-pop-orange/20 px-3 py-2 text-center font-semibold">⏸ The host paused the game</p>}
        <motion.div
          key={`${view.phase}-${view.round?.prompt.id ?? ""}`}
          initial={{ opacity: 0, x: 30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.2 }}
          className="flex flex-1 flex-col"
        >
          {view.phase === "lobby" && <LobbyWait view={view} me={me} />}
          {view.phase === "prompt" && <PromptWait view={view} />}
          {view.phase === "submission" && <AnswerForm key={view.round!.prompt.id} view={view} me={me} />}
          {view.phase === "guessing" && <GuessBoard key={view.round!.prompt.id} view={view} me={me} />}
          {view.phase === "reveal" && <RevealPhone view={view} me={me} />}
          {view.phase === "scoreboard" && <ScorePhone view={view} me={me} />}
          {view.phase === "gameOver" && <FinalPhone view={view} me={me} />}
        </motion.div>
    </>
  );
}

function LobbyWait({ view, me }: { view: ClientView; me: MyPrivateView }) {
  const send = useGame((s) => s.send);
  const [editing, setEditing] = useState(false);
  const taken = new Set(view.players.filter((p) => p.id !== me.id).map((p) => p.avatar));
  return (
    <div className="flex flex-1 flex-col items-center gap-6 text-center" data-testid="lobby-wait">
      <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring" }}>
        <Avatar index={me.avatar} size={160} className="motion-safe:animate-floaty" />
      </motion.div>
      <div>
        <h1 className="font-display text-3xl">You're in, {me.name}!</h1>
        <p className="mt-1 text-cream/70">Look at the TV — the host will start the game soon.</p>
      </div>
      <Button variant="secondary" size="sm" onClick={() => setEditing((e) => !e)}>{editing ? "Done" : "Change buddy"}</Button>
      {editing && (
        <div className="grid w-full grid-cols-4 gap-2">
          {AVATARS.map((a, i) => (
            <button
              key={a.name}
              disabled={taken.has(i)}
              onClick={() => send({ type: "updateProfile", avatar: i })}
              className={`flex aspect-square items-center justify-center rounded-2xl border-4 ${me.avatar === i ? "border-pop-yellow" : "border-transparent bg-ink-800"} ${taken.has(i) ? "opacity-25" : ""}`}
              aria-label={a.name}
            >
              <Avatar index={i} size="80%" />
            </button>
          ))}
        </div>
      )}
      <div className="w-full rounded-3xl bg-ink-800/80 p-4">
        <p className="mb-3 font-display text-lg text-cream/70">{view.players.length} player{view.players.length === 1 ? "" : "s"} in the room</p>
        <div className="flex flex-wrap justify-center gap-3">
          {view.players.map((p) => (
            <span key={p.id} className="flex items-center gap-1 rounded-full bg-ink-900/70 py-1 pl-1 pr-3">
              <Avatar index={p.avatar} size={28} /> {p.name}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function PromptCard({ view }: { view: ClientView }) {
  const round = view.round!;
  return (
    <div className="rounded-3xl bg-cream p-5 text-ink shadow-pop">
      <p className="text-xs font-bold uppercase tracking-widest text-pop-pink">{CATEGORY_LABELS[round.prompt.category]}</p>
      <p className="mt-1 font-display text-2xl font-semibold leading-snug" data-testid="player-prompt">{round.prompt.text}</p>
    </div>
  );
}

function PromptWait({ view }: { view: ClientView }) {
  return (
    <div className="flex flex-col gap-6">
      <PromptCard view={view} />
      <p className="text-center font-display text-2xl text-cream/80">Get ready to answer… ✍️</p>
    </div>
  );
}

function AnswerForm({ view, me }: { view: ClientView; me: MyPrivateView }) {
  const send = useGame((s) => s.send);
  const [draft, setDraft] = useState(me.answer ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const length = codePointLength(draft.trim());
  const saved = me.answer !== null && draft.trim().replace(/\s+/g, " ") === me.answer;

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const text = draft.trim();
    if (!text) return setError("Type an answer first!");
    setBusy(true);
    setError(null);
    const res = await send({ type: "submitAnswer", round: view.round!.number, text }, { quiet: true });
    setBusy(false);
    if (!res.ok) setError(res.message ?? "Couldn't submit");
    else ref.current?.blur();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" data-testid="answer-form">
      <PromptCard view={view} />
      <label className="sr-only" htmlFor="answer">Your answer</label>
      <textarea
        id="answer"
        ref={ref}
        value={draft}
        onChange={(e) => setDraft([...e.target.value.replace(/\n/g, " ")].slice(0, LIMITS.maxAnswerLength).join(""))}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void submit();
          }
        }}
        rows={3}
        placeholder="Type something funny…"
        enterKeyHint="send"
        autoCapitalize="sentences"
        className="w-full resize-none rounded-2xl border-2 border-white/15 bg-ink-900 px-4 py-3 text-lg leading-snug outline-none focus:border-pop-yellow"
        data-testid="answer-input"
      />
      <div className="flex items-center justify-between text-sm">
        <span className={saved ? "font-semibold text-pop-green" : "text-cream/60"} data-testid="answer-status">
          {saved ? "✓ Answer submitted — you can still change it" : me.answer ? "Unsaved changes" : "Answers are anonymous!"}
        </span>
        <span className={length > LIMITS.maxAnswerLength - 15 ? "text-pop-orange" : "text-cream/50"}>
          {length}/{LIMITS.maxAnswerLength}
        </span>
      </div>
      {error && <p className="font-semibold text-pop-red" role="alert">{error}</p>}
      <Button type="submit" size="lg" variant={saved ? "secondary" : "primary"} disabled={busy || !draft.trim() || saved} data-testid="answer-submit">
        {busy ? "Sending…" : me.answer ? (saved ? "Submitted ✓" : "Update Answer") : "Submit Answer"}
      </Button>
      <p className="text-center text-sm text-cream/50">
        {view.round!.submittedIds.length} of {view.players.length} players have answered
      </p>
    </form>
  );
}

function GuessBoard({ view, me }: { view: ClientView; me: MyPrivateView }) {
  const send = useGame((s) => s.send);
  const round = view.round!;
  const responses = round.responses ?? [];
  const byId = useMemo(() => new Map(view.players.map((p) => [p.id, p])), [view.players]);
  const candidates = (round.authorIds ?? []).filter((id) => id !== me.id);
  const [pending, setPending] = useState<Record<string, string | null>>({});
  const [confirming, setConfirming] = useState(false);
  const [busyLock, setBusyLock] = useState(false);
  const guessable = responses.filter((r) => r.id !== me.myResponseId);
  const current = (rid: string) => (rid in pending ? pending[rid] : (me.guesses[rid] ?? null));
  const assigned = guessable.filter((r) => current(r.id)).length;
  const locked = me.locked;

  async function choose(responseId: string, authorId: string) {
    if (locked) return;
    const next = current(responseId) === authorId ? null : authorId;
    setPending((p) => ({ ...p, [responseId]: next }));
    const res = await send({ type: "setGuess", round: round.number, responseId, authorId: next });
    setPending((p) => {
      const { [responseId]: _, ...rest } = p;
      return rest;
    });
    if (!res.ok) setConfirming(false);
  }

  async function lock() {
    if (assigned < guessable.length && !confirming) return setConfirming(true);
    setBusyLock(true);
    await send({ type: "lockGuesses", round: round.number });
    setBusyLock(false);
    setConfirming(false);
  }

  return (
    <div className="flex flex-col gap-4" data-testid="guess-board">
      <p className="text-center text-sm text-cream/60">{round.prompt.text}</p>
      <p className="-mt-2 text-center font-display text-xl">Who wrote each answer?</p>
      {!me.myResponseId && (
        <p className="rounded-2xl bg-ink-700 p-3 text-center text-sm">You didn't answer this round — but you can still guess!</p>
      )}
      {responses.map((r) => {
        const mine = r.id === me.myResponseId;
        const chosen = current(r.id);
        const synced = !(r.id in pending) && (me.guesses[r.id] ?? null) === chosen;
        return (
          <div
            key={r.id}
            className={`rounded-3xl p-4 ${mine ? "border-2 border-dashed border-pop-cyan bg-ink-800/70" : "bg-cream text-ink shadow-pop-sm"}`}
            data-testid="guess-card"
            data-response-id={r.id}
            data-mine={mine ? "true" : "false"}
          >
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-pop-pink font-display text-xl font-bold text-white">{r.label}</span>
              <p className="flex-1 break-words font-display text-lg font-semibold leading-snug" data-testid="guess-text">{r.text}</p>
            </div>
            {mine ? (
              <p className="mt-2 font-display font-semibold text-pop-cyan" data-testid="your-answer">⭐ Your Answer — no guess needed</p>
            ) : (
              <>
                <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label={`Who wrote answer ${r.label}?`}>
                  {candidates.map((cid) => {
                    const p = byId.get(cid);
                    if (!p) return null;
                    const selected = chosen === cid;
                    return (
                      <button
                        key={cid}
                        role="radio"
                        aria-checked={selected}
                        disabled={locked}
                        onClick={() => choose(r.id, cid)}
                        className={`flex items-center gap-1.5 rounded-full border-2 py-1 pl-1 pr-3 text-sm font-bold transition ${
                          selected ? "border-ink bg-pop-yellow" : "border-ink/15 bg-white/70"
                        } ${locked && !selected ? "opacity-40" : ""}`}
                        data-testid="guess-option"
                        data-player-name={p.name}
                      >
                        <Avatar index={p.avatar} size={28} />
                        {p.name}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 h-4 text-xs font-semibold text-ink/60" data-testid="guess-sync">
                  {chosen ? (synced ? "✓ Saved" : "Saving…") : ""}
                </p>
              </>
            )}
          </div>
        );
      })}
      <div className="sticky bottom-3 z-10 mt-2 rounded-3xl bg-ink-800/95 p-3 shadow-pop backdrop-blur">
        {locked ? (
          <p className="py-2 text-center font-display text-xl text-pop-green" data-testid="locked-in">🔒 Locked in! Watch the TV…</p>
        ) : (
          <>
            {confirming && (
              <p className="mb-2 text-center text-sm text-pop-orange">
                {guessable.length - assigned} answer{guessable.length - assigned === 1 ? "" : "s"} still unassigned (they'll score nothing). Lock in anyway?
              </p>
            )}
            <Button size="lg" className="w-full" variant={confirming ? "danger" : "success"} onClick={lock} disabled={busyLock} data-testid="lock-in">
              {busyLock ? "Locking…" : confirming ? "Yes, lock in" : `Lock In (${assigned}/${guessable.length})`}
            </Button>
          </>
        )}
        <p className="mt-1 text-center text-xs text-cream/50">{round.lockedIds.length} of {view.players.length} locked in</p>
      </div>
    </div>
  );
}

function RevealPhone({ view, me }: { view: ClientView; me: MyPrivateView }) {
  const rv = view.round!.reveal!;
  const card = rv.current;
  const byId = new Map(view.players.map((p) => [p.id, p]));
  const mine = card.responseId === me.myResponseId;
  const myGuess = me.guesses[card.responseId];
  const author = card.authorId ? byId.get(card.authorId) : undefined;
  const correct = !!author && myGuess === author.id;

  useEffect(() => {
    if (!author) return;
    if ((mine && (card.fooledIds?.length ?? 0) > 0) || correct) burstConfetti("small");
  }, [author, mine, correct, card.fooledIds]);

  return (
    <div className="flex flex-col gap-5 text-center" data-testid="reveal-phone">
      <p className="font-display text-lg text-cream/60">Answer {rv.index + 1} of {rv.total} — watch the TV!</p>
      <div className="rounded-3xl bg-cream p-5 text-ink shadow-pop">
        <p className="font-display text-2xl font-semibold">{card.text}</p>
      </div>
      {!author ? (
        <p className="font-display text-2xl motion-safe:animate-pulse">
          {mine ? "🤫 This one's yours. Act natural…" : myGuess ? `You guessed ${byId.get(myGuess)?.name ?? "?"}…` : "Who said it?!"}
        </p>
      ) : mine ? (
        <motion.div initial={{ scale: 0.5 }} animate={{ scale: 1 }} className="rounded-3xl bg-ink-700 p-5" data-testid="reveal-outcome">
          <p className="font-display text-3xl">That's yours!</p>
          <p className="mt-1 text-xl">
            {card.fooledIds!.length > 0
              ? `You fooled ${card.fooledIds!.length} — +${card.authorPoints} points 🥸`
              : card.guesses!.length > 0
                ? "Everyone saw right through you 🙈"
                : "Nobody guessed this one"}
          </p>
        </motion.div>
      ) : (
        <motion.div
          initial={{ scale: 0.5 }}
          animate={{ scale: 1 }}
          className={`rounded-3xl p-5 ${correct ? "bg-pop-green text-ink" : "bg-ink-700"}`}
          data-testid="reveal-outcome"
        >
          <div className="flex items-center justify-center gap-3">
            <Avatar index={author.avatar} size={56} />
            <p className="font-display text-3xl">It was {author.name}!</p>
          </div>
          <p className="mt-2 text-xl font-bold">
            {correct ? "✅ You got it! +500" : myGuess ? `❌ Fooled! You guessed ${byId.get(myGuess)?.name}` : "You didn't guess this one"}
          </p>
        </motion.div>
      )}
    </div>
  );
}

function ScorePhone({ view, me }: { view: ClientView; me: MyPrivateView }) {
  const sb = view.scoreboard!;
  const row = sb.standings.find((s) => s.playerId === me.id);
  const pts = me.roundPoints;
  const mentions = sb.highlights.filter((h) => h.playerIds.includes(me.id));
  return (
    <div className="flex flex-col items-center gap-5 text-center" data-testid="score-phone">
      <h2 className="font-display text-3xl">Round {sb.number} results</h2>
      {sb.skipped && <p className="rounded-2xl bg-pop-orange/20 p-3">Not enough answers — no points this round.</p>}
      {row && (
        <div className="w-full rounded-3xl bg-ink-800 p-5">
          <p className="font-display text-6xl text-pop-yellow">#{row.rank}</p>
          <p className="text-cream/70">of {sb.standings.length}</p>
          <p className="mt-3 font-display text-3xl tabular-nums" data-testid="score-total">{formatPoints(row.score)} pts</p>
          {pts && (
            <p className="mt-2 text-lg" data-testid="round-points">
              +{formatPoints(pts.total)} this round
              <span className="block text-sm text-cream/60">
                {formatPoints(pts.guessing)} for correct guesses · {formatPoints(pts.deception)} for fooling people
              </span>
            </p>
          )}
        </div>
      )}
      {mentions.map((h) => (
        <p key={h.kind} className="rounded-full bg-pop-cyan/20 px-4 py-2 font-display text-lg">🏅 {h.title}!</p>
      ))}
      <p className="text-cream/60">Waiting for the host…</p>
    </div>
  );
}

function FinalPhone({ view, me }: { view: ClientView; me: MyPrivateView }) {
  const final = view.final!;
  const row = final.standings.find((s) => s.playerId === me.id);
  const won = final.winnerIds.includes(me.id);
  const myAwards = final.awards.filter((a) => a.playerIds.includes(me.id));
  useEffect(() => {
    if (won) burstConfetti("big");
  }, [won]);
  return (
    <div className="flex flex-col items-center gap-5 text-center" data-testid="final-phone">
      <p className="text-6xl">{won ? "👑" : "🎉"}</p>
      <h2 className="font-display text-3xl">{won ? "You won!" : "Game over!"}</h2>
      {row && (
        <div className="w-full rounded-3xl bg-ink-800 p-5">
          <p className="font-display text-5xl text-pop-yellow">#{row.rank}</p>
          <p className="mt-2 font-display text-3xl tabular-nums" data-testid="final-score">{formatPoints(row.score)} pts</p>
        </div>
      )}
      {myAwards.map((a) => (
        <p key={a.id} className="rounded-full bg-pop-cyan/20 px-4 py-2 font-display text-lg">{a.emoji} {a.title}</p>
      ))}
      <p className="text-cream/60">Waiting for the host to start a rematch…</p>
    </div>
  );
}
