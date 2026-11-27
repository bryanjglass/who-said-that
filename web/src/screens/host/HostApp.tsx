import { useEffect, useMemo } from "react";
import {
  CATEGORIES,
  CATEGORY_BLURBS,
  CATEGORY_LABELS,
  GUESSING_TIMER_OPTIONS,
  LIMITS,
  ROUND_OPTIONS,
  SUBMISSION_TIMER_OPTIONS,
} from "../../../../shared/constants";
import type { ClientView, PlayerPublic } from "../../../../shared/views";
import { Avatar } from "../../components/Avatar";
import { QRCode } from "../../components/QRCode";
import { TimerBar } from "../../components/Timer";
import { Button, Card, ConnectionBanner, formatPoints, Logo, phaseLabel, Spinner } from "../../components/ui";
import { displayJoinHost, joinUrl } from "../../lib/config";
import { navigate } from "../../lib/router";
import { storage } from "../../lib/storage";
import { useGame } from "../../store/gameStore";

export function HostApp({ code }: { code: string }) {
  const connect = useGame((s) => s.connect);
  const disconnect = useGame((s) => s.disconnect);
  const status = useGame((s) => s.status);
  const view = useGame((s) => s.view);
  const hasToken = !!storage.hostToken(code);

  useEffect(() => {
    if (!hasToken) return;
    connect(code, "host");
    return () => disconnect();
  }, [code, hasToken, connect, disconnect]);

  if (!hasToken || status === "notFound") {
    return (
      <main className="bg-party flex min-h-[100dvh] flex-col items-center justify-center gap-6 p-6 text-center">
        <Logo />
        <h1 className="font-display text-3xl">This browser isn't hosting room {code}</h1>
        <p className="max-w-md text-cream/70">
          Host controls only work in the browser that created the room. You can still open the TV display or join as a player.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Button onClick={() => navigate(`/tv/${code}`)}>Open TV display</Button>
          <Button variant="success" onClick={() => navigate(`/play/${code}`)}>Join as player</Button>
          <Button variant="secondary" onClick={() => navigate("/")}>Home</Button>
        </div>
      </main>
    );
  }
  if (!view) return <main className="bg-party min-h-[100dvh]"><Spinner label="Connecting to your room…" /></main>;
  return <HostDashboard view={view} />;
}

function useHostActions(view: ClientView) {
  const send = useGame((s) => s.send);
  return useMemo(() => {
    const from = {
      phase: view.phase,
      round: view.round?.number ?? 0,
      revealIndex: view.round?.reveal?.index,
      revealStage: view.round?.reveal?.stage,
    };
    return {
      advance: () => send({ type: "advance", from }),
      start: () => send({ type: "start" }),
      pause: () => send({ type: "pause" }),
      resume: () => send({ type: "resume" }),
      skip: () =>
        view.round && send({ type: "skipPrompt", round: view.round.number, promptId: view.round.prompt.id }),
      endGame: () => send({ type: "endGame" }),
      rematch: (toLobby = false) => send({ type: "rematch", toLobby }),
      kick: (playerId: string) => send({ type: "kick", playerId }),
      configure: (config: Partial<ClientView["config"]>) => send({ type: "configure", config }),
    };
  }, [view, send]);
}

function primaryAction(view: ClientView, a: ReturnType<typeof useHostActions>): { label: string; run: () => unknown; disabled?: boolean } | null {
  const round = view.round;
  switch (view.phase) {
    case "lobby":
      return { label: "Start Game ▶", run: a.start, disabled: !view.host?.canStart };
    case "prompt":
      return { label: "Start Answering Now ▶", run: a.advance };
    case "submission":
      return { label: "End Answering Now ▶", run: a.advance };
    case "guessing":
      return { label: "End Guessing Now ▶", run: a.advance };
    case "reveal": {
      const rv = round!.reveal!;
      if (rv.stage === "suspects") return { label: "Reveal Author Now ▶", run: a.advance };
      return { label: rv.index < rv.total - 1 ? "Next Answer Now ▶" : "Show Scores Now ▶", run: a.advance };
    }
    case "scoreboard":
      return { label: round!.number >= round!.total ? "Final Results Now ▶" : "Next Round Now ▶", run: a.advance };
    case "gameOver":
      return { label: "Rematch ▶", run: () => a.rematch(false) };
  }
}

function HostDashboard({ view }: { view: ClientView }) {
  const actions = useHostActions(view);
  const primary = primaryAction(view, actions);
  // Every in-game phase runs on a server timer, so the game plays itself after Start.
  const inGame = view.phase !== "lobby" && view.phase !== "gameOver";
  const canSkipPrompt = view.phase === "prompt" || view.phase === "submission" || view.phase === "guessing";

  // Keyboard shortcuts: Space / → = primary action, P = pause/resume.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, button")) return;
      if ((e.key === " " || e.key === "ArrowRight") && primary && !primary.disabled) {
        e.preventDefault();
        void primary.run();
      } else if (e.key.toLowerCase() === "p" && inGame) {
        void (view.paused ? actions.resume() : actions.pause());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [primary, inGame, view.paused, actions]);

  const openTv = () => window.open(`#/tv/${view.roomCode}`, `wst-tv-${view.roomCode}`);

  return (
    <main className="bg-party min-h-[100dvh] p-4 lg:p-6" data-testid="host-app"
      data-phase={view.phase}
      data-round={view.round?.number ?? 0}
      data-reveal={view.round?.reveal ? `${view.round.reveal.index}:${view.round.reveal.stage}` : ""}
    >
      <ConnectionBanner />
      <header className="mb-5 flex flex-wrap items-center gap-4">
        <Logo size="sm" />
        <div className="flex items-center gap-2 rounded-2xl bg-ink-800 px-4 py-2">
          <span className="text-sm uppercase tracking-widest text-cream/60">Room</span>
          <span className="font-display text-3xl font-bold tracking-[0.2em] text-pop-yellow" data-testid="room-code">{view.roomCode}</span>
        </div>
        <span className="rounded-full bg-ink-700 px-3 py-1 font-display text-lg" data-testid="host-phase">
          {phaseLabel(view.phase)}
          {view.round && view.phase !== "lobby" && ` · Round ${view.round.number} of ${view.round.total}`}
        </span>
        <div className="ml-auto flex items-center gap-3">
          <span className={`text-sm ${view.host?.tvConnections ? "text-pop-green" : "text-cream/50"}`} data-testid="tv-status">
            {view.host?.tvConnections ? "● TV connected" : "○ TV not open"}
          </span>
          <Button variant="secondary" onClick={openTv} data-testid="open-tv">📺 Open TV Display</Button>
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
        <div className="flex flex-col gap-5">
          {/* Main control card */}
          <Card className="flex flex-col gap-4">
            {inGame && (
              <div className="flex items-center gap-4">
                <TimerBar timer={view.timer} className="flex-1" />
                {view.paused ? (
                  <Button variant="success" onClick={actions.resume} data-testid="resume">▶ Resume</Button>
                ) : (
                  <Button variant="secondary" onClick={actions.pause} data-testid="pause">❚❚ Pause</Button>
                )}
              </div>
            )}
            {inGame && (
              <p className="text-sm text-cream/60" data-testid="host-autopilot">
                ⚙️ The game runs itself from here — every step, including the reveal and the scoreboard, moves on
                by timer. Use the buttons only to pause or skip ahead.
              </p>
            )}
            <PhasePanel view={view} actions={actions} />
            <div className="flex flex-wrap items-center gap-3 border-t border-white/10 pt-4">
              {primary && (
                <Button size="xl" onClick={() => primary.run()} disabled={primary.disabled} data-testid="host-primary">
                  {primary.label}
                </Button>
              )}
              {view.phase === "gameOver" && (
                <Button size="lg" variant="secondary" onClick={() => actions.rematch(true)} data-testid="back-to-lobby">
                  Change Settings / New Players
                </Button>
              )}
              {canSkipPrompt && (
                <Button variant="secondary" onClick={() => actions.skip()} data-testid="skip-prompt">⤼ Skip Question</Button>
              )}
              {inGame && (
                <Button
                  variant="ghost"
                  className="ml-auto"
                  onClick={() => window.confirm("End the game now and show final results?") && actions.endGame()}
                  data-testid="end-game"
                >
                  End Game
                </Button>
              )}
            </div>
            {view.phase === "lobby" && (
              <p className="text-sm text-cream/60">
                Once you press Start, the whole game plays itself on timers. You can pause or skip ahead at any time.
              </p>
            )}
            {primary && <p className="text-sm text-cream/40">Tip: press Space or → for the big button, P to pause.</p>}
          </Card>
        </div>

        <aside className="flex flex-col gap-5">
          {view.phase === "lobby" && (
            <Card className="flex flex-col items-center gap-3 text-center">
              <QRCode value={joinUrl(view.roomCode)} size={200} />
              <p className="text-cream/70">
                Join at <span className="font-semibold text-cream">{displayJoinHost()}</span>
              </p>
              <a className="break-all text-xs text-cream/40 underline" href={joinUrl(view.roomCode)} target="_blank" rel="noreferrer">
                {joinUrl(view.roomCode)}
              </a>
            </Card>
          )}
          <PlayersPanel view={view} onKick={actions.kick} />
        </aside>
      </div>
    </main>
  );
}

function PlayersPanel({ view, onKick }: { view: ClientView; onKick: (id: string) => void }) {
  const round = view.round;
  const showScores = view.phase !== "lobby";
  const sorted = showScores ? [...view.players].sort((a, b) => a.rank - b.rank) : view.players;
  return (
    <Card>
      <h2 className="mb-3 flex items-baseline justify-between font-display text-xl">
        Players <span className="text-base text-cream/60" data-testid="player-count">{view.players.length} / {LIMITS.maxPlayers}</span>
      </h2>
      {view.players.length === 0 && <p className="text-cream/50">Nobody yet — scan the QR code to join!</p>}
      <ul className="flex flex-col gap-2" data-testid="host-players">
        {sorted.map((p) => (
          <li key={p.id} className="flex items-center gap-3 rounded-2xl bg-ink-900/60 px-3 py-2">
            <div className="relative">
              <Avatar index={p.avatar} size={40} />
              <span
                className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-ink-900 ${p.connected ? "bg-pop-green" : "bg-cream/30"}`}
                title={p.connected ? "Connected" : "Disconnected"}
              />
            </div>
            <span className="flex-1 truncate font-semibold">{p.name}</span>
            <PlayerStatus p={p} view={view} />
            {showScores && <span className="font-display tabular-nums text-pop-yellow">{formatPoints(p.score)}</span>}
            {view.phase === "lobby" && (
              <button
                className="rounded-lg px-2 text-cream/40 hover:bg-pop-red hover:text-white"
                onClick={() => window.confirm(`Remove ${p.name} from the room?`) && onKick(p.id)}
                aria-label={`Remove ${p.name}`}
              >
                ✕
              </button>
            )}
          </li>
        ))}
      </ul>
      {round && view.phase === "submission" && (
        <p className="mt-3 text-sm text-cream/60">{round.submittedIds.length} of {view.players.length} answers in</p>
      )}
    </Card>
  );
}

function PlayerStatus({ p, view }: { p: PlayerPublic; view: ClientView }) {
  const round = view.round;
  if (!round) return null;
  if (view.phase === "submission" || view.phase === "prompt") {
    return round.submittedIds.includes(p.id) ? <span title="Answered">✅</span> : <span className="text-cream/30" title="Thinking">✏️</span>;
  }
  if (view.phase === "guessing") {
    return round.lockedIds.includes(p.id) ? <span title="Locked in">🔒</span> : <span className="text-cream/30" title="Guessing">🤔</span>;
  }
  return null;
}

function PhasePanel({ view, actions }: { view: ClientView; actions: ReturnType<typeof useHostActions> }) {
  const round = view.round;
  switch (view.phase) {
    case "lobby":
      return <LobbySettings view={view} configure={actions.configure} />;
    case "prompt":
    case "submission":
    case "guessing":
      return (
        <div className="flex flex-col gap-4">
          <p className="text-sm uppercase tracking-widest text-cream/50">{CATEGORY_LABELS[round!.prompt.category]} question</p>
          <p className="font-display text-3xl font-semibold text-balance" data-testid="host-prompt">{round!.prompt.text}</p>
          {view.phase === "submission" && (
            <p className="text-lg">
              <strong data-testid="host-submitted-count">{round!.submittedIds.length}</strong> of {view.players.length} answers received
              <span className="ml-2 text-sm text-cream/50">(answers stay secret until everyone's in)</span>
            </p>
          )}
          {view.phase === "guessing" && (
            <>
              <p className="text-lg">
                <strong>{round!.lockedIds.length}</strong> of {view.players.length} players locked in
              </p>
              <ol className="grid gap-2 md:grid-cols-2">
                {round!.responses!.map((r) => (
                  <li key={r.id} className="rounded-2xl bg-cream px-4 py-3 text-ink">
                    <span className="mr-2 font-display font-bold text-pop-pink">{r.label}</span>
                    <span className="break-words">{r.text}</span>
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      );
    case "reveal": {
      const rv = round!.reveal!;
      const author = view.players.find((p) => p.id === rv.current.authorId);
      return (
        <div className="flex flex-col gap-3">
          <p className="text-sm uppercase tracking-widest text-cream/50">
            Answer {rv.index + 1} of {rv.total} · {rv.stage === "suspects" ? "showing suspects" : "author revealed"}
          </p>
          <p className="rounded-2xl bg-cream px-5 py-4 font-display text-2xl text-ink" data-testid="host-reveal-text">
            <span className="mr-2 text-pop-pink">{rv.current.label}</span>
            {rv.current.text}
          </p>
          {author ? (
            <p className="flex items-center gap-2 text-xl" data-testid="host-reveal-author">
              Written by <Avatar index={author.avatar} size={36} /> <strong>{author.name}</strong> — fooled {rv.current.fooledIds!.length}, spotted by {rv.current.correctGuesserIds!.length}
            </p>
          ) : (
            <p className="text-cream/60">{rv.current.totalGuesses} guesses made. The author is unmasked when the timer runs out.</p>
          )}
        </div>
      );
    }
    case "scoreboard":
      return (
        <div className="flex flex-col gap-3">
          {view.scoreboard?.skipped && <p className="rounded-2xl bg-pop-orange/20 p-3">Not enough answers this round — no points awarded.</p>}
          <Standings rows={view.scoreboard?.standings ?? []} />
        </div>
      );
    case "gameOver":
      return (
        <div className="flex flex-col gap-3">
          <p className="font-display text-2xl">
            🏆 {view.final!.winnerIds.map((id) => view.players.find((p) => p.id === id)?.name).join(" & ")} win
            {view.final!.winnerIds.length === 1 ? "s" : ""}!
          </p>
          <Standings rows={view.final?.standings ?? []} />
        </div>
      );
  }
}

function Standings({ rows }: { rows: { playerId: string; name: string; avatar: number; score: number; rank: number; roundPoints: number }[] }) {
  return (
    <ol className="flex flex-col gap-1.5" data-testid="host-standings">
      {rows.map((r) => (
        <li key={r.playerId} className="flex items-center gap-3 rounded-xl bg-ink-900/60 px-3 py-2" data-testid="standing-row" data-name={r.name} data-score={r.score} data-rank={r.rank}>
          <span className="w-8 font-display text-xl text-cream/60">#{r.rank}</span>
          <Avatar index={r.avatar} size={32} />
          <span className="flex-1 font-semibold">{r.name}</span>
          {r.roundPoints > 0 && <span className="text-pop-green">+{formatPoints(r.roundPoints)}</span>}
          <span className="w-20 text-right font-display text-xl tabular-nums text-pop-yellow">{formatPoints(r.score)}</span>
        </li>
      ))}
    </ol>
  );
}

function LobbySettings({ view, configure }: { view: ClientView; configure: (c: Partial<ClientView["config"]>) => unknown }) {
  const c = view.config;
  const toggleCategory = (cat: (typeof CATEGORIES)[number]) => {
    const next = c.categories.includes(cat) ? c.categories.filter((x) => x !== cat) : [...c.categories, cat];
    if (next.length) configure({ categories: next });
  };
  return (
    <div className="flex flex-col gap-5" data-testid="lobby-settings">
      <h2 className="font-display text-2xl">Game Settings</h2>
      <div>
        <p className="mb-2 font-semibold">Rounds</p>
        <div className="flex gap-2" role="radiogroup" aria-label="Rounds">
          {ROUND_OPTIONS.map((n) => (
            <button
              key={n}
              role="radio"
              aria-checked={c.rounds === n}
              onClick={() => configure({ rounds: n })}
              className={`rounded-2xl px-5 py-2 font-display text-xl ${c.rounds === n ? "bg-pop-yellow text-ink" : "bg-ink-700 hover:bg-ink-600"}`}
              data-testid={`rounds-${n}`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-2">
          <span className="font-semibold">Answer timer</span>
          <select
            className="rounded-xl bg-ink-700 px-3 py-2"
            value={c.submissionSeconds}
            onChange={(e) => configure({ submissionSeconds: Number(e.target.value) })}
            data-testid="submission-timer"
          >
            {SUBMISSION_TIMER_OPTIONS.map((s) => (
              <option key={s} value={s}>{s} seconds</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-2">
          <span className="font-semibold">Guessing timer</span>
          <select
            className="rounded-xl bg-ink-700 px-3 py-2"
            value={c.guessingSeconds}
            onChange={(e) => configure({ guessingSeconds: Number(e.target.value) })}
            data-testid="guessing-timer"
          >
            {GUESSING_TIMER_OPTIONS.map((s) => (
              <option key={s} value={s}>{s} seconds</option>
            ))}
          </select>
        </label>
      </div>
      <div>
        <p className="mb-2 font-semibold">Question categories</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {CATEGORIES.map((cat) => {
            const on = c.categories.includes(cat);
            return (
              <button
                key={cat}
                onClick={() => toggleCategory(cat)}
                aria-pressed={on}
                className={`rounded-2xl border-2 px-4 py-2 text-left transition ${on ? "border-pop-cyan bg-pop-cyan/15" : "border-white/10 bg-ink-900/40 opacity-60"}`}
                data-testid={`category-${cat}`}
              >
                <span className="font-display text-lg">{on ? "✓ " : ""}{CATEGORY_LABELS[cat]}</span>
                <span className="block text-sm text-cream/60">{CATEGORY_BLURBS[cat]}</span>
              </button>
            );
          })}
        </div>
      </div>
      {view.host && view.host.startBlockers.length > 0 && (
        <p className="rounded-2xl bg-ink-900/60 p-3 text-cream/70" data-testid="start-blockers">
          {view.host.startBlockers.join(" · ")}
        </p>
      )}
      {view.players.length > 0 && view.players.length < LIMITS.recommendedPlayers && (
        <p className="text-sm text-cream/50">Tip: 4 or more players makes for the best game.</p>
      )}
    </div>
  );
}
