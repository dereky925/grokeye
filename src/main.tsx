import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import Landing from "./components/Landing";
import Organization from "./components/Organization";
import { useRoute } from "./lib/router";
import "./styles/global.css";

function Root() {
  const path = useRoute();
  if (path.startsWith("/videos")) return <App />;
  if (path.startsWith("/organization")) return <Organization />;
  return <Landing />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
