/**
 * The Big Reveal — the signature moment of the game.
 *
 * Stage "suspects": the answer card takes centre stage under a spotlight, a
 * mystery silhouette wobbles, and the accused players appear with vote counts
 * (who-voted-for-whom is not shown yet, so the author can't be deduced).
 *
 * Stage "author": the silhouette flips into the real author, guessers drop in
 * under the suspect they picked — glowing green if right, fading if fooled —
 * and points fly up. All of this is pure presentation of server data: the host
 * advancing simply re-renders the next state, so animations can be skipped at
 * any time and never affect scoring.
 */
import { motion } from "framer-motion";
import { useEffect } from "react";
import { POINTS } from "../../../../shared/constants";
import type { ClientView, PlayerPublic } from "../../../../shared/views";
import { AnimatedNumber } from "../../components/AnimatedNumber";
import { Avatar, MysteryAvatar } from "../../components/Avatar";
import { burstConfetti } from "../../lib/effects";

export function RevealScene({ view }: { view: ClientView }) {
  const round = view.round!;
  const rv = round.reveal!;
  const card = rv.current;
  const byId = new Map(view.players.map((p) => [p.id, p]));
  const author = card.authorId ? byId.get(card.authorId) : undefined;
  const authorStage = rv.stage === "author";

  // Columns: everyone accused, plus the real author once revealed (even if nobody guessed them).
  const columnIds = card.suspects.map((s) => s.playerId);
  if (author && !columnIds.includes(author.id)) columnIds.push(author.id);
  const votes = new Map(card.suspects.map((s) => [s.playerId, s.count]));

  useEffect(() => {
    if (authorStage && card.fooledIds && card.fooledIds.length >= 2) burstConfetti("small");
  }, [authorStage, card.responseId, card.fooledIds]);

  const len = card.text.length;
  const font = len > 100 ? "text-5xl" : len > 50 ? "text-6xl" : "text-7xl";

  return (
    <div className="absolute inset-0" data-testid="tv-reveal" data-stage={rv.stage} data-index={rv.index}>
      {/* Darken the room + spotlight */}
      <motion.div className="absolute inset-0 bg-black" initial={{ opacity: 0 }} animate={{ opacity: authorStage ? 0.6 : 0.45 }} transition={{ duration: 0.8 }} />
      <div className="spotlight absolute inset-0" />

      <div className="absolute inset-x-0 top-32 flex flex-col items-center gap-2 text-center">
        <p className="font-display text-3xl uppercase tracking-[0.3em] text-pop-cyan" data-testid="tv-reveal-progress">
          Answer {rv.index + 1} of {rv.total}
        </p>
        <p className="max-w-[1500px] truncate font-display text-3xl text-cream/60">{round.prompt.text}</p>
      </div>

      <div className="absolute inset-x-0 top-[230px] flex items-center justify-center gap-14 px-20">
        {/* Mystery → author */}
        <div className="relative flex h-[300px] w-[300px] items-center justify-center" style={{ perspective: 900 }}>
            {author ? (
              <motion.div
                key="author"
                initial={{ rotateY: 90, scale: 0.4 }}
                animate={{ rotateY: 0, scale: 1 }}
                transition={{ type: "spring", stiffness: 120, damping: 11, delay: 0.15 }}
                className="flex flex-col items-center"
              >
                <div className="rounded-full bg-pop-yellow/20 p-3 shadow-glow ring-8 ring-pop-yellow">
                  <Avatar index={author.avatar} size={240} />
                </div>
              </motion.div>
            ) : (
              <motion.div key="mystery" transition={{ duration: 0.25 }} className="motion-safe:animate-wobble">
                <MysteryAvatar size={250} />
              </motion.div>
            )}
        </div>

        <motion.div
          key={card.responseId}
          initial={{ scale: 0.5, opacity: 0, y: 120 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 110, damping: 14 }}
          className="relative flex h-[330px] w-[1150px] items-center justify-center rounded-[44px] bg-cream px-16 text-ink shadow-[0_0_80px_10px_rgba(255,210,63,0.35)]"
        >
          <span className="absolute -left-6 -top-6 flex h-20 w-20 items-center justify-center rounded-3xl bg-pop-pink font-display text-5xl font-bold text-white shadow-pop-sm">
            {card.label}
          </span>
          <p className={`break-words text-center font-display font-semibold leading-snug text-balance ${font}`} data-testid="tv-reveal-text">
            {card.text}
          </p>
        </motion.div>
      </div>

      {/* Headline */}
      <div className="absolute inset-x-0 top-[570px] flex justify-center">
          {author ? (
            <motion.div
              key="it-was"
              initial={{ scale: 0.3, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 200, damping: 12, delay: 0.35 }}
              className="flex items-center gap-6 rounded-full bg-pop-yellow px-12 py-3 font-display text-6xl font-bold text-ink shadow-pop"
              data-testid="tv-reveal-author"
            >
              It was {author.name}!
              {card.authorPoints! > 0 ? (
                <span className="rounded-full bg-ink px-6 py-1 text-4xl text-pop-green">
                  Fooled {card.fooledIds!.length} · +{card.authorPoints}
                </span>
              ) : card.guesses!.length > 0 ? (
                <span className="rounded-full bg-ink px-6 py-1 text-4xl text-pop-pink">Totally exposed!</span>
              ) : null}
            </motion.div>
          ) : (
            <motion.p key="who" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="font-display text-6xl font-bold motion-safe:animate-pulse">
              {card.totalGuesses === 0 ? "Nobody made a guess…" : "Who said that?!"}
            </motion.p>
          )}
      </div>

      {/* Suspects + guessers */}
      <div className="absolute inset-x-0 top-[680px] flex justify-center gap-10 px-16">
        {columnIds.map((sid, i) => (
          <SuspectColumn
            key={sid}
            suspect={byId.get(sid)}
            votes={votes.get(sid) ?? 0}
            isAuthor={!!author && sid === author.id}
            authorStage={authorStage}
            guessers={(card.guesses ?? []).filter((g) => g.guessedId === sid).map((g) => byId.get(g.guesserId)).filter(Boolean) as PlayerPublic[]}
            delay={0.15 * i}
          />
        ))}
      </div>

      <ScoreStrip players={view.players} highlight={author?.id} />
    </div>
  );
}

function SuspectColumn({
  suspect,
  votes,
  isAuthor,
  authorStage,
  guessers,
  delay,
}: {
  suspect: PlayerPublic | undefined;
  votes: number;
  isAuthor: boolean;
  authorStage: boolean;
  guessers: PlayerPublic[];
  delay: number;
}) {
  if (!suspect) return null;
  const faded = authorStage && !isAuthor;
  return (
    <motion.div
      initial={{ y: 80, opacity: 0 }}
      animate={{ y: 0, opacity: faded ? 0.45 : 1, scale: authorStage && isAuthor ? 1.08 : 1 }}
      transition={{ delay: authorStage ? 0.3 : delay, type: "spring", stiffness: 160, damping: 14 }}
      className={`flex min-w-[170px] flex-col items-center gap-2 rounded-[32px] px-4 pb-3 pt-4 ${authorStage && isAuthor ? "bg-pop-green/25 ring-4 ring-pop-green" : "bg-white/10"}`}
      data-testid="tv-suspect"
    >
      <div className="relative">
        <Avatar index={suspect.avatar} size={110} />
        {votes > 0 && (
          <span className="absolute -right-3 -top-2 flex h-12 min-w-12 items-center justify-center rounded-full bg-pop-pink px-2 font-display text-3xl font-bold text-white shadow-pop-sm">
            ×{votes}
          </span>
        )}
      </div>
      <span className="max-w-[170px] truncate font-display text-3xl">{suspect.name}</span>
      {authorStage && (
        <div className="flex max-w-[260px] flex-wrap justify-center gap-2">
          {guessers.map((g, i) => (
            <motion.div
              key={g.id}
              initial={{ y: -40, opacity: 0, scale: 0.4 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              transition={{ delay: 0.7 + i * 0.12, type: "spring", stiffness: 220, damping: 13 }}
              className={`relative flex flex-col items-center rounded-2xl px-1 ${isAuthor ? "shadow-glow-green" : "grayscale"}`}
              title={g.name}
              data-testid={isAuthor ? "tv-correct-guesser" : "tv-wrong-guesser"}
            >
              <Avatar index={g.avatar} size={72} />
              <span className="max-w-[110px] truncate font-display text-2xl">{g.name}</span>
              <span className={`absolute -right-1 -top-1 flex h-7 w-7 items-center justify-center rounded-full font-bold ${isAuthor ? "bg-pop-green text-ink" : "bg-pop-red text-white"}`}>
                {isAuthor ? "✓" : "✕"}
              </span>
              {isAuthor && (
                <motion.span
                  initial={{ y: 0, opacity: 0 }}
                  animate={{ y: -70, opacity: [0, 1, 1, 0] }}
                  transition={{ delay: 1.2 + i * 0.12, duration: 1.6 }}
                  className="pointer-events-none absolute top-0 font-display text-3xl font-bold text-pop-green"
                >
                  +{POINTS.correctGuess}
                </motion.span>
              )}
            </motion.div>
          ))}
        </div>
      )}
    </motion.div>
  );
}

function ScoreStrip({ players, highlight }: { players: PlayerPublic[]; highlight?: string }) {
  return (
    <div className="absolute inset-x-0 bottom-0 flex justify-center gap-4 bg-black/40 px-10 py-4" data-testid="tv-score-strip">
      {players.map((p) => (
        <div key={p.id} className={`flex items-center gap-2 rounded-full px-3 py-1 ${p.id === highlight ? "bg-pop-yellow/25" : ""}`}>
          <Avatar index={p.avatar} size={44} />
          <span className="max-w-[120px] truncate font-display text-2xl">{p.name}</span>
          <AnimatedNumber value={p.score} className="font-display text-2xl font-bold text-pop-yellow" />
        </div>
      ))}
    </div>
  );
}
