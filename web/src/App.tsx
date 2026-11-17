import { useRoute } from "./lib/router";
import { Home } from "./screens/Home";
import { HostApp } from "./screens/host/HostApp";
import { PlayerApp } from "./screens/player/PlayerApp";
import { TvApp } from "./screens/tv/TvApp";
import { Toasts } from "./components/ui";

export function App() {
  const route = useRoute();
  return (
    <>
      {route.name === "home" && <Home />}
      {route.name === "host" && <HostApp key={route.code} code={route.code} />}
      {route.name === "tv" && <TvApp key={route.code} code={route.code} />}
      {route.name === "play" && <PlayerApp key={route.code} code={route.code} />}
      <Toasts />
    </>
  );
}
