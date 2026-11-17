import { LayoutGroup, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { CATEGORY_LABELS, LIMITS } from "../../../../shared/constants";
import type { ClientView, PlayerPublic, ResponseCard, StandingRow } from "../../../../shared/views";
import { AnimatedNumber } from "../../components/AnimatedNumber";
import { Avatar, MysteryAvatar } from "../../components/Avatar";
import { QRCode } from "../../components/QRCode";
import { TimerRing } from "../../components/Timer";
import { TvStage } from "../../components/TvStage";
import { Logo, Spinner } from "../../components/ui";
import { displayJoinHost, joinUrl } from "../../lib/config";
import { burstConfetti } from "../../lib/effects";
import { setSoundEnabled, sfx } from "../../lib/sound";
import { storage } from "../../lib/storage";
import { useGame } from "../../store/gameStore";
import { RevealScene } from "./RevealScene";

export function TvApp({ code }: { code: string }) {
  const connect = useGame((s) => s.connect);
  const disconnect = useGame((s) => s.disconnect);
  const view = useGame((s) => s.view);
  const status = useGame((s) => s.status);
  const [sound, setSound] = useState(storage.sound());

  useEffect(() => {
    connect(code, "tv");
    document.title = `Who Said That? · ${code}`;
    return () => disconnect();
  }, [code, connect, disconnect]);

  useEffect(() => setSoundEnabled(sound), [sound]);
  useSoundCues(view);

  return (
    <TvStage>
      <div className="bg-party absolute inset-0" data-testid="tv-app" data-phase={view?.phase ?? "loading"}>
        {status === "notFound" ? (
          <div className="flex h-full flex-col items-center justify-center gap-8">
            <Logo size="lg" />
            <p className="font-display text-5xl">Room {code} doesn't exist (or has closed).</p>
          </div>
        ) : !view ? (
          <div className="flex h-full items-center justify-center scale-150"><Spinner label="Connecting to the game…" /></div>
        ) : (
          <TvScreen view={view} />
        )}
        {view && status !== "open" && status !== "notFound" && (
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 rounded-full bg-pop-orange px-8 py-3 font-display text-3xl text-ink" data-testid="reconnecting">
            Reconnecting…
          </div>
        )}
        <button
          onClick={() => {
            storage.setSound(!sound);
            setSound(!sound);
          }}
          className="absolute left-[300px] top-9 rounded-full bg-black/30 px-4 py-2 font-display text-xl text-cream/60 hover:text-cream"
          aria-label={sound ? "Mute sound" : "Enable sound"}
        >
          {sound ? "🔊 Sound on" : "🔇 Sound off"}
        </button>
      </div>
    </TvStage>
  );
}

function useSoundCues(view: ClientView | null) {
  const prev = useRef<{ phase?: string; stage?: string; idx?: number; players?: number }>({});
  useEffect(() => {
    if (!view) return;
    const p = prev.current;
    const stage = view.round?.reveal?.stage;
    const idx = view.round?.reveal?.index;
    if (p.phase && p.phase !== view.phase) {
      if (view.phase === "gameOver") {
        sfx.fanfare();
        burstConfetti("big");
      } else sfx.whoosh();
    }
    if (view.phase === "reveal" && (stage !== p.stage || idx !== p.idx)) {
      if (stage === "suspects") sfx.drumroll();
      else sfx.reveal();
    }
    if (view.phase === "lobby" && p.players !== undefined && view.players.length > p.players) sfx.join();
    prev.current = { phase: view.phase, stage, idx, players: view.players.length };
  }, [view]);
}

function TvHeader({ view }: { view: ClientView }) {
  return (
    <div className="absolute inset-x-0 top-0 flex items-center justify-between px-14 py-8">
      <Logo size="sm" />
      <div className="flex items-center gap-6 font-display text-3xl">
        {view.round && (
          <span className="rounded-full bg-white/10 px-6 py-2" data-testid="tv-round">
            Round {view.round.number} <span className="text-cream/50">of {view.round.total}</span>
          </span>
        )}
        <span className="rounded-full bg-white/10 px-6 py-2 tracking-[0.2em]">
          <span className="text-cream/50 tracking-normal">Room </span>
          <span className="text-pop-yellow">{view.roomCode}</span>
        </span>
      </div>
      {view.paused && (
        <div className="absolute left-1/2 top-24 -translate-x-1/2 rounded-full bg-pop-orange px-10 py-3 font-display text-4xl text-ink shadow-pop" data-testid="tv-paused">
          ❚❚ Paused
        </div>
      )}
    </div>
  );
}

function TvScreen({ view }: { view: ClientView }) {
  const key = `${view.gameNumber}-${view.phase}-${view.round?.number ?? 0}-${view.round?.prompt.id ?? ""}`;
  return (
    <>
      <TvHeader view={view} />
        <motion.div
          key={key}
          className="absolute inset-0"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
        >
          {view.phase === "lobby" && <TvLobby view={view} />}
          {view.phase === "prompt" && <TvPrompt view={view} />}
          {view.phase === "submission" && <TvSubmission view={view} />}
          {view.phase === "guessing" && <TvGuessing view={view} />}
          {view.phase === "reveal" && <RevealScene view={view} />}
          {view.phase === "scoreboard" && <TvScoreboard view={view} />}
          {view.phase === "gameOver" && <TvFinal view={view} />}
        </motion.div>
    </>
  );
}

// ---------------------------------------------------------------------------

function TvLobby({ view }: { view: ClientView }) {
  const slots = Array.from({ length: LIMITS.maxPlayers }, (_, i) => view.players[i]);
  return (
    <div className="flex h-full items-center gap-16 px-24 pt-16">
      <div className="flex w-[640px] flex-col items-center gap-8">
        <QRCode value={joinUrl(view.roomCode)} size={420} className="shadow-2xl" />
        <div className="text-center font-display">
          <p className="text-4xl text-cream/80">Scan, or go to</p>
          <p className="mt-2 text-4xl font-semibold text-cream">{displayJoinHost()}</p>
          <p className="mt-4 text-4xl text-cream/80">and enter code</p>
          <p className="mt-2 text-[9rem] font-bold leading-none tracking-[0.15em] text-pop-yellow" data-testid="tv-room-code">
            {view.roomCode}
          </p>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-8">
        <Logo size="xl" />
        <p className="mt-6 font-display text-4xl text-cream/80">
          {view.players.length < LIMITS.minPlayers
            ? `Waiting for players… need at least ${LIMITS.minPlayers}`
            : `${view.players.length} players ready! Waiting for the host to start…`}
        </p>
        <div className="grid grid-cols-5 gap-6" data-testid="tv-lobby-players">
            {slots.map((p, i) =>
              p ? (
                <motion.div
                  key={p.id}
                  initial={{ scale: 0, rotate: -20 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ type: "spring", stiffness: 260, damping: 14 }}
                  className="flex flex-col items-center gap-2"
                >
                  <Avatar index={p.avatar} size={150} className="motion-safe:animate-floaty drop-shadow-xl" />
                  <span className={`max-w-[200px] truncate font-display text-3xl ${p.connected ? "" : "opacity-40"}`}>{p.name}</span>
                </motion.div>
              ) : (
                <div key={`empty-${i}`} className="flex flex-col items-center gap-2 opacity-20">
                  <div className="h-[150px] w-[150px] rounded-full border-4 border-dashed border-cream/50" />
                  <span className="font-display text-3xl">&nbsp;</span>
                </div>
              ),
            )}
        </div>
      </div>
    </div>
  );
}

function PromptBubble({ text, big = true }: { text: string; big?: boolean }) {
  const len = text.length;
  const size = big ? (len > 80 ? "text-7xl" : "text-8xl") : len > 80 ? "text-4xl" : "text-5xl";
  return (
    <div className={`speech-bubble rounded-[48px] bg-cream text-ink shadow-pop ${big ? "px-20 py-16" : "px-12 py-8"}`}>
      <p className={`font-display font-semibold leading-tight text-balance ${size}`} data-testid="tv-prompt">{text}</p>
    </div>
  );
}

function TvPrompt({ view }: { view: ClientView }) {
  const round = view.round!;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-12 px-40">
      <motion.div
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 140, damping: 12 }}
        className="flex flex-col items-center gap-6"
      >
        <span className="rounded-full bg-pop-pink px-8 py-2 font-display text-4xl text-white">
          {CATEGORY_LABELS[round.prompt.category]}
        </span>
        <PromptBubble text={round.prompt.text} />
      </motion.div>
      <div className="mt-6 flex items-center gap-8">
        <TimerRing timer={view.timer} size={150} />
        <p className="font-display text-5xl text-cream/80">Get your phones ready…</p>
      </div>
    </div>
  );
}

function PlayerProgress({ players, doneIds, doneLabel }: { players: PlayerPublic[]; doneIds: string[]; doneLabel: string }) {
  return (
    <div className="flex flex-wrap justify-center gap-8">
      {players.map((p) => {
        const done = doneIds.includes(p.id);
        return (
          <div key={p.id} className="flex flex-col items-center gap-2">
            <div className="relative">
              <motion.div animate={done ? { scale: [1, 1.2, 1] } : {}} transition={{ duration: 0.4 }}>
                <Avatar index={p.avatar} size={120} className={done ? "" : "opacity-40 grayscale"} />
              </motion.div>
              {done && (
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="absolute -right-2 -top-2 flex h-12 w-12 items-center justify-center rounded-full bg-pop-green font-display text-3xl text-ink shadow-pop-sm"
                  aria-label={doneLabel}
                >
                  ✓
                </motion.span>
              )}
            </div>
            <span className={`max-w-[160px] truncate font-display text-2xl ${done ? "" : "text-cream/50"}`}>{p.name}</span>
          </div>
        );
      })}
    </div>
  );
}

function TvSubmission({ view }: { view: ClientView }) {
  const round = view.round!;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-14 px-32 pt-10">
      <PromptBubble text={round.prompt.text} />
      <div className="flex items-center gap-16">
        <TimerRing timer={view.timer} size={220} testId="tv-timer" />
        <div className="font-display">
          <p className="text-7xl font-bold" data-testid="tv-submitted-count">
            {round.submittedIds.length} <span className="text-cream/50">of {view.players.length}</span>
          </p>
          <p className="text-4xl text-cream/70">answers received</p>
        </div>
      </div>
      <PlayerProgress players={view.players} doneIds={round.submittedIds} doneLabel="Answered" />
    </div>
  );
}

const CARD_TINTS = ["#FFF7E6", "#E8F7FF", "#FFEAF3", "#EFFFE8", "#F3ECFF", "#FFF2DF"];

function AnswerCard({ card, index, size = "md" }: { card: ResponseCard; index: number; size?: "md" | "lg" }) {
  const len = card.text.length;
  const font = size === "lg" ? (len > 100 ? "text-5xl" : len > 50 ? "text-6xl" : "text-7xl") : len > 110 ? "text-[30px]" : len > 70 ? "text-[36px]" : len > 35 ? "text-[42px]" : "text-[50px]";
  return (
    <motion.div
      layout
      initial={{ scale: 0.7, opacity: 0, rotate: index % 2 ? 3 : -3 }}
      animate={{ scale: 1, opacity: 1, rotate: index % 2 ? 1 : -1 }}
      transition={{ delay: index * 0.08, type: "spring", stiffness: 180, damping: 16 }}
      className="relative flex h-full flex-col rounded-[36px] p-8 text-ink shadow-pop"
      style={{ background: CARD_TINTS[index % CARD_TINTS.length] }}
      data-testid="tv-answer-card"
    >
      <span className="absolute -left-4 -top-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-pop-pink font-display text-4xl font-bold text-white shadow-pop-sm">
        {card.label}
      </span>
      <MysteryAvatar size={56} className="absolute -bottom-3 -right-3" />
      {/* Plain text rendering: React escapes everything — answers can never inject HTML. */}
      <p className={`m-auto break-words text-center font-display font-semibold leading-snug text-balance ${font}`}>{card.text}</p>
    </motion.div>
  );
}

function TvGuessing({ view }: { view: ClientView }) {
  const round = view.round!;
  const responses = round.responses ?? [];
  const perPage = LIMITS.tvCardsPerPage;
  const pages = Math.max(1, Math.ceil(responses.length / perPage));
  const [page, setPage] = useState(0);
  useEffect(() => {
    if (pages <= 1) return;
    const id = window.setInterval(() => setPage((p) => (p + 1) % pages), 9000);
    return () => clearInterval(id);
  }, [pages]);
  const shown = responses.slice(page * perPage, page * perPage + perPage);
  const cols = shown.length <= 4 ? 2 : 3;
  return (
    <div className="flex h-full flex-col px-20 pb-10 pt-32">
      <div className="mb-8 flex items-center gap-10">
        <p className="flex-1 font-display text-5xl font-semibold leading-tight text-balance">{round.prompt.text}</p>
        <div className="flex items-center gap-6">
          <div className="text-right font-display">
            <p className="text-6xl font-bold" data-testid="tv-locked-count">
              {round.lockedIds.length}<span className="text-cream/50">/{view.players.length}</span>
            </p>
            <p className="text-3xl text-cream/70">locked in</p>
          </div>
          <TimerRing timer={view.timer} size={160} testId="tv-timer" />
        </div>
      </div>
        <motion.div
          key={page}
          initial={{ opacity: 0, x: 60 }}
          animate={{ opacity: 1, x: 0 }}
          className="grid flex-1 gap-10"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridAutoRows: "1fr" }}
        >
          {shown.map((r, i) => (
            <AnswerCard key={r.id} card={r} index={page * perPage + i} />
          ))}
        </motion.div>
      <div className="mt-6 flex items-center justify-between font-display text-3xl text-cream/70">
        <span>📱 Who wrote each answer? Make your guesses on your phone!</span>
        {pages > 1 && (
          <span data-testid="tv-page">
            Page {page + 1} of {pages} · answers {page * perPage + 1}–{Math.min(responses.length, (page + 1) * perPage)}
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function RankMove({ row }: { row: StandingRow }) {
  if (row.previousRank === null || row.previousRank === row.rank) return <span className="w-14 text-center text-3xl text-cream/30">–</span>;
  const up = row.rank < row.previousRank;
  return (
    <span className={`w-14 text-center font-display text-3xl ${up ? "text-pop-green" : "text-pop-red"}`}>
      {up ? "▲" : "▼"}{Math.abs(row.previousRank - row.rank)}
    </span>
  );
}

function Leaderboard({ rows, highlight = [] }: { rows: StandingRow[]; highlight?: string[] }) {
  const [order, setOrder] = useState<StandingRow[]>(() =>
    [...rows].sort((a, b) => (a.previousRank ?? a.rank) - (b.previousRank ?? b.rank)),
  );
  useEffect(() => {
    // Show previous order first, then animate into the new ranking.
    const id = window.setTimeout(() => setOrder(rows), 900);
    return () => clearTimeout(id);
  }, [rows]);
  const rowH = rows.length > 7 ? 64 : 84;
  return (
    <LayoutGroup>
      <ol className="flex flex-col gap-3" data-testid="tv-standings">
        {order.map((r) => (
          <motion.li
            layout
            key={r.playerId}
            transition={{ type: "spring", stiffness: 120, damping: 18 }}
            className={`flex items-center gap-6 rounded-3xl px-6 ${highlight.includes(r.playerId) ? "bg-pop-yellow/25 ring-4 ring-pop-yellow" : "bg-white/10"}`}
            style={{ height: rowH }}
            data-testid="tv-standing-row"
            data-name={r.name}
            data-score={r.score}
            data-rank={r.rank}
          >
            <span className="w-16 font-display text-4xl font-bold text-cream/70">#{r.rank}</span>
            <Avatar index={r.avatar} size={rowH - 12} />
            <span className="flex-1 truncate font-display text-4xl">{r.name}</span>
            <RankMove row={r} />
            {r.roundPoints > 0 && (
              <motion.span initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.4 }} className="font-display text-3xl text-pop-green">
                +{r.roundPoints.toLocaleString()}
              </motion.span>
            )}
            <AnimatedNumber value={r.score} className="w-48 text-right font-display text-5xl font-bold text-pop-yellow" />
          </motion.li>
        ))}
      </ol>
    </LayoutGroup>
  );
}

const HIGHLIGHT_EMOJI: Record<string, string> = { mostMysterious: "🕶️", mindReader: "🔮", totallyExposed: "🙈" };

function TvScoreboard({ view }: { view: ClientView }) {
  const sb = view.scoreboard!;
  const byId = new Map(view.players.map((p) => [p.id, p]));
  return (
    <div className="flex h-full gap-14 px-20 pb-16 pt-36">
      <div className="flex flex-1 flex-col gap-6">
        <h1 className="font-display text-7xl font-bold">
          Round {sb.number} <span className="text-pop-yellow">Results</span>
        </h1>
        {sb.skipped ? (
          <p className="rounded-3xl bg-pop-orange/20 p-8 font-display text-4xl" data-testid="tv-round-skipped">
            Not enough answers came in this round — no points awarded. On to the next one!
          </p>
        ) : null}
        <Leaderboard rows={sb.standings} />
      </div>
      {sb.highlights.length > 0 && (
        <div className="flex w-[600px] flex-col gap-6 pt-28">
          {sb.highlights.map((h, i) => (
            <motion.div
              key={h.kind}
              initial={{ x: 120, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 1.2 + i * 0.4, type: "spring" }}
              className="rounded-[32px] bg-ink-700 p-6 shadow-pop"
            >
              <p className="font-display text-4xl font-bold text-pop-cyan">{HIGHLIGHT_EMOJI[h.kind]} {h.title}</p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                {h.playerIds.map((id) => (
                  <span key={id} className="flex items-center gap-2 font-display text-3xl">
                    <Avatar index={byId.get(id)?.avatar ?? 0} size={56} /> {byId.get(id)?.name}
                  </span>
                ))}
              </div>
              <p className="mt-2 text-2xl text-cream/70">{h.description}</p>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}

function TvFinal({ view }: { view: ClientView }) {
  const final = view.final!;
  const byId = new Map(view.players.map((p) => [p.id, p]));
  const winners = final.winnerIds.map((id) => byId.get(id)!).filter(Boolean);
  useEffect(() => {
    burstConfetti("big");
  }, []);
  const awards = final.awards.filter((a) => a.id !== "champion");
  return (
    <div className="spotlight flex h-full flex-col items-center px-20 pb-12 pt-32">
      <motion.p initial={{ y: -40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="font-display text-6xl text-cream/80">
        {winners.length > 1 ? "It's a tie! Your champions are…" : "And the winner is…"}
      </motion.p>
      <div className="mt-6 flex items-end gap-16" data-testid="tv-winners">
        {winners.map((w, i) => (
          <motion.div
            key={w.id}
            initial={{ scale: 0, rotate: -15 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ delay: 0.8 + i * 0.3, type: "spring", stiffness: 120, damping: 10 }}
            className="flex flex-col items-center"
          >
            <span className="text-8xl motion-safe:animate-wobble">👑</span>
            <Avatar index={w.avatar} size={winners.length > 2 ? 160 : 230} className="drop-shadow-2xl" />
            <span className="mt-2 font-display text-7xl font-bold text-pop-yellow">{w.name}</span>
            <span className="font-display text-4xl">{w.score.toLocaleString()} pts</span>
          </motion.div>
        ))}
      </div>
      <div className="mt-10 flex w-full flex-1 gap-12">
        <div className="flex-1">
          <Leaderboard rows={final.standings} highlight={final.winnerIds} />
        </div>
        <div className="grid w-[760px] grid-cols-2 content-start gap-4">
          {awards.map((a, i) => (
            <motion.div
              key={a.id}
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 1.6 + i * 0.25 }}
              className="rounded-3xl bg-ink-700 p-5 shadow-pop"
              data-testid="tv-award"
            >
              <p className="font-display text-3xl font-bold text-pop-cyan">{a.emoji} {a.title}</p>
              <p className="mt-1 truncate font-display text-3xl">{a.playerIds.map((id) => byId.get(id)?.name).join(" & ")}</p>
              <p className="text-xl text-cream/60">{a.description}</p>
            </motion.div>
          ))}
        </div>
      </div>
      <p className="mt-6 font-display text-3xl text-cream/60">Rematch? The host can start a new game with the same players.</p>
    </div>
  );
}
